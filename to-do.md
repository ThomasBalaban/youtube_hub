# TODO

- [ ] Auto-run items when Twitch starts / stops.

## Editor roadmap (added 2026-10-12, while awaiting first experiment outcomes)

- [ ] **Remaining editing primitives** (punch-freeze shipped 2026-10-16):
      arrow/annotation overlay (needs semantic target placement — the
      capability-gaps critic says prototype manually first), speed-ramp
      into the punch (blocked: time manipulation desyncs subtitles /
      events / zoom timelines — needs a timing-remap layer), caption-style
      variant slice (moot while subtitles are off channel-wide).
- [ ] **(Low priority) Voice fingerprinting for mixed-audio mode** — the
      dominant-speaker heuristic picks whoever talks most in the clip, which
      misattributed a chatty friend as the streamer (seen 2026-10-15). Fix:
      match diarized speakers against the streamer's voice from prior clips
      instead of per-clip word counts. Low priority because in a proper
      recording setup friends don't share the streamer's mic track.

## Loose ends from the migration

- The old per-project `config.json` files still exist and still contain copies
  of the keys (`shorts_analyzer/config.json`, `shorts_strategist/config.json`,
  `shorts-auto-editor/utils/config.json`). Nothing reads them anymore — safe to
  delete after a full smoke test confirms the apps still work.
