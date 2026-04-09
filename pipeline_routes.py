"""
FastAPI router for the Auto-Run pipeline.
Orchestrates: Backtrack Scan → SimpleAutoSubs processing on a 1-hour loop.
"""

import asyncio
import json
import os
import time
from collections import deque
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/pipeline")

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(THIS_DIR)
BACKTRACK_DIR = os.path.join(PARENT_DIR, "backtrack_scanner")
HISTORY_FILE = os.path.join(THIS_DIR, "pipeline_history.json")
HUB_SETTINGS_FILE = os.path.join(THIS_DIR, "hub_settings.json")

SUBTITLER_BASE = "http://localhost:8020"
LAUNCHER_BASE = "http://localhost:8010"

MAX_FILES_PER_RUN = 3
HOURLY_INTERVAL = 3600  # seconds

# ── State ─────────────────────────────────────────────────────────────────────

_state: dict = {
    "running": False,
    "step": "idle",         # idle | scanning | processing | waiting | error
    "step_label": "—",
    "next_scan_at": None,   # epoch float
    "last_run_at": None,
    "last_run_files": 0,
    "errors": [],
}

_logs: deque = deque(maxlen=1000)
_history: dict = {}         # filename → ISO timestamp when processed
_runs: list = []            # recent run records, newest first
_task: Optional[asyncio.Task] = None

# ── Helpers ───────────────────────────────────────────────────────────────────

# Pipeline owns its own HTTP client — no dependency on launcher internals.
_http_client = None

async def _ensure_http_client():
    """Lazily create the shared httpx client on first use."""
    global _http_client
    if _http_client is None:
        import httpx
        # connect timeout is short (fail fast if nothing is listening),
        # read timeout is None (no cap) because the SimpleAutoSubs event loop
        # can be starved by heavy AI/transcription work for several minutes at a time.
        # The outer poll loop already enforces a 1-hour overall ceiling.
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0)
        )
    return _http_client


def _log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    _logs.append(line)
    print(f"[pipeline] {line}", flush=True)


def _load_history() -> None:
    global _history
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                _history = json.load(f)
            _log(f"📋 Loaded pipeline history: {len(_history)} entries")
        except Exception as e:
            _log(f"⚠️ Could not load history: {e}")
            _history = {}
    else:
        _history = {}
        _log("📋 No pipeline history found — starting fresh")


def _save_history() -> None:
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(_history, f, indent=2)
    except Exception as e:
        _log(f"⚠️ Could not save history: {e}")


