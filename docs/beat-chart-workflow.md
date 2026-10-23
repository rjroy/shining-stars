# Offline onset-chart authoring

Chart generation is an offline workflow using the already-installed Python
standard library, FFmpeg/FFprobe, `aubioonset`, and `aubiopitch`. It never
changes source MP3s and adds no browser runtime dependency. Generated onset
timestamps and full-mix F0 estimates are observations, not a human-approved
beat grid, downbeat, meter, melody, or playability assessment. The workflow
does not install tools.

## Authoring data and IDs

`data/charts/song-authoring.json` is schema version 2. Its `songs` object is
the authoritative source of chart IDs and per-song settings. Each key is a
stable ASCII slug (`a-z`, digits, single hyphens); new IDs are normalized from
the source filename/title by removing accents and apostrophes and replacing
spaces with hyphens. Keep the existing seven runtime IDs stable. A source path
must name the exact MP3, including punctuation and Unicode characters.

Every song entry contains:

- `source`: exact `data/music/...mp3` path.
- `start_time`, `duration`, and `twilight_time`: percentages of the measured
  source duration, each in `[0, 100]`; start plus duration cannot exceed 100,
  and Twilight must be below 100. The generator converts these to seconds.
- `lane_rules`: a non-empty lane pattern containing only `0`, `1`, `2`, `3`.
- Optional song-wide `algorithm`, `minioi`, `threshold`, and `silence` onset
  controls. These affect the single full-song onset analysis shared by every
  difficulty; defaults and units are documented below.
- `difficulties`: exactly `easy`, `normal`, and `hard`. Each specifies
  `minimum_delta` in milliseconds and a positive integer `stride`. Twilight
  Strength percentages are global difficulty-profile values, not per-song data.

### Song-level onset recipe

The optional song-level onset controls independently default to `algorithm:
"complex"`, `minioi: 0.012` seconds, `threshold: 0.3`, and `silence: -90` dB.
Supported algorithms are `default`, `energy`, `hfc`, `complex`, `phase`,
`specdiff`, `kl`, `mkl`, and `specflux` (as listed by `aubioonset -h`).
`minioi` must be positive, `threshold` is in `[0.1, 1]`, and `silence` must be
non-positive. Example of partial overrides:

```json
"the-rising-star": {
  "algorithm": "complex",
  "minioi": 0.018,
  "source": "data/music/The Rising Star (Remastered).mp3"
}
```

