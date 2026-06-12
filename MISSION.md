# MISSION — the self-improving shorts pipeline

## North star

**The shorts editor gets better the more the thinker understands about the
shorts it has generated and how they perform on YouTube.**

Every short the editor cuts is a data point. The thinker (shorts_strategist)
should accumulate an ever-richer picture of *which editorial decisions* —
trims, hooks, zoom cadence, onomatopoeia, titles — correlate with breakout
performance on the channel, and feed that back as:

1. better per-cut directives (the iteration loop, already live),
2. better channel-level patterns (title patterns / scorecard, already live),
3. **deliberate experiments** — when the operator batches 10+ videos, the
   thinker picks a few test-worthy shorts, assigns each a hypothesis and an
   expected outcome, records the assignment in a ledger, and later scores
   the prediction against real YouTube analytics. Past experiments inform
   future ones. This is the piece that turns passive correlation into
   active learning, and it is **not built yet**.

This file is the map for that mission. Sibling docs:
- `shorts-auto-editor/gameplan.md` — analyzer integration (Phases 0–1 shipped)
- `shorts_strategist/gameplan.md` — thinker architecture + iteration loop (shipped)
- `shorts_strategist/output-contract.md` — downstream consumer contract

## QA posture (read this before adding tests)

There is no automated test suite in this pipeline, **by choice**. The output
is a creative artifact: the operator live-tests on YouTube and human-reviews
every rendered video. That is the test harness.

