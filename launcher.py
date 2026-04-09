"""
YouTube Hub Launcher — Process Manager

Lives in youtube_hub/ and manages sibling services.
Started automatically by `npm start` — you never need to run this manually.

Port: 8010 (configurable via .env LAUNCHER_PORT)

Health check strategy:
  - "process" — just checks if the PID is still alive (default for GUI/headless apps)
  - "http"    — GET /health endpoint
  - "tcp"     — TCP port probe
"""

import asyncio
import subprocess
import threading
import time
import os
import sys
import httpx
import uvicorn
from collections import deque
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from service_defs import SERVICE_DEFS, BOOT_RETRIES, THIS_DIR

LAUNCHER_PORT = int(os.environ.get("LAUNCHER_PORT", 8010))

# ─────────────────────────────────────────────
# Runtime state
# ─────────────────────────────────────────────

_procs:    Dict[str, Optional[subprocess.Popen]] = {k: None for k in SERVICE_DEFS}
_logs:     Dict[str, deque]                       = {k: deque(maxlen=500) for k in SERVICE_DEFS}
_starting: set                                     = set()
_stopping: set                                     = set()

http_client: Optional[httpx.AsyncClient] = None

# ─────────────────────────────────────────────
# Health checks
# ─────────────────────────────────────────────

async def _http_health(url: str, timeout: float = 2.0) -> bool:
    if not http_client:
        return False
    try:
        r = await http_client.get(url, timeout=timeout)
        r.raise_for_status()
        return True
    except Exception:
        return False


async def _tcp_health(host: str, port: int, timeout: float = 1.5) -> bool:
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=timeout
        )
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception:
        return False


async def _health_check(name: str) -> bool:
    defn = SERVICE_DEFS[name]
    hc   = defn.get("health_check", "process")

    if hc == "process":
        return _proc_alive(name)
    elif hc == "http":
        url = defn.get("health_url", f"http://localhost:{defn['port']}/health")
        return await _http_health(url)
    elif hc == "tcp":
        return await _tcp_health("127.0.0.1", defn["port"])

    return _proc_alive(name)


async def _wait_for_health(name: str, retries: int = 10, interval: float = 0.5) -> bool:
    for _ in range(retries):
        if await _health_check(name):
            return True
        await asyncio.sleep(interval)
    return False

# ─────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────

def _append_log(name: str, line: str) -> None:
    _logs[name].append(f"[{time.strftime('%H:%M:%S')}] {line.rstrip()}")


def _stream_output(name: str, pipe) -> None:
    try:
        for raw in iter(pipe.readline, b""):
            _append_log(name, raw.decode("utf-8", errors="replace"))
    except Exception:
        pass


def _proc_alive(name: str) -> bool:
    p = _procs[name]
    return p is not None and p.poll() is None

# ─────────────────────────────────────────────
# Service control
# ─────────────────────────────────────────────

