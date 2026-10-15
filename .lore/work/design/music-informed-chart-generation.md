---
title: Music-informed chart generation
date: 2026-10-14
status: draft
tags: [charts, music-analysis, generation]
---

# Music-informed chart generation

## Decision

Propose an opt-in, local CPU workflow that analyzes audio with librosa and
converts measured musical evidence into deterministic lane choreography. Keep
the existing aubio onset workflow as the compatibility baseline, selected
explicitly by users who want legacy generation. The intended outcome is draft
Easy, Normal, and Hard charts for all 29 genre-diverse MP3 songs, without a
human having to author every note. “Draft”
does not mean musically verified or automatically approved for runtime.

The proposed per-song controls are only `focus` (`balanced`, `percussive`, or
`harmonic`), `density`, and `movement`. Existing excerpt and Twilight positions
remain in place. This is a design proposal, not implementation authorization;
neither its schema nor generated output is currently supported.

## Motivation and constraints

Current charts are derived from detected onset timestamps and a repeating lane
pattern. This is inexpensive and reproducible, but it does not use timbral or
spectral differences to vary the note stream. A local feature-analysis stage
could provide more meaningful event selection and lane changes across varied
recordings while retaining an understandable, auditable pipeline.

Requirements:

- Run offline on ordinary CPU hardware; no paid API, GPU, model training, or
  stem separation requirement.
- Analyze complete source tracks, then project events through the existing
  per-song excerpt and Twilight settings.
- Keep identical input audio, settings, analysis versions, and algorithm
  version capable of producing identical artifacts.
- Emit three playable candidate difficulties, while preserving the runtime
  chart format and the separation between authoring percentages and runtime
  seconds.
- Never imply that features are melody transcription, instrument recognition,
  verified beat grids, or a judgment of playability.

## Current behavior (source-grounded)

`scripts/beat_chart.py` converts audio through FFmpeg to mono, 44.1 kHz,
16-bit PCM, then runs `aubioonset` with HFC, threshold 0.3, minimum inter-onset
interval 0.012 seconds, and silence threshold -90 dB. It filters detections by
minimum spacing and per-difficulty stride, then assigns lanes by cycling the
configured lane pattern. It retains source hashes, tool/command provenance, and
configuration in JSON artifacts.

The schema-version-2 `data/charts/song-authoring.json` settings use percentages
for `start_time`, `duration`, and `twilight_time`; generation converts these to
seconds using measured source duration. Existing difficulty authoring includes
minimum spacing, stride, and Twilight strength. The workflow documentation
reports 29 configured songs. `src/catalog/catalog.ts` eagerly imports
generated chart bundles and MP3 URLs and expects the runtime chart bundle
contract; runtime generation is not an appropriate fallback. Preserve the
current excerpt and Twilight authoring values rather than changing their
meaning.

## Proposed analysis and event pipeline

1. **Resolve and fingerprint input.** Read the complete MP3 without modifying
   it. Record exact source path, SHA-256, measured duration, sample rate,
   analysis parameters, librosa and dependency versions, generator algorithm
   version, and relevant authoring settings. Analysis can use a documented
   mono floating-point waveform and fixed sample rate; resampling and channel
   mixing must be explicit and stable.
2. **Build spectral evidence.** Compute a short-time Fourier transform and
   multi-band positive spectral changes (spectral flux/onset strength). Use
   fixed frequency boundaries and frame/hop sizes. Normalize each band's
   positive changes robustly (for example, percentile scaling with clipping),
   and apply a calibrated absolute silence floor before normalization so
   background hiss does not become prominent after scaling. Retain raw and
   normalized values or enough evidence to audit candidate selection.
3. **Apply focus.** `balanced` combines low-, mid-, and high-frequency evidence;
   `percussive` favors broadband/transient changes; `harmonic` favors sustained
   or pitched spectral changes. Harmonic/percussive focus may use librosa's
   harmonic-percussive decomposition as a signal-analysis transform. This is
   not source separation and does not identify or isolate instruments.
4. **Propose events.** Detect local peaks in the selected onset-strength
   envelope, retain timestamp and evidence/confidence, and combine with
   aubio detections as supplemental evidence where useful. Confidence is
   relative evidence, not a probability of a true beat. Estimate beat-period
   and accent evidence when stable, but do not force candidates onto a grid:
    tempo ambiguity, subdivisions, rubato, and free time use a non-quantized
    candidate path. Store ambiguity/quality indicators instead of silently
   choosing a confident tempo. An empty or unusable feature result does not
   trigger automatic aubio fallback; aubio is a separately selected legacy
   mode, not a hidden recovery path.
