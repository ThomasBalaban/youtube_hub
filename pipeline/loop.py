"""
Main pipeline loop — full automation cycle:

  1. Scan SMB drive once.
  2. Collect ALL new files from inventory in one snapshot.
  3. Send all files to SimpleAutoSubs and wait until every file is done.
  4. Once processing is complete (or if there was nothing to process):
       a. Upload processed videos to YouTube.
       b. Check unuploaded / cleanup local files.
       c. Publish inner loop — repeat until no drafts or API limit:
            i.  Scraper  — refresh draft/scheduled data
            ii. Analyzer — AI analysis of new drafts
            iii.Publish batch — schedule to YouTube
  5. 5-minute wait before next scan.

Key behaviour:
  - ALL new files are snapshotted immediately after the scanner exits,
    before cluster-cleanup can trash duplicates and confuse the inventory
    check. The old per-batch drain loop caused files to be mis-marked as
    "deleted" on the second get_new_files() call.
  - Upload/publish runs whenever processing is clear — including cycles
    where files were processed this cycle.
  - Upload/publish is only skipped if SAS actually errored, or the pipeline
    was stopped mid-cycle.
  - The publish inner loop keeps going until:
      - No more analyzed drafts found (clean stop)
      - API quota / rate limit hit (stop for today)
      - A hard error occurs (stop for safety)
"""

import asyncio
import time

from pipeline.state    import state, log, history, runs, load_history, save_history
from pipeline.client   import get_client
from pipeline.settings import get_new_files, read_inventory
from pipeline.steps.scanner          import run_scanner
from pipeline.steps.subtitler        import run_subtitler
from pipeline.steps.uploader         import run_uploader
from pipeline.steps.check_unuploaded import run_check_unuploaded
from pipeline.steps.scraper          import run_scraper
from pipeline.steps.analyzer         import run_analyzer
from pipeline.steps.publish_batch    import run_publish_batch

SCAN_INTERVAL = 300  # 5 minutes


async def pipeline_loop() -> None:
    load_history()

    # Give uvicorn time to finish binding to the port before we make
    # HTTP calls back to the launcher. Needed when the pipeline is
    # auto-started by the director UI at the same moment the launcher boots.
    log("⏳ Waiting for launcher to be ready...")
    await asyncio.sleep(5)
    log("✅ Starting pipeline")

    while state["running"]:
        cycle_start     = time.time()
        cycle_processed = 0
        cycle_errors: list = []

        log("═" * 50)
        log(f"🚀 Auto-Run cycle — {time.strftime('%Y-%m-%d %H:%M:%S')}")
        log("═" * 50)

        client = await get_client()

        # ── Step 1: Scan ──────────────────────────────────────────────────────
        scan_ok = await run_scanner(client)
        if not scan_ok:
            cycle_errors.append("Scanner failed — see log for details")

        # ── Step 2: Process ALL new files through SimpleAutoSubs ──────────────
        # Snapshot new files immediately after the scanner exits, before
        # cluster-cleanup can trash duplicates and cause a second call to
        # get_new_files() to mis-mark those files as "deleted".
        drain_failed = False
        new_files = get_new_files()

        if not new_files:
            log("ℹ️ No new files to process this cycle")
        else:
            log(f"─── SimpleAutoSubs ({len(new_files)} file(s)) ───")
            for filename, path in new_files:
                log(f"   • {filename}")

            process_ok = await run_subtitler(client, new_files)

            if process_ok:
                ts = time.strftime("%Y-%m-%d %H:%M:%S")
                for filename, _ in new_files:
                    history[filename] = ts
                save_history()
                cycle_processed = len(new_files)
                log(f"✅ All {cycle_processed} file(s) processed and saved to history")
            else:
                err = "SimpleAutoSubs failed — see log"
                cycle_errors.append(err)
                log(f"⚠️ {err}")
                drain_failed = True

        # ── Steps 3–7: Upload + Publish ───────────────────────────────────────
        # Runs whenever processing is complete (or nothing needed processing).
        # Only skipped when SAS errored or the pipeline was stopped.
        backlog_clear = state["running"] and not drain_failed

        if backlog_clear:
            log("ℹ️ Backlog clear — running upload + publish pipeline")

            # ── Step 3: Upload ────────────────────────────────────────────────
            upload_ok = await run_uploader(client)
            if not upload_ok:
                cycle_errors.append("Uploader failed — see log for details")

            # ── Step 4: Check unuploaded / cleanup ────────────────────────────
            check_ok = await run_check_unuploaded(client)
            if not check_ok:
                cycle_errors.append("Check unuploaded failed — see log for details")

            # ── Steps 5–7: Publish inner loop ─────────────────────────────────
            # Scrape → Analyze → Publish Batch, repeat until done or API limit.
            publish_round = 0
            while state["running"]:
                publish_round += 1
                log(f"═══ Publish round {publish_round} ═══")

                # Step 5: Scraper
                scrape_ok = await run_scraper(client)
                if not scrape_ok:
                    cycle_errors.append(f"Scraper failed on round {publish_round}")
                    log("⚠️ Scraper failed — stopping publish loop")
                    break

                # Step 6: AI Analysis
                analyze_ok, api_limit = await run_analyzer(client)
                if api_limit:
                    cycle_errors.append("Gemini API limit hit — stopping for today")
                    log("⚠️ Gemini API limit hit — stopping publish loop")
                    break
                if not analyze_ok:
                    cycle_errors.append(f"Analyzer failed on round {publish_round}")
                    log("⚠️ Analyzer failed — stopping publish loop")
                    break

                # Step 7: Publish Batch
                pub_ok, no_drafts, api_limit = await run_publish_batch(client)
                if api_limit:
                    cycle_errors.append("YouTube API limit hit — stopping for today")
                    log("⚠️ YouTube API limit hit — stopping publish loop")
                    break
                if no_drafts:
                    log("✅ No more drafts to publish — publish loop complete")
                    break
                if not pub_ok:
                    cycle_errors.append(f"Publish batch failed on round {publish_round}")
                    log("⚠️ Publish batch failed — stopping publish loop")
                    break

                log(f"✅ Round {publish_round} complete — checking for more drafts...")

        elif drain_failed:
            log("⚠️ SAS processing failed — skipping upload/publish until next cycle")

        # ── Record the cycle ──────────────────────────────────────────────────
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

        # ── 5-minute wait ─────────────────────────────────────────────────────
        # Checks for a stop signal every second so the pipeline can be halted
        # immediately without waiting out the full interval.
        state["step"]         = "waiting"
        state["step_label"]   = "Waiting for next scan..."
        state["next_scan_at"] = time.time() + SCAN_INTERVAL
        next_ts = time.strftime("%H:%M:%S", time.localtime(state["next_scan_at"]))
        log(f"💤 Cycle done. Next scan at {next_ts}")

        for _ in range(SCAN_INTERVAL):
            if not state["running"]:
                break
            await asyncio.sleep(1)

    state["step"]         = "idle"
    state["step_label"]   = "—"
    state["next_scan_at"] = None
    log("⏹ Auto-Run stopped")