async def start_service(name: str) -> Dict[str, Any]:
    defn = SERVICE_DEFS.get(name)
    if not defn:
        raise HTTPException(404, f"Unknown service: {name}")
    if not defn.get("managed"):
        raise HTTPException(400, f"Service '{name}' is not managed by the launcher")
    if _proc_alive(name):
        return {"ok": False, "reason": "already_running"}
    if name in _starting:
        return {"ok": False, "reason": "already_starting"}

    is_module = "-m" in defn["cmd"]
    entry     = defn["cmd"][-1]
    if not is_module and not os.path.exists(os.path.join(defn.get("cwd", THIS_DIR), entry)):
        msg = f"Entry point not found: {entry}"
        _append_log(name, f"❌ {msg}")
        return {"ok": False, "reason": msg}

    _starting.add(name)
    _append_log(name, f"--- Starting {defn['label']} ---")
    _append_log(name, f"    cmd: {' '.join(str(c) for c in defn['cmd'])}")
    _append_log(name, f"    cwd: {defn.get('cwd', THIS_DIR)}")

    proc_env = os.environ.copy()
    proc_env["PYTHONUNBUFFERED"] = "1"

    try:
        p = subprocess.Popen(
            defn["cmd"],
            cwd=defn.get("cwd", THIS_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=proc_env,
        )
        _procs[name] = p
        threading.Thread(
            target=_stream_output, args=(name, p.stdout), daemon=True
        ).start()

        retries = BOOT_RETRIES.get(name, 5)
        healthy = await _wait_for_health(name, retries=retries)

        if healthy:
            _append_log(name, f"✅ {defn['label']} is running (PID {p.pid})")
            return {"ok": True, "pid": p.pid}
        elif p.poll() is not None:
            _append_log(name, f"❌ Process exited early (code {p.returncode})")
            _procs[name] = None
            return {"ok": False, "reason": "process_died", "code": p.returncode}
        else:
            if _proc_alive(name):
                _append_log(
                    name,
                    f"⚠️  {defn['label']} running (PID {p.pid}) — health check timed out, treating as online",
                )
                return {"ok": True, "pid": p.pid, "warning": "health_timeout"}
            _procs[name] = None
            return {"ok": False, "reason": "failed_to_start"}

    except Exception as e:
        _append_log(name, f"❌ Failed to start: {e}")
        _procs[name] = None
        return {"ok": False, "reason": str(e)}
    finally:
        _starting.discard(name)


async def stop_service(name: str) -> Dict[str, Any]:
    defn = SERVICE_DEFS.get(name)
    if not defn:
        raise HTTPException(404, f"Unknown service: {name}")
    if not defn.get("managed"):
        raise HTTPException(400, f"Service '{name}' is not managed by the launcher")

    p = _procs.get(name)
    if not p or p.poll() is not None:
        _procs[name] = None
        return {"ok": False, "reason": "not_running"}
    if name in _stopping:
        return {"ok": False, "reason": "already_stopping"}

    _stopping.add(name)
    _append_log(name, f"--- Stopping {defn['label']} ---")

    try:
        p.terminate()
        for _ in range(50):
            await asyncio.sleep(0.1)
            if p.poll() is not None:
                break
        else:
            _append_log(name, "Process didn't exit cleanly — killing")
            p.kill()
            await asyncio.sleep(0.3)

        _procs[name] = None
        _append_log(name, f"✅ Stopped (exit code {p.returncode})")
        return {"ok": True, "code": p.returncode}

    except Exception as e:
        _append_log(name, f"❌ Error stopping: {e}")
        return {"ok": False, "reason": str(e)}
    finally:
        _stopping.discard(name)

# ─────────────────────────────────────────────
# App lifecycle
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient()

    print(f"🚀 YouTube Hub Launcher ready on :{LAUNCHER_PORT}")
    for name, defn in SERVICE_DEFS.items():
        if not defn.get("managed"):
            continue
        is_module = "-m" in defn["cmd"]
        entry     = defn["cmd"][-1]
        exists    = is_module or os.path.exists(
            os.path.join(defn.get("cwd", THIS_DIR), entry)
        )
        print(f"   {'✅' if exists else '❌'} {defn['label']:25s} → {entry}")

    yield

    for name, p in _procs.items():
        if p and p.poll() is None:
            print(f"  Stopping {name}...")
            p.terminate()
    if http_client:
        await http_client.aclose()


app = FastAPI(title="YouTube Hub Launcher", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

# ─────────────────────────────────────────────
# Routers
# ─────────────────────────────────────────────

from publisher_routes import router as publisher_router
app.include_router(publisher_router, prefix="/launcher")

from subtitler_routes import router as subtitler_router
app.include_router(subtitler_router, prefix="/launcher")

from backtrack_routes import router as backtrack_router
app.include_router(backtrack_router, prefix="/launcher")

from pipeline import router as pipeline_router
app.include_router(pipeline_router, prefix="/launcher")

# ─────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────

@app.get("/launcher/services")
async def list_services():
    result = []
    for name, defn in SERVICE_DEFS.items():
        alive   = _proc_alive(name)
        healthy = await _health_check(name)

        if name in _starting:   status = "starting"
        elif name in _stopping: status = "stopping"
        elif healthy:           status = "online"
        elif alive:             status = "unhealthy"
        else:                   status = "offline"

        result.append({
            "id":           name,
            "label":        defn["label"],
            "description":  defn.get("description", ""),
            "port":         defn.get("port"),
            "managed":      defn.get("managed", False),
            "health_check": defn.get("health_check", "process"),
            "is_gui":       defn.get("is_gui", False),
            "color_hint":   defn.get("color_hint", "#63e2b7"),
            "status":       status,
            "pid":          _procs[name].pid if alive else None,
            "cwd":          defn.get("cwd", THIS_DIR),
        })
    return result


@app.post("/launcher/services/{name}/start")
async def start(name: str):
    return await start_service(name)


@app.post("/launcher/services/{name}/stop")
async def stop(name: str):
    return await stop_service(name)


@app.post("/launcher/services/{name}/restart")
async def restart(name: str):
    await stop_service(name)
    await asyncio.sleep(0.5)
    return await start_service(name)


@app.get("/launcher/services/{name}/logs")
async def get_logs(name: str, last: int = 150):
    if name not in SERVICE_DEFS:
        raise HTTPException(404, f"Unknown service: {name}")
    return {"lines": list(_logs[name])[-last:]}


@app.delete("/launcher/services/{name}/logs")
async def clear_logs(name: str):
    if name not in SERVICE_DEFS:
        raise HTTPException(404, f"Unknown service: {name}")
    _logs[name].clear()
    return {"ok": True}


@app.get("/launcher/health")
async def health():
    return {"status": "ok", "service": "launcher", "port": LAUNCHER_PORT}


if __name__ == "__main__":
    print("🚀 LAUNCHER — Starting...")
    uvicorn.run(app, host="0.0.0.0", port=LAUNCHER_PORT, log_level="warning")
