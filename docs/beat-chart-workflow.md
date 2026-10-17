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
- `difficulties`: exactly `easy`, `normal`, and `hard`. Each specifies a
  Twilight Strength percentage, a minimum onset delta in milliseconds, and a
  positive integer stride. Current starting values are Easy `70% / 64 ms / 3`,
  Normal `80% / 64 ms / 2`, and Hard `90% / 50 ms / 1`.

Those are per-song/per-difficulty authoring inputs, not runtime chart aliases.
For each difficulty, the generator filters detections using that difficulty's
delta and stride and emits its own singleton-difficulty chart. Initial
Twilight Strength is derived as:

```text
ceil(twilight_note_count * difficulty_profile_twilight_perfect_damage
     * authored_twilight_strength_percent / 100)
```

The shared gameplay profiles are in
`data/charts/difficulty-profiles.json`. Do not change that user-owned file as a
side effect of chart work. Both authoring and runtime validate its Easy,
Normal, and Hard profile values. The widest selected Good timing window plus
the existing 200 ms input-offset limit determines chart edge/handoff safety.

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

Generated chart `twilightStrength` is still derived from the number of Twilight
notes, the profile's Perfect damage, and the authored percentage. Signed miss
outcomes do not alter that initial-strength calculation. Do not reinterpret a
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
```

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
  `allowedDifficulties`, seconds-based timing, notes, and derived final
  `twilightStrength`. The bundle also has `scoring` metadata, version 1:
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

Vite eagerly imports these JSON bundles and audio URLs. Browsing creates no
audio context and performs no audio fetch/decode. Exact source spelling in the
chart bundle must match an imported MP3 asset. Do not introduce a fallback
chart, Normal alias, or runtime-generated default when a bundle is missing or
malformed.

Generation caches onset detections in `data/charts/onsets/`. Changing source
audio requires source-hash-matching onset and pitch analysis; old
content-addressed pitch caches may remain. The pitch-cache key includes the
full-source audio SHA-256, normalized extraction recipe/version, and tool
identity. Changes to lane controls, difficulty stride/minimum delta, excerpt
projection, or gameplay profiles reuse extracted F0 and recompute the affected
charts/reports. Changes to the Normal chart or generated scoring-metadata inputs
(scoring version, maximum-score calculation, five-gold-target calculation, or
fingerprint canonicalization) also refresh the generated Normal maximum, 90%
target, and fingerprint. A normal-star threshold-only change does not affect
these metadata inputs and does not require chart regeneration. Regenerate after
authoring or profile changes.

`chart:check` runs no FFmpeg or aubio command and does not resolve the currently
installed pitch-tool identity. It verifies the current source hash, validates
the recorded onset and pitch-cache provenance/payload, and recomputes expected
charts, scoring metadata, and reports from those recorded inputs. For `--all`,
it rejects missing, extra, or stale onset, generated-chart, and lane-report
outputs. Generation refreshes scoring fingerprints and targets; this offline
check detects stale values. Runtime target presentation consumes generated
metadata rather than scanning Normal chart notes at startup. Historical
content-addressed pitch caches are allowed.

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
  "twilight_strength": 80,
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
is implemented; the full 29-song regeneration and check are being handled
separately and are not claimed as complete here.

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
