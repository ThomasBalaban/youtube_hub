import asyncio
import httpx

from pipeline.state  import state, log
from pipeline.config import get_launcher_base


async def run_scanner(client: httpx.AsyncClient) -> bool:
    log("─" * 40)
    log("STEP 1 — Backtrack Scan")
    log("─" * 40)
    state["step"]       = "scanning"
    state["step_label"] = "Scanning SMB drive for new recordings..."

    launcher_base = get_launcher_base()

    try:
        log("🔍 Starting scanner via launcher...")
        r = await client.post(
            f"{launcher_base}/launcher/services/backtrack_scanner/start"
        )

        if not r.is_success:
            log(f"❌ Could not start scanner (HTTP {r.status_code})")
            return False

        data = r.json()
        if not data.get("ok"):
            reason = data.get("reason", "unknown")
            if reason == "already_running":
                log("⚠️ Scanner is already running — attaching to existing process...")
            else:
                log(f"❌ Could not start scanner: {reason}")
                return False

        log("✅ Scanner started — waiting for it to finish...")
        await asyncio.sleep(3)

        # Poll up to 3 minutes for the scanner to go offline (run-and-exit)
        for _ in range(60):
            await asyncio.sleep(3)
            if not state["running"]:
                log("⏹ Pipeline stopped — abandoning scanner wait")
                return False
            try:
                r2 = await client.get(f"{launcher_base}/launcher/services", timeout=10.0)
                if r2.is_success:
                    svcs = r2.json()
                    svc = next((s for s in svcs if s["id"] == "backtrack_scanner"), None)
                    if svc and svc["status"] == "offline":
                        log("✅ Scanner completed successfully")
                        return True
            except Exception as poll_err:
                log(f"   ⚠️ Poll error: {poll_err} — retrying...")

        log("⚠️ Scanner did not finish within 3 minutes")
        return False

    except Exception as e:
        log(f"❌ Scanner step error: {e}")
        import traceback
        log(traceback.format_exc())
        return False