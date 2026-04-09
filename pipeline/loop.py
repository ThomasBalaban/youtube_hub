"""
Main pipeline loop — runs immediately then every hour.
Imports steps from the steps sub-package so adding new steps is just
adding a new file and calling it here.
"""

import asyncio
import time

from pipeline.state   import state, log, history, runs, load_history, save_history
from pipeline.client  import get_client
from pipeline.settings import get_new_files, read_inventory
from pipeline.steps.scanner   import run_scanner
from pipeline.steps.subtitler import run_subtitler

HOURLY_INTERVAL = 3600  # seconds


async def pipeline_loop() -> None:
    """Immediate run then 1-hour loop until state["running"] is False."""
    load_history()

    while state["running"]:
        state["errors"] = []
        run_start       = time.time()
        files_processed = 0

        log("═" * 50)
        log(f"🚀 Auto-Run cycle — {time.strftime('%Y-%m-%d %H:%M:%S')}")
        log("═" * 50)

        client = await get_client()

        # ── Step 1: Scan ──────────────────────────────────────────────────────
        scan_ok = await run_scanner(client)
        if not scan_ok:
            state["errors"].append("Scanner failed — see log for details")

        # ── Step 2: Find new files ────────────────────────────────────────────
        new_files = get_new_files()

        if not new_files:
            log("ℹ️ No new files to process this cycle")
        else:
            # ── Step 3: Process ───────────────────────────────────────────────
            process_ok = await run_subtitler(client, new_files)

            if process_ok:
                ts = time.strftime("%Y-%m-%d %H:%M:%S")
                for filename, _ in new_files:
                    history[filename] = ts
                save_history()
                files_processed = len(new_files)
                log(f"📝 Saved {files_processed} file(s) to pipeline history")
            else:
                state["errors"].append("SimpleAutoSubs processing failed — see log")

        # ── Record the run ────────────────────────────────────────────────────
        runs.insert(0, {
            "timestamp":        time.strftime("%Y-%m-%d %H:%M:%S"),
            "files_in_inventory": len(read_inventory()),
            "files_processed":  files_processed,
            "errors":           list(state["errors"]),
            "duration_s":       int(time.time() - run_start),
        })
        if len(runs) > 20:
            runs.pop()

        state["last_run_at"]    = time.strftime("%H:%M:%S")
        state["last_run_files"] = files_processed

        if not state["running"]:
            break

        # ── Wait for next cycle ───────────────────────────────────────────────
        state["step"]         = "waiting"
        state["step_label"]   = "Waiting for next hourly scan..."
        state["next_scan_at"] = time.time() + HOURLY_INTERVAL
        next_ts = time.strftime("%H:%M:%S", time.localtime(state["next_scan_at"]))
        log(f"💤 Cycle done. Next scan at {next_ts}")

        for _ in range(HOURLY_INTERVAL):
            if not state["running"]:
                break
            await asyncio.sleep(1)

    state["step"]         = "idle"
    state["step_label"]   = "—"
    state["next_scan_at"] = None
    log("⏹ Auto-Run stopped")
