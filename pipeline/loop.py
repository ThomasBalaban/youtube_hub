"""
Main pipeline loop — full automation cycle:

  1. Scan SMB drive once.
  2. Drain loop — SimpleAutoSubs until backlog is clear.
  3. If backlog was already clear this cycle:
       a. Upload processed videos to YouTube.
       b. Check unuploaded / cleanup local files.
       c. Publish inner loop — repeat until no drafts or API limit:
            i.  Scraper  — refresh draft/scheduled data
            ii. Analyzer — AI analysis of new drafts
            iii.Publish batch — schedule to YouTube
  4. Hourly wait.

The publish inner loop keeps going until:
  - No more analyzed drafts are found (clean stop)
  - An API quota / rate limit error is detected (stop for today)
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

HOURLY_INTERVAL = 3600  # seconds


async def pipeline_loop() -> None:
    load_history()

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

        # ── Step 2: Drain SimpleAutoSubs ─────────────────────────────────────
        batch_num = 0
        while state["running"]:
            new_files = get_new_files()
            if not new_files:
                if batch_num == 0:
                    log("ℹ️ No new files to process this cycle")
                else:
                    log(f"✅ Drain complete — {cycle_processed} file(s) processed")
                break

            batch_num += 1
            log(f"─── SimpleAutoSubs batch {batch_num} ({len(new_files)} file(s)) ───")
            process_ok = await run_subtitler(client, new_files)

            if process_ok:
                ts = time.strftime("%Y-%m-%d %H:%M:%S")
                for filename, _ in new_files:
                    history[filename] = ts
                save_history()
                cycle_processed += len(new_files)
                log(f"📝 Batch {batch_num} saved — {cycle_processed} total this cycle")
            else:
                err = f"SimpleAutoSubs batch {batch_num} failed — see log"
                cycle_errors.append(err)
                log(f"⚠️ {err} — stopping drain")
                break

        # ── Steps 3–7: only when backlog is fully clear ───────────────────────
        if state["running"] and cycle_processed == 0:
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
            # Scrape → Analyze → Publish Batch, repeat until done or API limit
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
                    log("⚠️ API limit hit — stopping publish loop")
                    break
                if not analyze_ok:
                    cycle_errors.append(f"Analyzer failed on round {publish_round}")
                    log("⚠️ Analyzer failed — stopping publish loop")
                    break

                # Step 7: Publish Batch
                pub_ok, no_drafts, api_limit = await run_publish_batch(client)
                if api_limit:
                    cycle_errors.append("YouTube API limit hit — stopping for today")
                    log("⚠️ API limit hit — stopping publish loop")
                    break
                if no_drafts:
                    log("✅ No more drafts to publish — publish loop complete")
                    break
                if not pub_ok:
                    cycle_errors.append(f"Publish batch failed on round {publish_round}")
                    log("⚠️ Publish batch failed — stopping publish loop")
                    break

                log(f"✅ Round {publish_round} complete — checking for more drafts...")

        elif cycle_processed > 0:
            log(
                f"ℹ️ {cycle_processed} file(s) processed — "
                "skipping upload/publish until backlog is fully clear"
            )

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

        # ── Hourly wait ───────────────────────────────────────────────────────
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