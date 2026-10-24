# TODO

- [ ] Auto-run items when Twitch starts / stops.
- [ ] **Cadence A/B** (added 2026-10-24): schedule one upload batch at
      2/day for a week, then 4/day for a week (Daily Post Times), and
      compare absolute views-per-video at equal age. Breakout scores are
      channel-median-relative so uniform volume suppression is invisible —
      this is the only way to answer "is 4/day hurting reach?".
      Side-finding from the Oct 22 harvest, worth folding in: the LAST
      slot of the day strongly outperforms (median 1.61 vs 0.86-1.04
      earlier slots) and same-day siblings LIFT each other (hit days:
      siblings 1.55 vs 0.66 on no-hit days) — consider weighting slots
      toward evening regardless of cadence outcome.

## Editor roadmap (added 2026-10-12, while awaiting first experiment outcomes)

- [ ] **Remaining editing primitives**: arrow/annotation overlay (needs
      semantic target placement — the capability-gaps critic says prototype
      manually first), speed-ramp into the punch (blocked: time manipulation
      desyncs subtitles / events / zoom timelines — needs a timing-remap
      layer), caption-style variant slice (moot while subtitles are off
      channel-wide). NOTE: punch-freeze was built 2026-10-16 and
      human-vetoed same day — a bare frame-hold reads as lag; don't rebuild
      without a visual treatment that signals intent.
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
