"""
Pipeline step 4: Check Unuploaded.
Calls the existing launcher endpoint which runs check_unuploaded.py as a
subprocess. That script audits the output folder against uploaded_files.json
and sends confirmed-uploaded files to the Trash automatically.
"""

import httpx

from pipeline.state import state, log

LAUNCHER_BASE = "http://localhost:8010"


async def run_check_unuploaded(client: httpx.AsyncClient) -> bool:
    log("─" * 40)
    log("STEP 4 — Check Unuploaded / Cleanup")
    log("─" * 40)
    state["step"]       = "checking"
    state["step_label"] = "Auditing uploads and cleaning up local files..."

    try:
        log("▶ Running check_unuploaded script...")
        # This endpoint runs the script synchronously and returns stdout.
        # Timeout is generous — the script itself is fast but we give 2 minutes
        # in case the folder is large.
        r = await client.post(
            f"{LAUNCHER_BASE}/launcher/publisher/check-unuploaded",
            timeout=120.0,
        )

        if not r.is_success:
            log(f"❌ check-unuploaded endpoint failed (HTTP {r.status_code})")
            return False

        data   = r.json()
        output = data.get("output", "(no output)").strip()

        # Forward each line into the pipeline log
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