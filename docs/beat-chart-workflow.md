# Offline onset-chart authoring

This authoring workflow uses the installed `ffmpeg` and aubio's `aubioonset`,
plus Python's standard library. Neither system tool is a browser dependency. The
original source audio is never modified.

## Per-song settings

`data/charts/song-authoring.json` is the JSON collection for chart settings.
Songs are keyed by stable song ID and each entry identifies its source path.
Only the currently playable song is configured; other audio files do not have
guessed excerpt settings. The active entry is:

```json
{
  "songs": {
    "the-first-shining-star": {
      "source": "data/music/The First Shining Star (Remastered).mp3",
      "start_time": 107.1,
      "twilight_time": 39.2,
      "duration": 65.8,
      "twilight_strength": 100,
      "allowed_difficulties": ["normal", "hard"],
      "minimum_delta": 64,
      "stride": 2,
      "lane_rules": { "type": "pattern", "data": [0, 2, 1, 3] }
    }
  }
}
```

`start_time`, `twilight_time`, and `duration` are seconds; Twilight time is
relative to the excerpt. `twilight_strength` is the finite, positive initial
Twilight Strength for the song. `minimum_delta` is milliseconds. `stride` is a
positive integer, and the supported lane rule is a non-empty `pattern` of lane
numbers 0 through 3. The loader rejects invalid/non-finite timings or strength,
negative minimum delta, invalid stride, and unsupported lane rules. The
strength is recorded in the provenance artifact and emitted as
`MVP_CHART.twilightStrength`. `allowed_difficulties` is a non-empty ordered list
of unique profile IDs and is emitted as `MVP_CHART.allowedDifficulties`; the
current song allows Normal and Hard. Normal is selected by default when allowed,
otherwise the first declared profile is used. The selection is fixed for a run
and can change only while idle or after results. Difficulty changes rewards,
combat values, and timing windows, not the charted notes or initial Twilight
Strength.

The shared, validated profiles live in `data/charts/difficulty-profiles.json`
and are consumed by both the TypeScript game and the Python generator. Easy uses
Perfect/Good windows of 250/500 ms, Audience rewards 2/1/0, and Twilight
cost/damage P/G/M of 0/0/2 and 2/1/0. Normal uses 75/150 ms, rewards 3/2/0,
and cost/damage 0/1/3 and 3/2/0. Hard uses 50/100 ms, rewards 5/3/0, and
cost/damage 0/2/3 and 5/3/0. The chart guard uses the widest Good window among
the allowed profiles plus the existing 200 ms input-offset limit. Consequently
the current Normal/Hard combination retains the existing 150 ms guard and
chart timestamps.

## Generate

```sh
npm run chart:generate
```

The default command selects `the-first-shining-star` from the settings file.
Use `--song <id>` to select another configured song or `--song-config <path>`
to read another collection. Existing source and excerpt overrides remain
available, for example:

```sh
python3 scripts/beat_chart.py --song the-first-shining-star \
  --source "data/music/The First Shining Star (Remastered).mp3" \
  --artifact /tmp/first-star.beats.json --chart /tmp/mvp-chart.ts
```

FFmpeg writes a temporary mono, 44.1 kHz, signed 16-bit PCM WAV from the full
source recording. `aubioonset -T seconds -O hfc -t0.3 -M0.012 -s-90`
reports onsets in full-track seconds. The 12 ms minimum inter-onset interval
and -90 dB silence threshold are explicit detector settings recorded in the
artifact. This detector floor is independent of the configured 64 ms
`minimum_delta` filter: that filter works only on onsets the detector emits,
and does not promise to represent every physical sound event. The temporary
WAV is removed on success and failure. The workflow first selects onsets inside
the configured excerpt, greedily retains
the first onset and each later onset at least `minimum_delta` milliseconds
after the **last retained** onset, then keeps the first and every `stride`
onsets from that retained list. Equality is retained. For offsets
`[0, 12, 64, 128, 200, 300, 315, 400]` ms with minimum delta 64, the retained
offsets are `[0, 64, 128, 200, 300, 400]`; stride 2 produces `[0, 128, 300]`
and stride 3 produces `[0, 200]`.

Filtering and stride anchor at the first onset in the excerpt and happen before
the chart's existing edge and handoff timing guards. Guarded onsets are dropped
without shifting other onsets or restarting stride at Twilight. The artifact
preserves every raw onset timestamp and selected onset's original full-track
index/time. Note times are source onset time minus `start_time`, rounded to six
decimal places, and validated again after rounding. Lanes cycle through the
configured pattern over emitted notes.

The command writes:

- `data/charts/the-first-shining-star.beats.json`: source SHA-256 and path,
  song/config settings, complete onset list, selected-note provenance, and
  normalized tool commands.
- `src/mvp-chart.ts`: deterministic `MVP_CHART: ChartConfig` projection with
  the source SHA-256 in a comment.

Both outputs are fully built and validated before either is replaced. Each
file is replaced atomically on its own; the pair is not a cross-file
transaction. This is a low-density onset-derived starting chart, not a claim
that aubio inferred a downbeat, meter, melody, or human-verified musical fit.

## Author another source safely

The runtime still plays the source configured in `src/main.ts`. If a selected
song or `--source` override resolves to a different recording, generation and
check mode reject the live default chart/artifact destinations before hashing
the source or invoking tools. Supply both output paths and keep them isolated
from the live destinations:

```sh
npm run chart:generate -- --song another-song \
  --artifact /tmp/another-song.beats.json \
  --chart /tmp/another-song.ts
npm run chart:check -- --song another-song \
  --artifact /tmp/another-song.beats.json \
  --chart /tmp/another-song.ts
```

An alternate song ID that resolves to the same recording as the runtime may
still use the live outputs. The safety rule follows the resolved source path,
not the song ID.

## Check cached outputs

```sh
npm run chart:check
```

Check mode does not invoke FFmpeg or aubio. It hashes the current source,
compares source path and settings with the cached artifact, rebuilds the
expected chart from the cached raw onset timestamps, and compares the result
with `src/mvp-chart.ts`. A changed/missing source, mismatched settings,
malformed onset projection, or stale chart fails the check. Regenerate after
changing source audio, aubio/FFmpeg behavior, or authoring settings. The
workflow requires Python 3, FFmpeg, and the already-installed `aubioonset`; it
installs nothing and uses no third-party Python packages.
