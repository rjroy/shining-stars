# Offline onset-chart authoring

Chart generation is an offline workflow using the already-installed Python
standard library, FFmpeg, and `aubioonset`. It never changes source MP3s and
adds no browser runtime dependency. Generated onset timestamps are transient
observations, not a human-approved beat grid, downbeat, meter, melody, or
playability assessment.

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
python3 scripts/beat_chart.py --song never-again
python3 scripts/beat_chart.py --check --song never-again
```

The `--all` generation/check reads the full recording's cached or newly
detected onsets, then creates three difficulty projections per song. It uses
the source duration, percent-based excerpt and Twilight positions, difficulty
specific minimum-delta/stride settings, and profile values. It does not accept
legacy per-chart output paths for schema v2.

The generated outputs are:

- `data/charts/onsets/<song-id>.beats.json`: source path and SHA-256, measured
  source duration, complete onset list, analysis/tool provenance, percent
  authoring projection, and difficulty-profile file SHA-256.
- `data/charts/generated/<song-id>.charts.json`: schema version 1, `songId`,
  exact source path string, and `charts.easy`, `charts.normal`, `charts.hard`.
  Every chart is a runtime `ChartConfig` with its own singleton
  `allowedDifficulties`, seconds-based timing, notes, and derived final
  `twilightStrength`.

Vite eagerly imports these JSON bundles and audio URLs. Browsing creates no
audio context and performs no audio fetch/decode. Exact source spelling in the
chart bundle must match an imported MP3 asset. Do not introduce a fallback
chart, Normal alias, or runtime-generated default when a bundle is missing or
malformed.

Generation caches onset detections in `data/charts/onsets/`; changing source
audio invalidates its source hash. Changing authoring settings or the shared
difficulty profiles invalidates the cached projection (including its profile
hash) and generated charts. Regenerate all outputs after either change. Check
mode runs no FFmpeg or aubio command; it compares source, settings, profile
freshness, and generated projection, and rejects missing, extra, or stale
outputs. It also requires exactly the expected output set for `--all`.

The default generator may invoke the installed FFmpeg/aubio tools when an
onset cache is missing. It performs no installation. Do not treat generated
charts or onset candidates as human-approved; musical review and playability
approval remain separate work.

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
