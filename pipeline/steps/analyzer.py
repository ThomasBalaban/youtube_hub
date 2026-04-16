import asyncio
import httpx

from pipeline.state  import state, log
from pipeline.config import get_launcher_base

DONE_MARKERS = [
    ">> Done. All drafts analyzed.",
    "No action selected",
    "Could not navigate",
]
API_LIMIT_MARKERS = [
    "429", "RESOURCE_EXHAUSTED", "quota", "rateLimitExceeded", "too many requests",
]
ERROR_MARKERS = ["CRITICAL:", "Navigation failed"]


async def run_analyzer(client: httpx.AsyncClient) -> tuple[bool, bool]:
    """Returns (success, api_limit_hit)."""
    log("─" * 40)
    log("STEP 6 — AI Analysis")
    log("─" * 40)
    state["step"]       = "analyzing"
    state["step_label"] = "Analyzing drafts with Gemini AI..."

    launcher_base = get_launcher_base()

    try:
        r = await client.post(
            f"{launcher_base}/launcher/publisher/settings",
            json={
                "PROCESS_SINGLE_VIDEO": False,
                "ENABLE_SCRAPING_MODE": False,
                "ENABLE_ANALYSIS_MODE": True,
                "ENABLE_UPLOAD_MODE":   False,
                "VIDEOS_TO_PROCESS_COUNT": 50,
            },
        )
        if not r.is_success:
            log(f"❌ Could not set analyzer settings (HTTP {r.status_code})")
            return False, False
        log("✅ Publisher set to AI Analysis mode")

        r = await client.post(f"{launcher_base}/launcher/services/youtube_publisher/start")
        if not r.is_success:
            log(f"❌ Could not start publisher (HTTP {r.status_code})")
            return False, False

        log("✅ Analyzer started — watching for completion...")
        await asyncio.sleep(5)

        log_cursor = 0
        while True:
            await asyncio.sleep(10)
            if not state["running"]:
                await client.post(f"{launcher_base}/launcher/services/youtube_publisher/stop")
                return False, False
            try:
                lr = await client.get(
                    f"{launcher_base}/launcher/services/youtube_publisher/logs?last=500",
                    timeout=10.0,
                )
                if lr.is_success:
                    all_lines = lr.json().get("lines", [])
                    new_lines = all_lines[log_cursor:]
                    for line in new_lines:
                        log(f"  [ANA] {line}")
                    log_cursor = len(all_lines)

                    combined = " ".join(new_lines).lower()
                    if any(m.lower() in combined for m in API_LIMIT_MARKERS):
                        log("⚠️ Gemini API limit detected — stopping for the day")
                        await client.post(f"{launcher_base}/launcher/services/youtube_publisher/stop")
                        await asyncio.sleep(2)
                        return False, True

                    if any(m in line for line in new_lines for m in DONE_MARKERS):
                        log("✅ Analyzer finished — stopping publisher...")
                        await client.post(f"{launcher_base}/launcher/services/youtube_publisher/stop")
                        await asyncio.sleep(2)
                        return True, False

                    if any(m in line for line in new_lines for m in ERROR_MARKERS):
                        log("❌ Analyzer hit a critical error")
                        await client.post(f"{launcher_base}/launcher/services/youtube_publisher/stop")
                        return False, False

                r2 = await client.get(f"{launcher_base}/launcher/services")
                if r2.is_success:
                    svcs = r2.json()
                    svc  = next((s for s in svcs if s["id"] == "youtube_publisher"), None)
                    if svc and svc["status"] == "offline":
                        log("✅ Analyzer exited naturally")
                        return True, False

            except Exception as e:
                log(f"   ⚠️ Poll error: {e} — retrying...")

    except Exception as e:
        log(f"❌ Analyzer step error: {e}")
        import traceback
        log(traceback.format_exc())
        return False, False