The omitted threshold and silence independently retain their defaults. These
fields are song-level only: placing them under a difficulty is rejected. Do not
confuse `minioi` (aubio's seconds-based onset-detector spacing) with
`difficulties.<name>.minimum_delta` (milliseconds-based post-processing), or
with `stride` (post-processing thinning). `lane_rules` provides the cyclic
baseline/fallback lane pattern; optional `lane_mapping` controls the
pitch-informed mapper's per-difficulty preferences, not the onset detector.

For each difficulty, the generator filters detections using that difficulty's
delta and stride and emits its own singleton-difficulty chart. Runtime computes
Twilight Strength as `ceil(eligible Twilight note count * Perfect damage *
profile percentage / 100)`. Changing a profile percentage changes runtime
strength immediately and does not require chart regeneration.

The shared gameplay profiles are in
`data/charts/difficulty-profiles.json`. Do not change that user-owned file as a
side effect of chart work. Both authoring and runtime validate its Easy,
Normal, and Hard profile values. The widest selected Good timing window plus
the existing 200 ms input-offset limit determines chart edge/handoff safety.

### Choosing an onset algorithm

Think of these algorithms as different ways of listening for “something just
happened” in the music. An onset is a sound change, often a note or drum attack,
not necessarily a beat. None of these methods understands the song or decides
which moments would make satisfying game notes. Pitch-based lane assignment is
a separate step.

| Algorithm | What it listens for | Practical implication |
| --- | --- | --- |
| `energy` | “The sound just got louder.” | Simple attacks can stand out, but a new note buried under an already-loud backing track might not. |
| `hfc` | “There is a burst of bright, sharp sound.” Higher frequencies get more weight. | Suited to percussive attacks such as clicks, crisp drum hits, and the initial strike of an instrument. It is not specifically following the melody. |
| `specflux` | “Which parts of the sound just became stronger?” It adds up increases in separate frequency regions. | A new sound can register even when overall loudness barely changes. Fading sounds do not directly contribute to its change measurement. |
| `specdiff` | “How much did the sound's makeup change?” Its calculation responds to both increases and decreases, with additional filtering. | Notices broader changes, not just new energy arriving. Not every change represents a note worth playing. |
| `phase` | “The sound stopped continuing smoothly.” It detects disruptions in the progression of repeating vibrations. | Can notice an attack without a large volume increase, but does not identify instruments or understand phrases. |
| `complex` | “The sound differs from what I expected, in both strength and vibration.” | Combines changes in component strength and predicted phase. Worth trying on layered recordings, but not automatically better than HFC. |
| `kl` | “How surprising is this sound compared with a moment ago?” It compares current and previous strength in each frequency region, with extra weight for stronger current components. | Relative changes in prominent sounds have more influence. |
| `mkl` | “Look at relative changes without giving loud components the same extra advantage.” | Removes KL's extra weighting by current strength. Less-prominent components have more relative influence than in KL; this does not guarantee better quiet-note detection. |
| `default` | Aubio's built-in choice, which is `hfc` in version 0.4.9. | Does not inspect the song and choose a method. Explicitly setting `"algorithm": "default"` selects HFC, whereas omitting `algorithm` uses this project's `complex` default. |

For example, a piano note over a continuing bass might barely change the total
loudness but change which frequencies are present. That is why `energy` and the
spectral methods can disagree. In `complex`, the name refers to the mathematical
method, not a promise to handle complicated songs better or produce harder charts.

For this game, start by comparing `hfc`, `specflux`, and `complex`:

- **HFC:** Does following the sharp attacks feel right?
- **Spectral flux:** Do newly appearing sounds provide better playable moments?
- **Complex:** Does considering both strength and phase changes better match the
  musical action?

Judge actual gameplay, not just density numbers. Two charts with the same average
density can feel different because they select different moments. The same
threshold does not guarantee equivalent sensitivity across algorithms. If a
method feels promising but produces too many or too few notes, tune its threshold
before rejecting it. Minimum onset spacing and silence settings also affect which
candidates survive.

These explanations are based on the
[aubio 0.4.9 manual](https://github.com/aubio/aubio/blob/0.4.9/doc/aubioonset.txt)
and [algorithm implementations](https://github.com/aubio/aubio/blob/0.4.9/src/spectral/specdesc.c).
The listening descriptions are practical interpretations, not guarantees for a
particular instrument or genre.

### Profile outcome signs

Timing windows must remain finite, positive, and ordered. Audience Perfect and
Good rewards and Twilight Perfect/Good costs and damage remain finite and
non-negative. Miss outcomes are signed finite deltas: a negative
`audience.miss` reduces Renown, floored at zero; a negative Twilight
`personal_cost` grants Personal Strength, while negative Twilight `damage`
restores Twilight Strength. Twilight resource arithmetic retains its existing
zero floor and has no upper cap, so these negative deltas can raise a resource
above its starting value. They are not clamped to the original Renown or
Twilight Strength.

Generated charts contain no baked `twilightStrength`. Signed miss outcomes do
not alter runtime initial-strength calculation. Do not reinterpret a
negative personal cost as damage or a negative damage delta as a personal cost.

Runtime catalog metadata lives separately in `data/catalog.json` (schema
version 1). Add or edit a record there using the stable generated song ID,
preserving existing IDs, titles, order, and collection membership. Set the
display title from the exact source filename without inventing additional
story/lore. The catalog's `segmentKind`, availability, and chart status are
runtime metadata; the playable interval and difficulty set come from generated
charts. The All Songs collection lists its song IDs once; runtime derives each
song's reverse collection membership. Do not restore handwritten TypeScript
chart modules or song-level chart aliases.

## Generate and check

The package defaults intentionally process the complete authoring collection
(currently 29 songs):

```sh
npm run chart:generate
npm run chart:check
```

These scripts pass `--all` to the v2 CLI. To explicitly select one configured
song instead:

```sh
python3 -m scripts.beat_chart --song never-again
python3 -m scripts.beat_chart --check --song never-again
python3 scripts/tune_song.py never-again
```

`tune_song.py` generates that song's chart, then prints its density report. It
stops and returns the failing command's exit code if generation or reporting
fails.

The `--all` generation/check reads the full recording's cached or newly
detected onsets and full-source pitch frames, then creates three independent
difficulty charts per song. Each chart uses that difficulty's own
minimum-delta, stride, and lane-mapping controls, along with the source
duration, percent-based excerpt and Twilight positions, and profile values. It
does not accept legacy per-chart output paths for schema v2.

The generated outputs are:

- `data/charts/onsets/<song-id>.beats.json`: source path and SHA-256, measured
  source duration, complete onset list, analysis/tool provenance, percent
  authoring projection, and difficulty-profile file SHA-256.
- `data/charts/generated/<song-id>.charts.json`: schema version 1, `songId`,
  exact source path string, and `charts.easy`, `charts.normal`, `charts.hard`.
  Every chart is a runtime `ChartConfig` with its own singleton
  `allowedDifficulties`, seconds-based timing, and notes. The bundle also has
  `scoring` metadata, version 1:
  `normalMaximum` is the theoretical all-Perfect score for the Normal chart,
  `fiveGoldTarget` is `ceil(normalMaximum * 0.9)`, and `chartFingerprint` is
  the SHA-256 of the scoring version plus canonical Normal chart data. When a
  Normal chart is absent, all three scoring values are `null`.
- `data/charts/pitch-cache/<song-id>.<analysis-key>.json`: extracted
  full-source F0 frames, source SHA-256, extraction recipe and tool identity,
  analysis key, and payload digest. Older content-addressed pitch caches may
  remain; they are not part of the generated-output inventory.
- `data/charts/reports/<song-id>.lanes.json`: per-difficulty resolved controls
  and diagnostics, including lane counts/shares, hand counts, longest run,
  rolling-32 concentration, stable/unknown pitch counts, and baseline/candidate
  extracted-F0 direction agreement.

### Inspect chart note density

`scripts/chart_density.py` reports each generated song/difficulty's mean notes
per 10 seconds, duration-weighted population standard deviation, and maximum
notes per 10 seconds across fixed blocks. The maximum uses normalized block
rates (including the final partial block), not a sliding window. It reads only
`data/charts/generated/`; it does not regenerate charts, read audio, or write
artifacts. Empty 10-second blocks count as zero density, and a final partial
block is normalized to a 10-second rate and weighted by its actual duration.

```sh
python3 scripts/chart_density.py --all
python3 scripts/chart_density.py --song the-rising-star
```

Use `npm run test:chart` to run the isolated density tests with the chart
pipeline suite.

Vite eagerly imports these JSON bundles and audio URLs. Browsing creates no
audio context and performs no audio fetch/decode. Exact source spelling in the
chart bundle must match an imported MP3 asset. Do not introduce a fallback
chart, Normal alias, or runtime-generated default when a bundle is missing or
malformed.

Generation caches onset detections in `data/charts/onsets/`. The resolved
onset recipe is recorded in analysis-command provenance and the song projection.
Changing an onset override invalidates that cache; an old HFC cache cannot
satisfy the default `complex` recipe. Generation skips mismatched legacy onset
caches and regenerates; `chart:check` remains read-only and fails on a mismatch.
Changing source audio requires source-hash-matching onset and pitch analysis; old
content-addressed pitch caches may remain. The pitch-cache key includes the
full-source audio SHA-256, normalized extraction recipe/version, and tool
identity. Changes to lane controls, difficulty stride/minimum delta, excerpt
projection, or gameplay profiles reuse extracted F0 and recompute the affected
charts/reports. Changes to the Normal chart or generated scoring-metadata inputs
(scoring version, maximum-score calculation, five-gold-target calculation, or
fingerprint canonicalization) also refresh the generated Normal maximum, 90%
target, and fingerprint. A normal-star threshold-only change does not affect
these metadata inputs and does not require chart regeneration. Regenerate after chart-affecting authoring or timing/profile changes.

`chart:check` runs no FFmpeg or aubio command and does not resolve the currently
installed pitch-tool identity. It verifies the current source hash, validates
the recorded onset and pitch-cache provenance/payload, and recomputes expected
pitch-informed charts, scoring metadata, and reports from those recorded inputs.
For `--all`, it rejects missing, extra, or stale onset, generated-chart, and
lane-report outputs. Generation refreshes scoring fingerprints and targets;
this strict offline check detects stale pitch-informed values. It remains
available locally and still requires the complete pitch caches.

`chart:artifact-check` is a separate cache-free committed-artifact check used by
CI. It verifies current source, onset recipe/projection, and gameplay-profile
provenance; recomputes chart timing and note IDs from onset data; checks lane
values are in range; recomputes scoring metadata; and checks source/key/control
provenance plus lane-derived report statistics and output inventory. It does
not load, create, or require pitch caches and does not run audio tools. Without
pitch frames it cannot verify that lane assignments match pitch observations,
nor recompute pitch-direction agreement or other pitch-dependent report values;
the report fields are checked for internal shape/count consistency only. Thus
this artifact check is not a substitute for strict local `chart:check` pitch
recomputation.

Pitch caches are local generated analysis data under
`data/charts/pitch-cache/`; Git ignores this directory. Do not stage or commit
these caches. Runtime target presentation consumes generated scoring metadata
rather than scanning Normal chart notes at startup.

Generation uses FFprobe to measure source duration, FFmpeg and `aubioonset`
when onset analysis is missing, and FFmpeg plus `aubiopitch` when pitch
analysis is missing. These tools must already be installed; the workflow does
not install them. Do not treat generated charts or analysis candidates as
human-approved; musical review and playability approval remain separate work.

## Lane-mapping controls

Pitch-informed mapping runs by default for each difficulty. The optional
`lane_mapping` object supplies per-difficulty overrides; omit it, or any
individual control, to use the shared defaults. Configure it inside each song
difficulty in `data/charts/song-authoring.json`. For example, this overrides
Normal's `pitch_following` default while Easy, Hard, and the other Normal
controls retain their defaults:

```json
"normal": {
  "minimum_delta": 64,
  "stride": 2,
  "lane_mapping": {
    "pitch_following": 2
  }
}
```

The four cost-scaling controls are numbers from 0 through 4 and default to 1.
They scale the mapper's soft costs:

- `pitch_following` scales the 0.15 relative-preferred-lane cost and the 0.8
  opposite-contour cost.
- `lane_balance` scales both the existing 0.08 shared-deviation cost and the
  0.03 squared-count balancing cost.
- `repetition_avoidance` scales the 0.55 cost for each same-lane continuation
  beyond three notes.
- `wide_jump_avoidance` scales the 0.35 cost for a jump between the two
  outermost lanes.
- `adaptation_block_notes` is an integer from 8 through 128, default 32. It
  sets the note-count blocks in that difficulty's selected note sequence used
  to adapt pitch-to-lane preferences; blocks are not detected phrases or keys.

Zero disables that preference cost, not the lane mapper. These are soft
preferences, not lane limits or quotas: a stationary lane has no contour
penalty, although it still counts as a contour disagreement, and there is no
enforced hand balance. Repetition and wide-jump costs are independent of
elapsed time. `minimum_delta` and `stride` continue to control timing density
independently for each difficulty.

Each difficulty's optional `lane_mapping` is a partial override. Omit the
object, or omit any individual control, and the mapper resolves the shared
defaults for that difficulty; pitch mapping itself still runs. Pitch analysis
is shared across all three difficulties for a song, while each difficulty maps
its own filtered note sequence independently.

The production lane workflow caches extracted full-source F0 by audio hash,
tool identity, and extraction recipe. Edits to lane controls, adaptation block
size, stride, or minimum delta reuse cached pitch; regenerate and check the
chart outputs:

```sh
npm run chart:generate
npm run chart:check
```

The checked per-song report is
`data/charts/reports/<song-id>.lanes.json`. It records lane counts,
rolling-32 concentration, longest run, unknown-pitch count, and F0 direction
agreement. `chart:check` is read-only: it validates the recorded provenance
and recomputes expected outputs without requiring installed analysis tools. It
does not check the currently installed tool version. Production integration
and the full 29-song regeneration/check are complete for the current authoring
collection.

## Browser validation

```sh
npm run test:brightvale:acceptance       # bounded real-app smoke
npm run test:brightvale:acceptance:exhaustive # all generated chart variants
```

Both modes first statically validate all 29 songs and 87 difficulty charts.
The bounded smoke then plays representative charts from different songs and
difficulties in the actual app. Exhaustive mode starts and returns from all 87
song/difficulty combinations; it is intentionally longer. Reports state the
actual run count. A smoke run is not evidence that all 87 combinations were
played. These checks use a muted Vite build, trusted browser clicks, and the
native `AudioContext.currentTime` clock; they do not alter judgment timing or
bypass autoplay policy. The runner owns and cleans up its Vite and Chromium
processes/profile in `finally` cleanup.

The separate `npm run test:brightvale:browser` covers the gameplay judgment and
responsive harnesses. It is not a substitute for exhaustive all-chart
playback or a claim of listening-based chart approval.
