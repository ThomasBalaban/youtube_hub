import asyncio
import httpx

from pipeline.state  import state, log
from pipeline.config import LAUNCHER_BASE

UPLOAD_TIMEOUT_MINUTES = 120

DONE_MARKERS = ["[Uploader] All done.", "No action selected", "Could not navigate"]


async def run_uploader(client: httpx.AsyncClient) -> bool:
    log("─" * 40)
    log("STEP 3 — YouTube Uploader")
    log("─" * 40)
    state["step"]       = "uploading"
    state["step_label"] = "Uploading processed videos to YouTube..."

    try:
        log("▶ Setting publisher to Uploader mode...")
        r = await client.post(
            f"{LAUNCHER_BASE}/launcher/publisher/settings",
            json={
                "PROCESS_SINGLE_VIDEO": False,
                "ENABLE_SCRAPING_MODE": False,
                "ENABLE_ANALYSIS_MODE": False,
                "ENABLE_UPLOAD_MODE":   True,
                "VIDEOS_TO_PROCESS_COUNT": 50,
            },
        )
        if not r.is_success:
            log(f"❌ Could not set publisher settings (HTTP {r.status_code})")
            return False
        log("✅ Publisher set to Uploader mode")

        log("▶ Starting YouTube Publisher...")
        r = await client.post(
            f"{LAUNCHER_BASE}/launcher/services/youtube_publisher/start"
        )
        if not r.is_success:
            log(f"❌ Could not start publisher (HTTP {r.status_code})")
            return False

        log("✅ Publisher started — waiting for it to finish...")
        await asyncio.sleep(5)

        log_cursor = 0
        max_checks = UPLOAD_TIMEOUT_MINUTES * 6
        for check in range(max_checks):
            await asyncio.sleep(10)
            try:
                lr = await client.get(
                    f"{LAUNCHER_BASE}/launcher/services/youtube_publisher/logs?last=500",
                    timeout=10.0,
                )
                if lr.is_success:
                    all_lines = lr.json().get("lines", [])
                    new_lines = all_lines[log_cursor:]
                    for line in new_lines:
                        log(f"  [PUB] {line}")
                    log_cursor = len(all_lines)

                    if any(marker in line for line in new_lines for marker in DONE_MARKERS):
                        log("✅ Uploader finished — stopping publisher service...")
                        await client.post(
                            f"{LAUNCHER_BASE}/launcher/services/youtube_publisher/stop"
                        )
                        await asyncio.sleep(2)
                        return True

                r2 = await client.get(f"{LAUNCHER_BASE}/launcher/services")
                if r2.is_success:
                    svcs   = r2.json()
                    svc    = next((s for s in svcs if s["id"] == "youtube_publisher"), None)
                    status = svc["status"] if svc else "unknown"
                    if check % 6 == 0:
                        log(f"   ⏳ Publisher status: {status} [{check * 10 // 60}m elapsed]")
                    if svc and status == "offline":
                        log("✅ Publisher exited on its own")
                        return True

            except Exception as poll_err:
                log(f"   ⚠️ Poll error: {poll_err} — retrying...")

        log(f"⚠️ Uploader did not finish within {UPLOAD_TIMEOUT_MINUTES} minutes")
        return False

    except Exception as e:
        log(f"❌ Uploader step error: {e}")
        import traceback
        log(traceback.format_exc())
        return False