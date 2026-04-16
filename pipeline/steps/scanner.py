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
        r = await client.post(
            f"{launcher_base}/launcher/services/backtrack_scanner/start"
        )
        if not r.is_success:
            log(f"❌ Could not start scanner (HTTP {r.status_code})")
            return False

        log("✅ Scanner started — waiting for it to finish...")
        await asyncio.sleep(3)

        for _ in range(60):
            await asyncio.sleep(3)
            r2 = await client.get(f"{launcher_base}/launcher/services")
            if r2.is_success:
                svcs = r2.json()
                svc  = next((s for s in svcs if s["id"] == "backtrack_scanner"), None)
                if svc and svc["status"] == "offline":
                    log("✅ Scanner completed successfully")
                    return True

        log("⚠️ Scanner did not finish within 3 minutes")
        return False

    except Exception as e:
        log(f"❌ Scanner step error: {e}")
        return False