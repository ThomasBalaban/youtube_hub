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

## Strategist support (added 2026-10-24)

- [ ] **Wire scout feed into the thinker** — shorts_scout writes
      `shorts_scout/output/strategist_feed.json` (game heat, market
      technique trends incl. audio-craft rates, exemplars). Feed it into
      the scorecard + capability_gaps prompts (hash the feed's
      generated_at so staleness is controlled), so gaps become market-
      grounded ("71% of outliers use punchline SFX; we're at 0%") and
      game recommendations surface. Scout itself shipped 2026-10-24.
- [ ] **Deliberate experiment management** — register planned experiments
      (cadence A/B, captions slice, knob splits) as ledger objects with
      hypothesis + settings + measure-when, auto-evaluated at harvest,
      instead of hand-run via to-do notes. (The strategist should already
      be doing this.)
- [ ] **Wider outcome signals** — pull retention curves, impressions/CTR,
      and comment sentiment per video_id into the outcomes table; views
      alone can't say WHERE viewers leave. (Likewise should already exist.)
- [ ] **Mission-control surface** — the strategist's beliefs, ledger,
      directives and harvest history, visible in the hub instead of JSON
      artifacts; plus human talk-back (flag confounds like the
      age-restricted video, veto/endorse directives, rate cuts).

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
