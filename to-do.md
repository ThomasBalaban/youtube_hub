# TODO

- [ ] Auto-run items when Twitch starts / stops.

## Editor roadmap (added 2026-10-12, while awaiting first experiment outcomes)

- [x] **Tunability (`effects_settings`)** (done 2026-10-15) — pull hardcoded editor knobs
      (zoom intensity, onomatopoeia density, pacing aggressiveness) into a
      hub-editable settings block, stamped into metadata. Prerequisite for
      MISSION Phase 6 (concluded experiments changing editor defaults with
      provenance), and enables deliberate batch-split experiments.
- [ ] **New editing primitives as experiment arms** — each toggleable,
      default OFF, so Phase 4/5 can score them on a batch slice:
      arrow/annotation overlay (capability-gaps #1, 5x lift on weak n),
      punch-in + micro-freeze on the punchline (uses trim punch_point),
      speed-ramp into the punch, caption-style variant slice.
- [x] **Mixed-audio rescue mode** (done 2026-10-15) — use gemini-3.5-transcribe speaker
      diarization to keep only the dominant speaker as the mic transcript
      on fully-mixed recordings; unshelves the series that has no separate
      audio tracks.
- [ ] Deferred Phase 2 cost items: batch the onomatopoeia/director vision
      calls (dozens per clip today); single filter_complex trim/concat with
      one continuous audio encode (fixes clicks at jump cuts).

## Done

- [x] Centralize API keys in `youtube_hub/config/secrets.json` and migrate
      sibling apps (`shorts_analyzer`, `shorts_strategist`, `shorts-auto-editor`,
      `youtube_shorts_publisher`) to read from `shared_secrets.py`.
- [x] Centralize YouTube OAuth (client_secret + tokens) under
      `youtube_hub/config/oauth/`. Analyzer analytics + publisher draft scanner
      now resolve their paths via `shared_secrets.get_oauth_*`.

## Loose ends from the migration

- The old per-project `config.json` files still exist and still contain copies
  of the keys (`shorts_analyzer/config.json`, `shorts_strategist/config.json`,
  `shorts-auto-editor/utils/config.json`). Nothing reads them anymore — safe to
  delete after a full smoke test confirms the apps still work.
