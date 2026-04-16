import asyncio
import httpx

from pipeline.state  import state, log
from pipeline.config import LAUNCHER_BASE

SUBTITLER_BASE = "http://localhost:9020"


async def run_subtitler(client: httpx.AsyncClient, files: list) -> bool:
    log("─" * 40)
    log("STEP 2 — SimpleAutoSubs Processing")
    log("─" * 40)
    state["step"]       = "processing"
    state["step_label"] = f"Processing {len(files)} file(s) through SimpleAutoSubs..."

    paths = [f[1] for f in files]

    log("Files to process:")
    for p in paths:
        import os
        log(f"   • {os.path.basename(p)}")

    try:
        svc_r = await client.get(f"{LAUNCHER_BASE}/launcher/services")
        if svc_r.is_success:
            svcs    = svc_r.json()
            api_svc = next((s for s in svcs if s["id"] == "simple_auto_subs_api"), None)

            if not api_svc or api_svc["status"] != "online":
                log("▶ Starting SimpleAutoSubs API (heavy imports — allow up to 3 min)...")
                await client.post(
                    f"{LAUNCHER_BASE}/launcher/services/simple_auto_subs_api/start"
                )
                api_ready = False
                for attempt in range(36):
                    await asyncio.sleep(5)
                    r2 = await client.get(f"{LAUNCHER_BASE}/launcher/services")
                    if r2.is_success:
                        svcs2  = r2.json()
                        api2   = next((s for s in svcs2 if s["id"] == "simple_auto_subs_api"), None)
                        status2 = api2["status"] if api2 else "unknown"
                        log(f"   ⏳ Waiting for API... ({status2}) [{attempt + 1}/36]")
                        if api2 and status2 == "online":
                            log("✅ SimpleAutoSubs API is online")
                            api_ready = True
                            break
                if not api_ready:
                    log("❌ SimpleAutoSubs API failed to start within 3 minutes")
                    return False
            else:
                log("✅ SimpleAutoSubs API already online")

        r = await client.post(f"{SUBTITLER_BASE}/files", json={"paths": paths})
        if not r.is_success:
            log(f"❌ Failed to queue files (HTTP {r.status_code})")
            return False

        added = r.json().get("added", 0)
        log(f"✅ {added} file(s) queued")

        r = await client.post(f"{SUBTITLER_BASE}/process/start")
        if not r.is_success:
            log(f"❌ Failed to start processing (HTTP {r.status_code})")
            return False

        log("▶ Processing started — polling for completion...")

        errors_seen = 0
        log_cursor  = 0

        for _ in range(720):
            await asyncio.sleep(5)

            try:
                log_r = await client.get(
                    f"{SUBTITLER_BASE}/logs?last=500", timeout=3.0
                )
                if log_r.is_success:
                    all_lines = log_r.json().get("lines", [])
                    for line in all_lines[log_cursor:]:
                        log(f"  [SAS] {line}")
                    log_cursor = len(all_lines)
            except Exception:
                pass

            try:
                r = await client.get(f"{SUBTITLER_BASE}/process/status")
            except httpx.ReadTimeout:
                continue
            except Exception as poll_err:
                log(f"   ⚠️ Poll error: {poll_err} — retrying...")
                continue

            if not r.is_success:
                log("⚠️ Could not reach subtitler status endpoint")
                continue

            status      = r.json()
            done        = status.get("done", 0)
            processing  = status.get("processing", False)
            queued_left = status.get("queued", 0)
            err_count   = status.get("errors", 0)

            if err_count > errors_seen:
                state["errors"].append(
                    f"{err_count - errors_seen} file(s) errored in SimpleAutoSubs"
                )
                errors_seen = err_count

            if not processing and queued_left == 0:
                log(f"✅ Batch complete — {done} done, {err_count} errors")
                return True

        log("⚠️ Processing timed out after 1 hour")
        return False

    except Exception as e:
        log(f"❌ Subtitler step error: {e}")
        import traceback
        log(traceback.format_exc())
        return False