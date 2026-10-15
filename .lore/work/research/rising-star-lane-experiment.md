---
title: "The Rising Star pitch-lane experiment"
date: 2026-10-15
status: completed
tags: [charts, music-analysis, experiment]
---

# The Rising Star pitch-lane experiment

## Results

These figures describe the historical 518-note Normal experiment, not a validation of the full production collection. It produced a candidate that was later integrated into the production pitch-informed workflow. The original full chart is preserved in `.lore/local/evidence/music-lane-experiment/the-rising-star.baseline.charts.json` for A/B and history. Existing Normal had 518 notes and was already globally balanced/cyclic: lane counts 130/129/130/129, hand counts 259/259, longest lane run 1, and worst rolling-32 concentration 25%. The candidate counts were 130/130/129/129, hands 260/258, longest run 3, and worst rolling-32 concentration 37.5%. So global lane/hand balance was retained, but some local concentration and repetition increased.

There were 408 stable pitch-window estimates (78.8%) and 110 unknown notes. On the same 253 adjacent stable pitch pairs with absolute extracted F0 change greater than 0.25 MIDI, baseline lane-direction agreement was 47.8% (121/253) and candidate agreement was 77.1% (195/253). These are **extracted-F0 agreement diagnostics**, not musical improvement: full-mix single-F0 is not validated melody and many estimates are likely accompaniment/harmonics. These revised results supersede the earlier non-overlapping-window and candidate-only agreement figures; the earlier 160/321 versus 209/321 comparison is obsolete and not used.

## Evolution into production

The user later played The Rising Star Normal candidate and said it feels good,
then authorized production integration. That feedback applies to this played
candidate only; it is not approval of every generated difficulty or all 29
songs. The production workflow retains aubio YINFFT full-source F0 and soft
lane-balance costs, and maps each independently selected difficulty sequence
using its own optional `lane_mapping` controls. The pitch cache is shared by
source hash, tool identity, and extraction recipe. Full-collection generation
and `chart:check` are being handled separately; this experiment does not claim
they have completed.

The older librosa/spectral-band proposal in
`.lore/work/design/music-informed-chart-generation.md` is superseded. Its
focus/density/movement controls, spectral-band mapping, canonical hardest chart,
and nested easier-chart thinning are not the production design. Production
instead uses the approved aubio F0 mapper with independently selected Easy,
Normal, and Hard charts.

## Historical experiment method and important limits

The script converts the full source to mono 22,050 Hz PCM with FFmpeg, then uses installed `aubiopitch` YINFFT (MIDI, buffer 2048, hop 256). Note pitch windows are inclusive from note time + `sourceStart` + 30 ms through +150 ms. The aubio buffer spans about 92.9 ms; its output/window alignment and algorithm latency were not calibrated against audio, so the nominal offset window is not a guarantee that these samples represent the note onset or melody. Median positive MIDI is marked stable if coverage is at least 50% and within-window MAD is at most 2.5 semitones. These heuristics do not detect octave errors or reliably detect pitch transitions; 130 adjacent eligible pairs jump by more than 12 MIDI, with a maximum jump of about 81 MIDI. That is a major uncertainty signal, not melody evidence.

Pitch quartile preferences were computed in fixed 32-note blocks. Blocks are heuristic segments, not detected phrases or key changes. The width-64 beam traversed the **whole chart**; preferences changed by block. Stable pitch preference cost 0.15 per lane step; adjacent contour-direction mismatch cost 0.8; runs beyond three cost 0.55 per note; a lane jump of three cost 0.35. Balance remained soft: each assignment incurred 0.08 times squared lane-share deviation from 25% plus 0.03 times the increase in the sum of squared lane counts. No exact quota was forced. In the historical experiment, a synthetic constant-pitch 80-note sequence used all lanes with counts 24/21/19/16 (max share 30%); this demonstrates the soft balance tradeoff, not quality.

Contour cost and agreement use only immediately adjacent notes that are both stable and differ by more than 0.25 MIDI. Unknown notes break the pair; no pitch comparison bridges gaps. Unknown notes have no pitch preference and receive a light baseline-lane tie preference. Stable pitch repetitions can be overridden by balance and choreography costs. No motif recognition is implemented. No claim is made about melody accuracy, playability, or player preference.

Rolling-32 concentration is the maximum lane share across **every complete sliding window of 32 notes**. Trailing partial windows are excluded; charts shorter than 32 notes report null. This avoids treating a short tail as a full 32-note window and catches concentrations spanning former block boundaries.

## Historical experiment tests and evidence

The following command runs unit tests for the isolated historical experiment;
it does not validate the production generator:

```sh
python3 -m unittest tests.test_pitch_experiment -v
```

Do not rerun the experiment script with its defaults after production adoption:
it reads the current generated Normal chart and writes to the historical
evidence directory, so it can replace the preserved experiment evidence with a
different candidate. The original baseline is retained under
`.lore/local/evidence/music-lane-experiment/` only in working copies where that
local evidence exists; it is not guaranteed in a clean checkout. Use the
production workflow below for current tuning.

Evidence lives under `.lore/local/evidence/music-lane-experiment/`: `metrics.json`, `timeline.csv`, `subprocess-attempts.json`, and `the-rising-star.pitch-candidate.charts.json`. The metrics include source/chart hashes, commands and outcomes, FFmpeg version, and aubiopitch executable SHA-256 (the CLI exposes no version flag). The determinism check reruns mapping on the same extracted records; it does **not** repeat audio extraction. Subprocess attempt outcomes are written incrementally so failures leave compact diagnostics. Audio WAV data stays in `/tmp/opencode` and the temporary directory is cleaned, including on exceptions.

Historical tests covered exact source-offset window bounds, monotone contour, constant-pitch balance, unknown gaps, silence, transposition across a 32-note boundary, Normal-lane-only deep-copy behavior, sliding-window edge cases, shared baseline/candidate F0 pairs, cleanup on failure, and persisted subprocess failures. The former conditional catalog-candidate test is no longer present.

## Current production tuning

For current tuning, edit `lane_mapping` under the target difficulty in
`data/charts/song-authoring.json`, then regenerate and check that song through
the production CLI:

```sh
python3 -m scripts.beat_chart --song the-rising-star
python3 -m scripts.beat_chart --check --song the-rising-star
```

## Candidate feedback and production follow-up

The user played **The Rising Star** on Normal and said the candidate feels good.
This was the user feedback associated with authorizing production integration;
it is not a claim of broader listening or playtesting coverage.

The earlier manual-candidate regeneration caveat is obsolete: production
generation now reads the difficulty-scoped lane controls and extracted pitch
cache, then regenerates each difficulty independently. The separate full
29-song regeneration/check is not represented as complete by this research
record. Authored duration `100` is a percentage; runtime duration and event
timestamps are derived from the measured source and current authoring data.