5. **Project to excerpt and safeguards.** Convert the existing percentage
   positions to source seconds and retain only events in the excerpt. For the
   canonical sequence, apply start/end and Twilight handoff hit-envelope guards
   using the widest timing window across all three target difficulties plus
   the established 200 ms input-offset allowance. Existing profiles currently
   make Easy the widest window; derive this from profile data, not a hard-coded
   assumption. Round/serialize candidate timestamps first, then apply guards
   in that serialized time domain and validate every final chart using its
   actual singleton `allowedDifficulties`. Match runtime inequalities exactly:
   reject start when `time - envelope < 0`; reject a note exactly at Twilight;
   for pre-Twilight notes reject when `time + envelope >= twilightAt - 0.5`;
   for post-Twilight notes reject when `time - envelope <= twilightAt + 0.5`;
   reject the end only when `time + envelope > duration - 0.5`. Then resolve
   minimum spacing and chart-level note limits. This uses the validator's
   strict/non-strict boundaries, not an approximate guard.
6. **Assign choreography.** For each confident event, take the four ordered
   normalized positive-flux band values (low to high); the strongest band
   selects its index `0`–`3` as the preferred lane. Equal values choose the
   lower band index. This is a deterministic mapping from spectral band to
   lane, not pitch or instrument identity. Let `p` be the preferred lane, `q`
   the prior assigned lane, `l` a candidate lane, and `m` the movement control.
   Choose the lane minimizing `abs(l - p) + (1 - m) * 2 * abs(l - q)`; ties
   choose the lane with smallest distance to `p`, then lowest lane index. The
   first confident event uses `p` directly. At `m=1`, lanes follow preferred
   bands; at `m=0`, they stay on the prior lane. For example, preferred lanes
   `[0, 3, 1, 3]` produce `[0, 3, 1, 3]` at `m=1` and `[0, 0, 0, 0]` at
   `m=0`. For weak/noisy evidence, stay on the prior lane; if the first event
   is weak, use fixed lane `1`. Do not invent a cyclic fallback. Avoiding
   repeated lanes is not a hard constraint: cadence guard removes excessively
   close events rather than fabricating lane movement. All weights, tie-breaks,
   confidence thresholds, and weak-evidence rules are versioned algorithm
   parameters to tune. No phrase recognition is claimed; motif matching is
   deferred.
7. **Derive difficulties.** Build one canonical hardest event sequence, then
   create Normal and Easy as nested subsets. Rank for removal using confidence
   and spacing constraints; retained events keep precisely the canonical
   serialized timestamp, ID, and lane. Reserve at least one canonical event
   that passes the Twilight-side guards and is valid for all three difficulties;
   preserve that same event in Easy, Normal, and Hard while thinning. Never
   independently re-detect, re-time, or reassign lanes per difficulty. If no
   valid canonical Twilight event exists, or thinning/spacing makes the
   reservation impossible, fail that song with a structured diagnostic. Do
   not fabricate notes or use aubio as an automatic fallback. A song is
   promotable only as a complete validated triple with positive derived
   Twilight strength for every difficulty.

### Controls and internal presets

Proposed settings live per song alongside existing excerpt/Twilight settings;
they are not additional command-line knobs.

| Control | Proposed values | Proposed meaning |
| --- | --- | --- |
| `focus` | `balanced` (default), `percussive`, `harmonic` | Relative weighting of spectral evidence sources. |
| `density` | `0.5`–`1.5`, default `1.0` | Multiplier on target candidate/event budget, not permission to violate spacing or edge guards. |
| `movement` | `0.0`–`1.0`, default `0.5` | How readily lane choices move away from recent lanes; `0` favors continuity and `1` favors bounded variety. |

The ranges/defaults are proposals for empirical tuning, not established
perceptual scales. The lane mapping above gives a concrete baseline for
`movement`; its coefficients and thresholds remain versioned and tunable.
Difficulty-specific target budgets, minimum spacings, and subset-removal
thresholds are internal versioned presets, not exposed per-song controls.
Preserve the current legacy stride behavior in legacy mode. In the new mode,
density determines candidate budget and difficulty thinning; legacy stride is
not applied on top of density (that would multiply two independent thinning
controls and make density unpredictable).

## Cache, provenance, and reproducibility

Use a distinct feature-analysis cache and proposed-chart output namespace, not
the existing aubio cache or generated runtime bundles. Cache identity should
include source SHA-256, analysis settings, relevant focus/density/movement
settings, excerpt projection, algorithm/schema version, and librosa plus
numerical dependency versions. Include tool versions and normalized command/
parameter descriptions in provenance. A source, setting, version, or algorithm
change invalidates the relevant cache. Serialize sorted keys, finite numeric
values, stable event ordering, and rounded chart times under an explicitly
versioned rule. Avoid nondeterministic threading/reduction paths where they
change results; document any remaining platform-level reproducibility limits.
If one song fails, retain its existing artifacts and write none of that song's
new analysis/chart outputs. Continue processing other selected songs, collect
structured per-song failures, and return a nonzero overall result with the
failure report. Promote only complete validated Easy/Normal/Hard triples; do
not leave a partial replacement.

