import asyncio
from pipeline.state import state, log

async def run_scanner(client) -> bool:
    log("─" * 40)
    log("STEP 1 — Backtrack Scan (DIRECT MODE)")
    log("─" * 40)
    state["step"]       = "scanning"
    state["step_label"] = "Scanning SMB drive for new recordings..."

    try:
        from launcher import start_service, _proc_alive

        log("🔍 Triggering scanner directly (bypassing network)...")
        res = await start_service("backtrack_scanner")
        
        if not res.get("ok"):
            if res.get("reason") == "already_running":
                log("⚠️ Scanner is already running — attaching to existing process...")
            else:
                log(f"❌ Could not start scanner: {res.get('reason')}")
                return False

        log("✅ Scanner running — waiting for it to finish...")
        await asyncio.sleep(3)

        for _ in range(60):
            await asyncio.sleep(3)
            alive = _proc_alive("backtrack_scanner")
            if not alive:
                log("✅ Scanner completed successfully")
                return True

        log("⚠️ Scanner did not finish within 3 minutes")
        return False

    except Exception as e:
        log(f"❌ Scanner step error: {e}")
        return False