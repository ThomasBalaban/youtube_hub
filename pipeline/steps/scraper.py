import asyncio
import httpx

from pipeline.state  import state, log
from pipeline.config import get_launcher_base

DONE_MARKERS  = ["Scrape Complete.", "No action selected", "Could not navigate"]
ERROR_MARKERS = ["CRITICAL:", "Navigation failed"]


async def run_scraper(client: httpx.AsyncClient) -> bool:
    log("─" * 40)
    log("STEP 5 — Scraper")
    log("─" * 40)
    state["step"]       = "scraping"
    state["step_label"] = "Scraping YouTube Studio for draft/scheduled data..."

    launcher_base = get_launcher_base()

    try:
        r = await client.post(
            f"{launcher_base}/launcher/publisher/settings",
            json={
                "PROCESS_SINGLE_VIDEO": False,
                "ENABLE_SCRAPING_MODE": True,
                "ENABLE_ANALYSIS_MODE": False,
                "ENABLE_UPLOAD_MODE":   False,
                "VIDEOS_TO_PROCESS_COUNT": 50,
            },
        )
        if not r.is_success:
            log(f"❌ Could not set scraper settings (HTTP {r.status_code})")
            return False
        log("✅ Publisher set to Scraper mode")

        r = await client.post(f"{launcher_base}/launcher/services/youtube_publisher/start")
        if not r.is_success:
            log(f"❌ Could not start publisher (HTTP {r.status_code})")
            return False

        log("✅ Scraper started — watching for completion...")
        await asyncio.sleep(5)

        log_cursor = 0
        while True:
            await asyncio.sleep(10)
            if not state["running"]:
                await client.post(f"{launcher_base}/launcher/services/youtube_publisher/stop")
                return False
            try:
                lr = await client.get(
                    f"{launcher_base}/launcher/services/youtube_publisher/logs?last=500",
                    timeout=10.0,
                )
                if lr.is_success:
                    all_lines = lr.json().get("lines", [])
                    new_lines = all_lines[log_cursor:]
                    for line in new_lines:
                        log(f"  [SCR] {line}")
                    log_cursor = len(all_lines)

                    if any(m in line for line in new_lines for m in DONE_MARKERS):
                        log("✅ Scraper finished — stopping publisher...")
                        await client.post(f"{launcher_base}/launcher/services/youtube_publisher/stop")
                        await asyncio.sleep(2)
                        return True

                    if any(m in line for line in new_lines for m in ERROR_MARKERS):
                        log("❌ Scraper hit a critical error")
                        await client.post(f"{launcher_base}/launcher/services/youtube_publisher/stop")
                        return False

                r2 = await client.get(f"{launcher_base}/launcher/services")
                if r2.is_success:
                    svcs = r2.json()
                    svc  = next((s for s in svcs if s["id"] == "youtube_publisher"), None)
                    if svc and svc["status"] == "offline":
                        log("✅ Scraper exited naturally")
                        return True

            except Exception as e:
                log(f"   ⚠️ Poll error: {e} — retrying...")

    except Exception as e:
        log(f"❌ Scraper step error: {e}")
        import traceback
        log(traceback.format_exc())
        return False