def _read_hub_settings() -> dict:
    if os.path.exists(HUB_SETTINGS_FILE):
        try:
            with open(HUB_SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _write_hub_settings(patch: dict) -> None:
    data = _read_hub_settings()
    data.update(patch)
    with open(HUB_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _read_inventory() -> dict:
    inv_path = os.path.join(BACKTRACK_DIR, "copied_inventory.json")
    if not os.path.exists(inv_path):
        _log("⚠️ copied_inventory.json not found")
        return {}
    try:
        with open(inv_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        _log(f"⚠️ Could not read inventory: {e}")
        return {}


def _get_new_files() -> list:
    """Return up to MAX_FILES_PER_RUN (filename, full_path) tuples not yet in history."""
    inventory = _read_inventory()
    settings = _read_hub_settings()
    dest_dir = settings.get("backtrack_dest_dir", "/Users/thomasbalaban/Downloads/todoshorts")

    new_files = []
    for filename in inventory:
        if filename not in _history:
            full_path = os.path.join(dest_dir, filename)
            if os.path.exists(full_path):
                new_files.append((filename, full_path))
            else:
                # File was deleted (e.g. by cluster cleanup) — mark as handled
                # so it never re-appears in future cycles
                _log(f"⚠️ File deleted/missing, marking as handled: {filename}")
                _history[filename] = "deleted"
                _save_history()

    # Deterministic order via filename (which contains the timestamp)
    new_files.sort(key=lambda x: x[0])
    selected = new_files[:MAX_FILES_PER_RUN]

    if new_files:
        _log(f"📂 {len(inventory)} in inventory, {len(new_files)} new, selecting {len(selected)}")
    return selected


# ── Pipeline steps ─────────────────────────────────────────────────────────────

async def _run_scanner(client) -> bool:
    """Trigger the backtrack scanner and wait until it exits."""
    _log("─" * 40)
    _log("STEP 1 — Backtrack Scan")
    _log("─" * 40)
    _state["step"] = "scanning"
    _state["step_label"] = "Scanning SMB drive for new recordings..."

    try:
        r = await client.post(
            f"{LAUNCHER_BASE}/launcher/services/backtrack_scanner/start"
        )
        if not r.is_success:
            _log(f"❌ Could not start scanner (HTTP {r.status_code})")
            return False

        _log("✅ Scanner started — waiting for it to finish...")
        await asyncio.sleep(3)

        # Poll up to 3 minutes for the scanner to go offline (run-and-exit)
        for _ in range(60):
            await asyncio.sleep(3)
            r2 = await client.get(f"{LAUNCHER_BASE}/launcher/services")
            if r2.is_success:
                svcs = r2.json()
                svc = next((s for s in svcs if s["id"] == "backtrack_scanner"), None)
                if svc and svc["status"] == "offline":
                    _log("✅ Scanner completed successfully")
                    return True
        _log("⚠️ Scanner did not finish within 3 minutes")
        return False

    except Exception as e:
        _log(f"❌ Scanner step error: {e}")
        return False


async def _run_subtitler(client, files: list) -> bool:
    """Start SimpleAutoSubs API, queue files, start processing, wait for done."""
    _log("─" * 40)
    _log("STEP 2 — SimpleAutoSubs Processing")
    _log("─" * 40)
    _state["step"] = "processing"
    _state["step_label"] = f"Processing {len(files)} file(s) through SimpleAutoSubs..."

    paths = [f[1] for f in files]

    _log("Files to process:")
    for p in paths:
        _log(f"   • {os.path.basename(p)}")

    try:
        # Ensure the API is running — poll the launcher (it owns the health check)
        svc_r = await client.get(f"{LAUNCHER_BASE}/launcher/services")
        if svc_r.is_success:
            svcs = svc_r.json()
            api_svc = next((s for s in svcs if s["id"] == "simple_auto_subs_api"), None)
            if not api_svc or api_svc["status"] != "online":
                _log("▶ Starting SimpleAutoSubs API (heavy imports, allow up to 3 min)...")
                await client.post(
                    f"{LAUNCHER_BASE}/launcher/services/simple_auto_subs_api/start"
                )
                # Poll the launcher every 5s for up to 3 minutes.
                # The launcher itself handles the health check — we just wait for "online".
                api_ready = False
                for attempt in range(36):
                    await asyncio.sleep(5)
                    r2 = await client.get(f"{LAUNCHER_BASE}/launcher/services")
                    if r2.is_success:
                        svcs2 = r2.json()
                        api2 = next((s for s in svcs2 if s["id"] == "simple_auto_subs_api"), None)
                        status2 = api2["status"] if api2 else "unknown"
                        _log(f"   ⏳ Waiting for API... ({status2}) [{attempt+1}/36]")
                        if api2 and status2 == "online":
                            _log("✅ SimpleAutoSubs API is online")
                            api_ready = True
                            break
                if not api_ready:
                    _log("❌ SimpleAutoSubs API failed to start within 3 minutes")
                    return False
            else:
                _log("✅ SimpleAutoSubs API already online")

        # Queue the files
        r = await client.post(
            f"{SUBTITLER_BASE}/files",
            json={"paths": paths},
        )
        if not r.is_success:
            _log(f"❌ Failed to queue files (HTTP {r.status_code})")
            return False

        added = r.json().get("added", 0)
        _log(f"✅ {added} file(s) queued")

        # Start processing
        r = await client.post(f"{SUBTITLER_BASE}/process/start")
        if not r.is_success:
            _log(f"❌ Failed to start processing (HTTP {r.status_code})")
            return False

        _log("▶ Processing started — polling for completion...")

        import httpx as _httpx
        errors_seen = 0
        log_cursor = 0  # tracks how many subtitler log lines we've already forwarded

        # Poll up to 1 hour (each video can take a while)
        for _ in range(720):
            await asyncio.sleep(5)

            # ── Forward new SimpleAutoSubs log lines into the pipeline log ──
            try:
                log_r = await client.get(f"{SUBTITLER_BASE}/logs?last=500", timeout=3.0)
                if log_r.is_success:
                    all_lines = log_r.json().get("lines", [])
                    new_lines = all_lines[log_cursor:]
                    for line in new_lines:
                        _log(f"  [SAS] {line}")
                    log_cursor = len(all_lines)
            except Exception:
                pass  # log forwarding is best-effort, never crash the poll

            # ── Check processing status ──
            try:
                r = await client.get(f"{SUBTITLER_BASE}/process/status")
            except _httpx.ReadTimeout:
                continue
            except Exception as poll_err:
                _log(f"   ⚠️ Poll error: {poll_err} — retrying...")
                continue
            if not r.is_success:
                _log("⚠️ Could not reach subtitler status endpoint")
                continue

            status = r.json()
            done = status.get("done", 0)
            total = status.get("total", 0)
            processing = status.get("processing", False)
            queued_left = status.get("queued", 0)
            err_count = status.get("errors", 0)

            if err_count > errors_seen:
                _state["errors"].append(f"{err_count - errors_seen} file(s) errored in SimpleAutoSubs")
                errors_seen = err_count

            if not processing and queued_left == 0:
                _log(f"✅ Batch complete — {done} done, {err_count} errors")
                return True

        _log("⚠️ Processing timed out after 1 hour")
        return False

    except Exception as e:
        _log(f"❌ Subtitler step error: {e}")
        import traceback
        _log(traceback.format_exc())
        return False


# ── Main loop ─────────────────────────────────────────────────────────────────

async def _pipeline_loop() -> None:
    """Immediate run then 1-hour loop until stopped."""
    _load_history()

    while _state["running"]:
        _state["errors"] = []
        run_start = time.time()
        files_processed = 0

        _log("═" * 50)
        _log(f"🚀 Auto-Run cycle — {time.strftime('%Y-%m-%d %H:%M:%S')}")
        _log("═" * 50)

        # Get (or lazily create) the pipeline's own HTTP client
        client = await _ensure_http_client()

        # Step 1 — Scan
        scan_ok = await _run_scanner(client)
        if not scan_ok:
            _state["errors"].append("Scanner failed — see log for details")

        # Step 2 — Find new files
        new_files = _get_new_files()

        if not new_files:
            _log("ℹ️ No new files to process this cycle")
        else:
            # Step 3 — Process
            process_ok = await _run_subtitler(client, new_files)

            if process_ok:
                ts = time.strftime("%Y-%m-%d %H:%M:%S")
                for filename, _ in new_files:
                    _history[filename] = ts
                _save_history()
                files_processed = len(new_files)
                _log(f"📝 Saved {files_processed} file(s) to pipeline history")
            else:
                _state["errors"].append("SimpleAutoSubs processing failed — see log")

        # Record the run
        _runs.insert(0, {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "files_in_inventory": len(_read_inventory()),
            "files_processed": files_processed,
            "errors": list(_state["errors"]),
            "duration_s": int(time.time() - run_start),
        })
        if len(_runs) > 20:
            _runs.pop()

        _state["last_run_at"] = time.strftime("%H:%M:%S")
        _state["last_run_files"] = files_processed

        if not _state["running"]:
            break

        # Wait 1 hour, checking every second for a stop signal
        _state["step"] = "waiting"
        _state["step_label"] = "Waiting for next hourly scan..."
        _state["next_scan_at"] = time.time() + HOURLY_INTERVAL
        next_ts = time.strftime("%H:%M:%S", time.localtime(_state["next_scan_at"]))
        _log(f"💤 Cycle done. Next scan at {next_ts}")

        for _ in range(HOURLY_INTERVAL):
            if not _state["running"]:
                break
            await asyncio.sleep(1)

    _state["step"] = "idle"
    _state["step_label"] = "—"
    _state["next_scan_at"] = None
    _log("⏹ Auto-Run stopped")


# ── Routes ─────────────────────────────────────────────────────────────────────

class DestDirPayload(BaseModel):
    backtrack_dest_dir: str


@router.post("/start")
async def start_pipeline():
    global _task
    if _state["running"]:
        return {"ok": False, "reason": "already_running"}

    _state["running"] = True
    _state["step"] = "idle"
    _logs.clear()
    _state["errors"] = []

    _task = asyncio.create_task(_pipeline_loop())
    return {"ok": True}


@router.post("/stop")
async def stop_pipeline():
    global _task, _http_client
    _state["running"] = False
    _state["next_scan_at"] = None
    if _task and not _task.done():
        _task.cancel()
    if _http_client:
        await _http_client.aclose()
        _http_client = None
    return {"ok": True}


@router.get("/status")
def get_status():
    next_scan_in = None
    if _state["next_scan_at"]:
        next_scan_in = max(0, int(_state["next_scan_at"] - time.time()))

    return {
        "running": _state["running"],
        "step": _state["step"],
        "step_label": _state["step_label"],
        "next_scan_in": next_scan_in,
        "last_run_at": _state["last_run_at"],
        "last_run_files": _state["last_run_files"],
        "errors": _state["errors"],
        "history_count": len(_history),
    }


@router.get("/logs")
def get_logs(last: int = 300):
    return {"lines": list(_logs)[-last:]}


@router.delete("/logs")
def clear_logs():
    _logs.clear()
    return {"ok": True}


@router.get("/runs")
def get_runs():
    return {"runs": _runs}


@router.get("/settings")
def get_settings():
    d = _read_hub_settings()
    return {
        "backtrack_dest_dir": d.get(
            "backtrack_dest_dir", "/Users/thomasbalaban/Downloads/todoshorts"
        )
    }


@router.post("/settings")
def post_settings(payload: DestDirPayload):
    _write_hub_settings({"backtrack_dest_dir": payload.backtrack_dest_dir})
    return {"ok": True}