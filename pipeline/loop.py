"""
Main pipeline loop.

Each outer iteration is one "session" — a full drain of the backlog:
  1. Scan the SMB drive once.
  2. Inner loop: process up to 3 files, repeat immediately until nothing
     new remains. Only then enter the 1-hour wait.

This means if 12 files arrive overnight the pipeline will run
scan → 3 files → 3 files → 3 files → 3 files → done → wait 1hr,
rather than drip-feeding 3 files per hour.
"""

import asyncio
import time

from pipeline.state    import state, log, history, runs, load_history, save_history
from pipeline.client   import get_client
from pipeline.settings import get_new_files, read_inventory
from pipeline.steps.scanner   import run_scanner
from pipeline.steps.subtitler import run_subtitler

HOURLY_INTERVAL = 3600  # seconds


async def pipeline_loop() -> None:
    load_history()

    while state["running"]:
        cycle_start      = time.time()
        cycle_processed  = 0
        cycle_errors: list = []

        log("═" * 50)
        log(f"🚀 Auto-Run cycle — {time.strftime('%Y-%m-%d %H:%M:%S')}")
        log("═" * 50)

        client = await get_client()

        # ── Step 1: Scan once per hourly cycle ────────────────────────────────
        scan_ok = await run_scanner(client)
        if not scan_ok:
            cycle_errors.append("Scanner failed — see log for details")

        # ── Step 2: Drain loop — keep processing until nothing remains ────────
        batch_num = 0
        while state["running"]:
            new_files = get_new_files()

            if not new_files:
                if batch_num == 0:
                    log("ℹ️ No new files to process this cycle")
                else:
                    log(f"✅ Drain complete — all new files processed ({cycle_processed} total)")
                break

            batch_num += 1
            log(f"─── Batch {batch_num} ({len(new_files)} file(s)) ───")

            process_ok = await run_subtitler(client, new_files)

            if process_ok:
                ts = time.strftime("%Y-%m-%d %H:%M:%S")
                for filename, _ in new_files:
                    history[filename] = ts
                save_history()
                cycle_processed += len(new_files)
                log(f"📝 Batch {batch_num} saved to history — {cycle_processed} processed so far")
            else:
                err = f"Batch {batch_num} failed in SimpleAutoSubs — see log"
                cycle_errors.append(err)
                log(f"⚠️ {err} — stopping drain to avoid loop")
                break   # don't retry a failed batch endlessly

        # ── Record the completed cycle ────────────────────────────────────────
        state["errors"] = cycle_errors
        runs.insert(0, {
            "timestamp":          time.strftime("%Y-%m-%d %H:%M:%S"),
            "files_in_inventory": len(read_inventory()),
            "files_processed":    cycle_processed,
            "errors":             list(cycle_errors),
            "duration_s":         int(time.time() - cycle_start),
        })
        if len(runs) > 20:
            runs.pop()

        state["last_run_at"]    = time.strftime("%H:%M:%S")
        state["last_run_files"] = cycle_processed

        if not state["running"]:
            break

        # ── Hourly wait — only reached when the backlog is empty ──────────────
        state["step"]         = "waiting"
        state["step_label"]   = "Waiting for next hourly scan..."
        state["next_scan_at"] = time.time() + HOURLY_INTERVAL
        next_ts = time.strftime("%H:%M:%S", time.localtime(state["next_scan_at"]))
        log(f"💤 Backlog clear. Next scan at {next_ts}")

        for _ in range(HOURLY_INTERVAL):
            if not state["running"]:
                break
            await asyncio.sleep(1)

    state["step"]         = "idle"
    state["step_label"]   = "—"
    state["next_scan_at"] = None
    log("⏹ Auto-Run stopped")