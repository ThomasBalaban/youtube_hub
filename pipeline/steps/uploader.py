"""
Pipeline step 3: YouTube Shorts Uploader.
Sets ENABLE_UPLOAD_MODE in publisher settings, starts the youtube_publisher
service, and waits for it to finish (run-and-exit like the scanner).
"""

import asyncio
import httpx

from pipeline.state import state, log

LAUNCHER_BASE = "http://localhost:8010"

# Publisher can take a long time uploading batches through a browser
UPLOAD_TIMEOUT_MINUTES = 120


async def run_uploader(client: httpx.AsyncClient) -> bool:
    log("─" * 40)
    log("STEP 3 — YouTube Uploader")
    log("─" * 40)
    state["step"]       = "uploading"
    state["step_label"] = "Uploading processed videos to YouTube..."

    try:
        # ── Set publisher to uploader mode ────────────────────────────────────
        log("▶ Setting publisher to Uploader mode...")
        settings_payload = {
            "PROCESS_SINGLE_VIDEO": False,
            "ENABLE_SCRAPING_MODE": False,
            "ENABLE_ANALYSIS_MODE": False,
            "ENABLE_UPLOAD_MODE":   True,
            "VIDEOS_TO_PROCESS_COUNT": 50,
        }
        r = await client.post(
            f"{LAUNCHER_BASE}/launcher/publisher/settings",
            json=settings_payload,
        )
        if not r.is_success:
            log(f"❌ Could not set publisher settings (HTTP {r.status_code})")
            return False
        log("✅ Publisher set to Uploader mode")

        # ── Start the publisher service ───────────────────────────────────────
        log("▶ Starting YouTube Publisher...")
        r = await client.post(
            f"{LAUNCHER_BASE}/launcher/services/youtube_publisher/start"
        )
        if not r.is_success:
            log(f"❌ Could not start publisher (HTTP {r.status_code})")
            return False

        log("✅ Publisher started — waiting for it to finish...")
        await asyncio.sleep(5)

        # ── Poll logs for completion marker, then stop the service ────────────
        # The publisher keeps the browser open after finishing (designed for manual use),
        # so it never goes offline on its own. We watch stdout for the done marker
        # and stop it ourselves.
        DONE_MARKERS = ["[Uploader] All done.", "No action selected", "Could not navigate"]
        log_cursor = 0
        max_checks = UPLOAD_TIMEOUT_MINUTES * 6   # 10s each
        for check in range(max_checks):
            await asyncio.sleep(10)
            try:
                # Check stdout logs for the completion string
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

                    # Check if any done marker appears in the latest lines
                    if any(marker in line for line in new_lines for marker in DONE_MARKERS):
                        log("✅ Uploader finished — stopping publisher service...")
                        await client.post(
                            f"{LAUNCHER_BASE}/launcher/services/youtube_publisher/stop"
                        )
                        await asyncio.sleep(2)
                        return True

                # Also accept if it exited naturally
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