The consequence: the pipeline's *written record of itself* must be honest.
A human reviewer catches a bad video; nothing catches a metadata file that
describes trims and zooms that were never rendered. Every "silent fallback"
that ships a degraded video while writing optimistic metadata poisons both
the human review (the file looks fine in the queue) and the learning loop
(the thinker correlates performance with edits that don't exist). So instead
of unit tests, we invest in:

- **status flags** — every phase records whether it actually ran
  (`trim_applied`, `render_status`, `shipped_without_review`, …),
- **decision capture** — every LLM/heuristic decision, including what was
  *rejected*, lands in `shorts_metadata_N.json`,
- **loud failures** — catastrophic fallbacks (shipping raw uncut input)
  must be unmissable in the hub, not discovered in the output folder.

## Where we are today (June 2026)

**Wired and working:**
- Editor → strategist iteration loop (up to 3 cuts per video, edit directives
  applied via pre-baked replay) — `shorts-auto-editor/core/iteration_loop.py`
- Strategist title recs consumed **by the publisher** at upload time
  (`youtube_shorts_publisher/publisher/strategist_client.py:124-145`) — note:
  the strategist gameplan still calls this the "highest-leverage remaining"
  unlock; that is stale. What's actually missing is *recording which title
  shipped* (see Phase 3).
- Analyzer synthesis feeding title generation; channel scorecard, title
  patterns, capability gaps all producing artifacts.

**The three missing spines** (everything in this mission hangs off these):

1. **A trustworthy record.** Today metadata can claim trims that failed
   (`core/video_processor.py:284-286`), zooms that silently fell back to
   plain segments (`ai_director/video_editor.py:195-200`), and a subtitle-
   embed failure ships the raw *untrimmed* recording as "the short"
   (`core/subtitle_embedder.py:99` → catch-all at
   `core/video_processor.py:539-544`). Phase 1 fixes this.

2. **Identity.** No `cut_id`, no `batch_id`, no `video_id` anywhere in the
   editor's metadata. The strategist's outcome-join tables exist and are
   empty (`shorts_strategist/strategist/strategy.py` — 0 rows). The only
   cut→published-video link is the publisher's lossy filename heuristic
   (`strategist_client.py:47-57`). Without identity, an experiment ledger
   can never have its "result" column filled. Phase 3 fixes this.

3. **Batch awareness.** The editor's `/process` API and metadata have no
   concept of "these 12 videos were processed together." The experiment
   assigner needs to see a batch as a unit. Phase 4 adds it (small: stamp
   the session timestamp the api_server already generates at
   `shorts-auto-editor/api_server.py:187` into each video's `file_info`).

---

## Phase 1 — Editor: make the record trustworthy (do first)

These corrupt the learning signal and/or ship bad videos silently. In
leverage order:

1. **Metadata claims unapplied edits.** When `apply_trim` fails the pipeline
   ships the full source but still writes the planned segments into
   `trim_segments_kept` (`core/video_processor.py:284-286, 449-456`). Zoom
   render failures silently degrade (plain segment / whole-input copy /
   first-segment-only — `ai_director/video_editor.py:195-200, 308-312,
   338-341`) with `zoom_timeline` unchanged. Add `trim_applied`,
   per-event `rendered: true|false`, and a top-level `render_status`.
   Make the catastrophic fallbacks (whole-input copy, first-segment-only,
   raw-copy-on-exception) hard failures or loudly flagged.
2. **Transcription crash text ships in the video.** The catch-all returns
   `"0.0-5.0: Transcription error: {e}"` as a transcript line — it renders
   as an animated subtitle in the short and enters the trim prompt as
   dialogue (`core/transcriber.py:497-502`). Return empty and flag.
3. **Non-atomic metadata writes can kill the thinker.** Editor writes
   metadata with plain `open("w")` (`core/iteration_loop.py:791-795`,
   `api_server.py:365-366`, `main.py:427-429`); the strategist's unguarded
   `json.loads` (`strategist/inputs.py:112-119`) sits inside the loop-fatal
   try in `thinker.py` — one torn read stops all reviews until manual
   restart, and the orchestrator then silently ships v1s (this already
   happens in practice: `shorts_metadata_50.json` shipped unreviewed while
   the thinker was down). Fix both sides: tmp + `os.replace` on the editor
   (copy the strategist's own `recommendations.py:134-146`), try/except-skip
   on the strategist.
4. **Strategist LLM failure defaults to `needs_edits`** with empty
   directives and score 0 (`tasks/pre_publish_edit_review.py:751`) — the
   orchestrator re-renders an *identical* video, burning an iteration and
   render time. Live evidence: `shorts_metadata_48.json` iterations 1 and 2
   are byte-identical. Default to `ship_current` (or explicit
   `review_failed`) on generation failure.
5. **Stale/wrong-video directives accepted.** Freshness is mtime-only;
   `iteration_reviewed` and `source_metadata` are in the payload but never
   checked (`core/iteration_loop.py:150-163, 723-749`). Also: if
   `shorts_data/` is ever pruned, a recycled index instantly consumes the
   orphaned directive of a *different video*. Validate both fields.
6. **Shipped videos keep getting re-reviewed.** The finalize rewrite bumps
   the metadata SHA, marking edit-review/title tasks stale on already-
   shipped videos — paid LLM calls for nothing (observed on metadata_48).
   Guard `enumerate_tasks` on `shipped_at` presence.

## Phase 2 — Editor: cut quality + cost (independent wins)

Quality, in impact order:

1. **Trim prompt drops the middle of the transcript.** Word-per-line format
   capped at 200 lines keeps first/last 100 *words* (~80s of speech) —
   longer clips lose exactly the middle (`clip_editor/intelligent_trimmer.py:106-132`),
   while the narrative planner has no cap, so it anchors moments the trimmer
   can't see. Group words into utterances (the transcriber already has the
   grouping at `core/transcriber.py:67-92`) and send phrases to both prompts.
2. **One Gemini upload per cut, not 2-3.** The planner uploads the video,
   deletes it in `finally`, then the trimmer re-uploads the same file
   (`clip_editor/narrative_planner.py:296-300` →
   `intelligent_trimmer.py:236`); the anchor-retry resends inline bytes a
   third time. Share the Files-API URI across both phases.
3. **Batch the vision calls.** One Gemini call per onset group in
   onomatopoeia detection (`onomatopoeia_detector.py:87-97` →
   `llm/gemini_vision_analyzer.py:158-190`) plus a second uncoordinated
   per-beat pass in the director (`ai_director/signals.py:284`, up to 48
   beats) — dozens of calls per clip, none shared. Batch N events per
   request; reuse PHASE 3 analyses for beats within ~1s.
4. **Stop re-encoding 4×.** Trim → per-segment zoom render → concat
   re-encode → subtitle burn each re-encode video (and audio twice). The
   concat re-encode is pure loss (`ai_director/video_editor.py:324-336` —
   segments are already uniform; use `-c copy`); subtitle burn could join
   the zoom filter graph. Also CRF 10 on the final pass
   (`core/subtitle_embedder.py:93`) is wasted bits post-YouTube-transcode.
5. **Mid-word cuts at segment starts.** `extend_segments_for_dialogue` only
   protects segment *ends* (`utils/timestamp_processor.py:236-298`); mirror
   the word-straddle check at starts.
6. **Per-segment AAC + stream-copy concat = clicks/drift at every jump
   cut** (`intelligent_trimmer.py:620-675`). Single `filter_complex`
   trim/concat pass with one continuous audio encode.
7. **`MEDIA_RES_TRIM` (HIGH) is declared and never used**
   (`utils/models.py:52`) — trim/planner vision runs at default resolution
   despite the "details matter" comment. Pass it or delete it.
8. **Word confidence is discarded** before the hallucination filter
   (`core/transcriber.py:150-154`), making every low-confidence branch in
   the filter dead code. Thread `score` through — free quality win.
9. **Onomatopoeia variety machinery is dead.** Every word renders at fixed
   140pt at (540,500) (`animations/core.py:57-59`,
   `utils/subtitle_styles.py:120-123` — min==max margins); energy→size
   scaling has *inverted* constants (`BASE_FONT_SIZE=140, MAX_FONT_SIZE=32`),
   and nothing stops the word landing dead-center on the zoom focus.
   Fix constants, re-enable bounded jitter, offset away from active zoom
   windows.
10. **Subtitle path escaping.** A `'` in a filename breaks the ffmpeg filter
    string (`core/subtitle_embedder.py:64-83`) and — via the catch-all —
    triggers the ship-raw-input fallback. Also no ASS escaping of `{}\`
    in dialogue text (`animations/renderer.py:41,61`).

Tunability (enables Phase 6): zoom factors (1.65/1.55), ramp (60%),
per-kind durations, score threshold (0.55), refractory (1.5s), onset
sensitivity, fusion weights, ono density/spacing, encoder params are all
hardcoded (see `ai_director/video_editor.py:216-244`,
`master_director.py:33-35`, `audio/onset_detector.py:12-26`,
`processing/multimodal_fusion.py:18-20`, `processing/gaming_optimizer.py:11-20`).
Pull into one `effects_settings` dict in `hub_settings.json`, accept
per-event overrides in directives, and **echo the settings used into each
video's `editorial_decisions`** so the thinker can correlate parameter
values with outcomes.

## Phase 3 — Identity: the join key spine

Without this, outcomes can never be attributed. All small changes:

1. **Editor mints `cut_id`** and stamps it in `file_info`. Cheapest viable
   choice: the metadata base key (`shorts_metadata_<N>`) is already unique
   on disk — formalize it. (Strategist gameplan: "the cut_id is canonical
   once it exists.")
2. **Editor stamps `batch_id`** (+ `batch_index`, `batch_size`) — the
   session timestamp from `api_server.py:187` — in both the iteration-loop
   and batch write paths (~10 lines each). Fix the index-collision race
   while in there (GUI + API both scan-then-write `shorts_metadata_<N>`
   with no lock — `main.py:334-343`, `api_server.py:253-260`).
3. **Publisher stamps `video_id` back** after upload. It already resolves
   the base key (`strategist_client.py:96,121`); write `video_id` into the
   metadata file and POST `/strategy/stamp-video-id` (endpoint exists:
   `shorts_strategist/api_server.py:189-205`). The dormant
   `strategy.db` join (`strategy.py:88-109`) wakes up for free.
4. **Record title authorship.** The publisher applies strategist title recs
   at upload but writes nowhere which title shipped (`title_source` is
   computed and dropped). Persist `title_source` +
   `strategist_verdict` into the metadata's `title_provenance` — without it,
   title experiments (the most natural first experiment type) can't be
   evaluated.
5. Fix the latent multi-record batch bug while in this area: the
   non-iteration batch path writes all videos into one metadata file but
   every consumer reads only record [0] (`strategist/inputs.py:84`,
   `tasks/pre_publish_title.py:218`, `tasks/pre_publish_edit_review.py:469`,
   publisher `strategist_client.py:87`). One record per file, always.

## Phase 4 — Thinker: batch experiment assignment (the new feature)

**Trigger.** A new thinker task, `batch_experiment_assignment`, keyed by
`batch_id`, that fires when a batch with `batch_size >= 10` reaches the
strategist with all members shipped (all metadata carry `shipped_at`).

**What it does.** One generate-then-critique pass (Gemini proposes, Claude
critiques — the house pattern) over the whole batch's editorial decisions +
current channel patterns + the experiment ledger:

1. **Select 2–4 test-worthy shorts.** Test-worthiness = the short naturally
   embodies a variation worth isolating (an unusual hook type, an
   onomatopoeia-heavy cut, a strategist-replaced title, a zoom-cadence
   outlier) AND the rest of the batch provides a plausible control group.
   The critic's job: kill assignments with confounds (e.g. the candidate
   also differs on 3 other axes) and undersized contrasts.
2. **Assign each a hypothesis + expectation.** Concrete shape:
   `{cut_id, hypothesis, variable_isolated, expected_outcome (directional +
   magnitude), success_metric, comparison_set (control cut_ids), confidence}`.
   The prompt language can borrow from what already works:
   `capability_gaps`' `experiment_to_validate` and the scorecard's
   `experiment_substrates` both already produce concrete A/B framings.
3. **Write the ledger.** The `experiments` table
   (`strategist/strategy.py:31-40` — hypothesis, arms, success_metric,
   status, conclusion) exists with zero rows and `save_experiment` has no
   callers. Use it as-is: one row per assignment, `status="awaiting_results"`.
   Also write a per-batch artifact
   `output/recommendations/experiments/<batch_id>.json` for the hub UI.
4. **Consult history.** The task's input snapshot includes the ledger —
   past hypotheses, their conclusions, and open experiments — so it doesn't
   re-test settled questions and can escalate (a confirmed weak signal →
   a sharper follow-up test). This is the "keep note of them for other
   potential future tests" requirement, and it's why the ledger is a
   database and not just artifacts.

**What it does NOT do.** Per the standing rule
(`shorts_strategist/gameplan.md` — "the strategist designs experiments; it
does not unilaterally route traffic"), assignments are *labels +
predictions* on cuts that already exist, surfaced to the operator in the
hub. The thinker does not re-edit shorts into arms or change publish
scheduling. If a later phase wants prescriptive experiments ("cut the next
batch's #3 with no onomatopoeia"), that arrives as an operator-visible
suggestion, never an automatic act.

**Retire, don't build on,** the cold `/experiment/design` endpoint
(returns 501 — `api_server.py:220-222`); keep `/experiment/list` as the
read surface. The logic lives in the thinker task registry like everything
else that's load-bearing.

## Phase 5 — Outcome evaluation and memory

Once Phases 3–4 are live, results become computable:

1. **`experiment_evaluation` task** — fires when an experiment's cuts have
   `video_id`s and the analyzer has fresh analytics for them (the
   `video_id` → analyzer-output join already exists in
   `strategist/inputs.py:56-64`). Compares actual vs `expected_outcome`,
   writes `conclusion` + `status="concluded"` to the ledger, and a
   human-readable verdict artifact. Wrong predictions are as valuable as
   right ones — they prune the channel-pattern beliefs that generated them.
2. **Concluded experiments feed the pattern tasks.** `title_pattern_retro`
   and `channel_scorecard` get the ledger in their input snapshot:
   confirmed causal wins get promoted over correlational patterns; refuted
   patterns get demoted even if the correlation persists. This closes the
   loop the scorecard currently can't (it presents competing causal stories
   without resolution — strategist gameplan issue #3; experiments are the
   disambiguator).
3. **Per-published-short postmortems** stay gated to top + bottom quintiles
   (cost posture per strategist gameplan) and now cite experiment evidence
   where it exists.

## Phase 6 — Close the loop: learnings change the editor's defaults

The end state the north star describes: a concluded experiment doesn't just
inform the operator — it moves the editor's behavior.

- Confirmed parameter-level wins (zoom intensity, ono density, hook length)
  flow into `effects_settings` defaults (the Phase 2 tunability work is the
  prerequisite — you can't adjust what's hardcoded).
- Confirmed pattern-level wins flow into the trim/planner/title prompts
  (the strategist's `patterns_to_use` already reaches the title prompt;
  extend the same channel to trim-time guidance).
- The capability manifest moves to editor ownership and is published via an
  endpoint, so `capability_gaps` proposals stay in sync with reality
  automatically (existing unlock point, unchanged).
- Every default changed this way is recorded with the experiment id that
  justified it — provenance all the way down.

## Hard rules (inherited + new)

- **Never crash siblings; degrade gracefully** — unchanged.
- **No fallback titles** — unchanged.
- **The operator is the test harness.** No silent fallbacks: a degraded
  video must be flagged in metadata and visible in the hub queue.
- **`cut_id` is canonical** once minted. `batch_id` likewise. No competing
  identifiers.
- **Experiments are advisory labels, not traffic routing.** The thinker
  predicts; the operator decides; YouTube adjudicates.
- **The ledger is append-only memory.** Concluded experiments are never
  deleted; they are the thinker's accumulated understanding.

## Done when

1. A batch of 10+ runs end to end and every metadata file honestly
   describes the video on disk (status flags present, no claimed-but-
   unrendered edits).
2. Every cut carries `cut_id` + `batch_id`; published cuts carry
   `video_id` within a day of upload; the strategy DB join returns rows.
3. On a 10+ batch, the thinker writes an experiment artifact assigning
   2–4 shorts hypotheses with expected outcomes, visible in the hub, with
   ledger rows in `awaiting_results`.
4. After analytics mature, evaluations land automatically: conclusions in
   the ledger, predictions scored, and at least one channel-pattern
   promotion/demotion citing an experiment id.
5. At least one editor default (a tunable, a prompt pattern) has changed
   with an experiment id as its provenance — the loop has closed once.
