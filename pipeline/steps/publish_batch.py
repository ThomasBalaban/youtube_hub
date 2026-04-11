"""
Pipeline step 7: Publish Batch.
Sets publisher to batch mode with current VIDEOS_TO_PROCESS_COUNT from
hub settings, starts the publisher, watches stdout for completion or
stop conditions, then stops the service.

Returns (success, no_drafts, api_limit_hit) so the outer loop knows
whether to keep going or stop for the day.
"""

import asyncio
import httpx

from pipeline.state    import state, log
from pipeline.settings import read_hub_settings

LAUNCHER_BASE   = "http://localhost:8010"
# Publisher batch finished cleanly
DONE_MARKERS = [
    "=== BATCH PROCESSING COMPLETE ===",
    "No action selected",
    "Could not navigate",
]

# No more drafts to publish — inner loop should stop
NO_DRAFTS_MARKERS = [
    "No more matching drafts found.",
    "No matching drafts found.",
]

# YouTube / Gemini API limit signals
API_LIMIT_MARKERS = [
    "429",
    "RESOURCE_EXHAUSTED",
    "quota",
    "rateLimitExceeded",
    "too many requests",
    "uploadLimitExceeded",
    "daily limit",
]

ERROR_MARKERS = ["CRITICAL:", "Navigation failed"]


async def run_publish_batch(client: httpx.AsyncClient) -> tuple[bool, bool, bool]:
    """
    Returns (success, no_drafts, api_limit_hit).
      success      — batch completed without error
      no_drafts    — no more analyzed drafts to publish (stop inner loop)
      api_limit_hit — hit a quota wall (stop inner loop for today)
    """
    log("─" * 40)
    log("STEP 7 — Publish Batch")
    log("─" * 40)
    state["step"]       = "publishing"
    state["step_label"] = "Publishing scheduled shorts to YouTube..."

    settings   = read_hub_settings()
    vid_count  = settings.get("publish_batch_count", 50)

    try:
        # ── Set batch publish mode ────────────────────────────────────────────
        r = await client.post(
            f"{LAUNCHER_BASE}/launcher/publisher/settings",
            json={
                "PROCESS_SINGLE_VIDEO": False,
                "ENABLE_SCRAPING_MODE": False,
                "ENABLE_ANALYSIS_MODE": False,
                "ENABLE_UPLOAD_MODE":   False,
                "VIDEOS_TO_PROCESS_COUNT": vid_count,
            },
        )
        if not r.is_success:
            log(f"❌ Could not set publisher settings (HTTP {r.status_code})")
            return False, False, False
        log(f"✅ Publisher set to Batch mode ({vid_count} videos)")

        # ── Start publisher ───────────────────────────────────────────────────
        r = await client.post(
            f"{LAUNCHER_BASE}/launcher/services/youtube_publisher/start"
        )
        if not r.is_success:
            log(f"❌ Could not start publisher (HTTP {r.status_code})")
            return False, False, False

        log("✅ Publish batch started — watching for completion...")
        await asyncio.sleep(5)

        log_cursor = 0
        check = 0
        while True:  # run until done marker, error, or user stops
            await asyncio.sleep(10)
            check += 1
            if not state["running"]:
                await client.post(f"{LAUNCHER_BASE}/launcher/services/youtube_publisher/stop")
                return False, False, False
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

                    combined = " ".join(new_lines).lower()

                    # API limit check
                    if any(m.lower() in combined for m in API_LIMIT_MARKERS):
                        log("⚠️ API limit detected — stopping publish loop for today")
                        await client.post(
                            f"{LAUNCHER_BASE}/launcher/services/youtube_publisher/stop"
                        )
                        await asyncio.sleep(2)
                        return False, False, True

                    # No more drafts
                    if any(m in line for line in new_lines for m in NO_DRAFTS_MARKERS):
                        log("ℹ️ No more drafts to publish — stopping inner loop")
                        await client.post(
                            f"{LAUNCHER_BASE}/launcher/services/youtube_publisher/stop"
                        )
                        await asyncio.sleep(2)
                        return True, True, False

                    # Batch complete (more may exist — caller decides whether to re-run)
                    if any(m in line for line in new_lines for m in DONE_MARKERS):
                        log("✅ Publish batch complete — stopping publisher...")
                        await client.post(
                            f"{LAUNCHER_BASE}/launcher/services/youtube_publisher/stop"
                        )
                        await asyncio.sleep(2)
                        return True, False, False

                    # Hard error
                    if any(m in line for line in new_lines for m in ERROR_MARKERS):
                        log("❌ Publisher hit a critical error")
                        await client.post(
                            f"{LAUNCHER_BASE}/launcher/services/youtube_publisher/stop"
                        )
                        return False, False, False

                # Natural exit fallback
                r2 = await client.get(f"{LAUNCHER_BASE}/launcher/services")
                if r2.is_success:
                    svcs = r2.json()
                    svc  = next((s for s in svcs if s["id"] == "youtube_publisher"), None)
                    if svc and svc["status"] == "offline":
                        log("✅ Publisher exited naturally")
                        return True, False, False

            except Exception as e:
                log(f"   ⚠️ Poll error: {e} — retrying...")

        log("⚠️ Publish batch loop exited unexpectedly")
        await client.post(f"{LAUNCHER_BASE}/launcher/services/youtube_publisher/stop")
        return False, False, False

    except Exception as e:
        log(f"❌ Publish batch step error: {e}")
        import traceback
        log(traceback.format_exc())
        return False, False, False