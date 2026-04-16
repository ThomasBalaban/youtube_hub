import httpx

from pipeline.state  import state, log
from pipeline.config import LAUNCHER_BASE


async def run_check_unuploaded(client: httpx.AsyncClient) -> bool:
    log("─" * 40)
    log("STEP 4 — Check Unuploaded / Cleanup")
    log("─" * 40)
    state["step"]       = "checking"
    state["step_label"] = "Auditing uploads and cleaning up local files..."

    try:
        log("▶ Running check_unuploaded script...")
        r = await client.post(
            f"{LAUNCHER_BASE}/launcher/publisher/check-unuploaded",
            timeout=120.0,
        )

        if not r.is_success:
            log(f"❌ check-unuploaded endpoint failed (HTTP {r.status_code})")
            return False

        data   = r.json()
        output = data.get("output", "(no output)").strip()

        for line in output.splitlines():
            log(f"  [CU] {line}")

        if data.get("ok"):
            log("✅ Check unuploaded complete")
            return True
        else:
            log("⚠️ check_unuploaded script exited with non-zero status")
            return False

    except Exception as e:
        log(f"❌ Check unuploaded step error: {e}")
        import traceback
        log(traceback.format_exc())
        return False