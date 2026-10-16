# TODO

- [ ] Auto-run items when Twitch starts / stops.

## Editor roadmap (added 2026-10-12, while awaiting first experiment outcomes)

- [ ] **New editing primitives as experiment arms** — each toggleable,
      default OFF, so Phase 4/5 can score them on a batch slice:
      arrow/annotation overlay (capability-gaps #1, 5x lift on weak n),
      punch-in + micro-freeze on the punchline (uses trim punch_point),
      speed-ramp into the punch, caption-style variant slice.
- [ ] Deferred Phase 2 cost items: batch the onomatopoeia/director vision
      calls (dozens per clip today); one Gemini upload per cut (planner and
      trimmer currently upload the same video separately).
- [ ] **(Low priority) Voice fingerprinting for mixed-audio mode** — the
      dominant-speaker heuristic picks whoever talks most in the clip, which
      misattributed a chatty friend as the streamer (seen 2026-10-15). Fix:
      match diarized speakers against the streamer's voice from prior clips
      instead of per-clip word counts. Low priority because in a proper
      recording setup friends don't share the streamer's mic track.

## Done

- [x] Tunability (`effects_settings`) — 8 fx_* knobs, hub "Advanced Tuning"
      section, stamped into metadata; plus Thinker Tuning opt-in overlay
      (Phase 6) fed by the strategist's effects_tuning task. (2026-10-15)
- [x] Mixed-audio rescue mode — diarization splits the mic line (dominant
      speaker → mic transcript, friends + real game track → desktop);
      works for shared mic lines and fully-mixed recordings. (2026-10-15)
- [x] Clean render pipeline v2 — single-pass multi-track trim, stream-copy
      zoom concat with intact source audio, duration guard, CRF 18.
      (2026-10-14/15)
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