Artifacts should distinguish analysis observations (feature summaries,
candidate timestamps, confidence/evidence, and ambiguity) from chart
projections. Keep the original input immutable, verify its hash before writing,
and write outputs atomically. Never replace the existing onset artifact or
generated chart as a side effect. A future explicit mode/schema could opt a
song into the proposed analyzer; until separately implemented and approved,
legacy mode remains the default and its outputs stay unchanged. No automatic
migration of the current config or activation in `src/catalog/catalog.ts` is
proposed. Candidate outputs stay in an isolated sandbox until separately
reviewed and approved.

## Non-goals and limits

- No promise of accurate melody transcription, note pitches, instrument
  recognition, source-separated stems, downbeat/meter inference, or semantic
  musical structure.
- No hosted service, paid API, GPU, learned model, or training corpus.
- No runtime audio analysis, fallback chart, or browser dependency.
- No claim that a valid chart is enjoyable, fair, or musically aligned. Signal
  metrics cannot establish fun; human listening and playtesting remain valuable
  quality checks. The goal is to remove the need for ongoing manual note-by-note
  authoring, not to remove review of candidate quality.

## Validation evidence required before adoption

Validation is future work; no tests, benchmarks, listening, or successful
generation runs are claimed here.

- Unit-test synthetic silence, isolated impulses/percussion, sustained tones,
  mixed transient-plus-tone signals, and ambiguous/free-time patterns. Check
  silence-floor behavior, finite normalized features, non-quantized operation
  without stable beat evidence, explicit failure for empty evidence, and stable
  tie-breaking. Verify a controlled four-band example selects the expected
  lanes at movement 0 and 1 and exercises deterministic cost/tie cases.
- Assert repeated runs with identical inputs/settings produce byte-identical
  analysis and charts; changing source/settings/version changes cache identity.
- Assert all difficulty charts satisfy runtime validation, canonical guards
  computed from the widest timing window across all three difficulties,
  serialized-time rounding, note-spacing limits, unique stable IDs, positive
  Twilight strength, and the nested-subset invariant: every easier note exists
  in harder charts at identical time/lane. Cover a time valid for Hard but
  invalid for Easy at excerpt start, Twilight handoff, and excerpt end,
  including equality boundaries after rounding.
- Test a song with no valid Twilight-side evidence: it must produce a
  structured failure, no fabricated event, no promoted partial triple, and no
  replacement of prior artifacts. Test thinning where the last Twilight note
  would otherwise be removed; the same valid reserved note must remain in all
  three nested charts. Test impossible spacing/guards fail rather than violate
  the reservation.
- Compare representative tracks from at least three genres, then run the full
  29-song collection in the isolated output area. Record measured elapsed time,
  peak memory, failures, and per-song candidate/note counts; set performance
  acceptance thresholds only after measurement rather than inventing targets.
- Ask development agents to listen and play representative outputs where
  possible, including borderline tempo and sparse/dense material. Record what
  could not be listened to or played; automated validation is not approval.

## Risks and open empirical questions

Spectral changes may overselect percussion, noisy mixes, or repeated
accompaniment; robust normalization and silence floors need tuning across the
collection. Harmonic focus may select chord changes without identifying a
lead line. Tempo estimates can settle on half/double time, and band-to-lane
mapping can feel arbitrary even when deterministic. Repeated evidence can
repeat lanes; the cadence guard removes excessive density, not repetition.
Nested subsets guarantee structural consistency, not equal perceived
difficulty. Tune band weights, thresholds, spacing, budgets, and cost
coefficients against measured and listened examples.

Consider learned approaches only if this transparent local pipeline cannot
meet observed quality needs and a separate decision establishes data, runtime,
maintenance, and reproducibility trade-offs.

Reference for the multi-band onset-strength API: librosa
[`onset_strength_multi`](https://librosa.org/doc/latest/generated/librosa.onset.onset_strength_multi.html).

**Decision recap:** pursue an opt-in CPU/librosa feature-analysis proposal,
keep aubio as the unchanged baseline, and generate only isolated draft
candidates until evidence and explicit approval justify adoption. Open tuning
questions are empirical (focus weighting, budgets, thresholds, and lane
behavior). This document alone authorizes no implementation or runtime change.
