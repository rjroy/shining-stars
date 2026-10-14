# Offline onset-chart authoring

This authoring workflow uses the installed `ffmpeg` and aubio's `aubioonset`,
plus Python's standard library. Neither system tool is a browser dependency. The
original source audio is never modified.

## Per-song settings

`data/charts/song-authoring.json` is the JSON collection for chart settings.
Songs are keyed by stable song ID and each entry identifies its source path.
The currently playable song retains its existing settings. Six additional
full-recording entries are offline candidates; their measured duration and
midpoint are recorded explicitly in the collection. The current runtime entry
is:

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
- `src/game/mvp-chart.ts`: deterministic `MVP_CHART: ChartConfig` projection with
  the source SHA-256 in a comment.

Both outputs are fully built and validated before either is replaced. Each
file is replaced atomically on its own; the pair is not a cross-file
transaction. This is a low-density onset-derived starting chart, not a claim
that aubio inferred a downbeat, meter, melody, or human-verified musical fit.

## Prepare the six full-song candidates safely

The six candidate settings use `start_time: 0`, the full duration measured from
each MP3 container with FFprobe, and `twilight_time: duration / 2` (the exact
midpoint is stored in the JSON settings). They provisionally reuse the current
song's strength 100, Normal+Hard difficulty list, 64 ms minimum spacing,
stride 2, and lane pattern `[0, 2, 1, 3]`. These are starting settings, not
playability or musical approval.

Each generated artifact and TypeScript chart is isolated from the default live
artifact and `src/game/mvp-chart.ts`. Generate and verify all six with:

```sh
for song in never-again the-abandoned-child the-commodity the-game \
  the-last-true-performer the-rising-star; do
  npm run chart:generate -- --song "$song" \
    --artifact "data/charts/candidates/$song.beats.json" \
    --chart "src/game/$song.candidate.ts"
done
for song in never-again the-abandoned-child the-commodity the-game \
  the-last-true-performer the-rising-star; do
  npm run chart:check -- --song "$song" \
    --artifact "data/charts/candidates/$song.beats.json" \
    --chart "src/game/$song.candidate.ts"
done
```

The generated chart includes source SHA-256; the beat artifact also retains
the complete onset list, selected-onset provenance, settings, and normalized
tool commands. Onsets are aubio's detected transient times, not a musically
verified beat grid, downbeat, meter, melody, or playability assessment. Review
and approve candidates separately before any runtime catalog integration.

## Full-song browser audio preflight evidence

The six candidates were preflighted sequentially on 2026-10-14 using the
installed Chromium 152.0.7977.82 (HeadlessChrome on Linux), the actual Web
Audio `AudioContext`, `createBrowserAudioContextAdapter`, and
`createAudioTransport`. The runner decodes each complete MP3 into an actual
`AudioBuffer`, then requires transport `ready` and `playing` after a trusted
CDP mouse click on the harness start button. Each fresh page began with a
suspended context; its click resumed the context. The harness does not change
the audio clock, bypass autoplay policy, or claim Observatory visual
integration. Audio was muted at three independent boundaries: Vite ran with
`VITE_SONG_VOLUME=0`, Chromium used `--mute-audio`, and the adapter gain was
explicitly zero. The runner and its owned Vite/Chromium processes were cleaned
up and their listeners verified closed.

All six browser contexts and decoded buffers were stereo at 48,000 Hz. In each
case the authored full-track interval was `[0, chart duration]`, and the
transport scheduled offset 0 and exactly the authored duration. All contexts
were suspended before click, resumed on the trusted click, reached `ready`,
then `playing`; no shortfall or unexplained residual blocked integration.

| Song | Source SHA-256 prefix | Chart duration (s) | Decoded frames | Browser duration (s) | Signed decoded-minus-chart residual (s) | MP3 frames / skip / tail discard (samples) |
|---|---|---:|---:|---:|---:|---:|
| Never Again (Remastered) | `c504fde831b8` | 434.959979 | 20,878,079 | 434.95997916666664 | +0.000000166666666 | 18,125 / 1,105 / 816 |
| The Abandoned Child (Remastered) | `a33cafd713ec` | 417.639979 | 20,046,719 | 417.63997916666665 | +0.000000166666666 | 17,403 / 1,105 / 432 |
| The Commodity (Remastered) | `d96ff62e6a04` | 318.879979 | 15,306,239 | 318.87997916666666 | +0.000000166666666 | 13,288 / 1,105 / 432 |
| The Game | `e2f0607292e2` | 413.359979 | 19,841,279 | 413.3599791666667 | +0.000000166666666 | 17,225 / 1,105 / 816 |
| The Last True Performer (Remastered) | `13b0d97cd399` | 403.359979 | 19,361,279 | 403.3599791666667 | +0.000000166666666 | 16,808 / 1,105 / 432 |
| The Rising Star (Remastered) | `9561a8a2ae25` | 417.239979 | 20,027,519 | 417.23997916666667 | +0.000000166666666 | 17,386 / 1,105 / 48 |

**Residual classification:** every positive residual is 1/6 microsecond (about
0.008 of a 48 kHz sample), not an omitted fraction of musical content. FFprobe
reports the MP3 container duration to six decimal places; its packet timeline
also contains MP3 encoder-delay and tail-padding side data. For every track,
the browser's decoded `AudioBuffer.length` exactly equals the sum of encoded
MP3 frame samples minus FFprobe's initial `skip_samples` and final
`discard_padding`. Thus the browser decoded the complete side-data-trimmed
encoded recording, while the chart uses the microsecond-rounded FFprobe
duration. No chart timing was changed, and the transport's duration guard
accepted each interval. This establishes no missing encoded frames in these
browser decodes; it is not a listening-based judgment about the recording's
musical ending or the charts' playability.

Reproduce the muted check and its focused evidence-logic tests with:

```sh
node --test tests/browser/brightvale/audio-preflight-evidence.test.mjs
node tests/browser/brightvale/audio-preflight.mjs
```

The complete browser, source hashes, FFprobe packet/trim metadata, decoded
buffer fields, signed residuals, transport snapshots, and cleanup evidence are
written to the ignored local file
`.lore/local/evidence/full-song-audio-preflight.json`. Only the installed
Chromium build was available; other browser engines were not tested. This
behavior harness is not an actual Observatory UI or visual-integration test.

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
with `src/game/mvp-chart.ts`. A changed/missing source, mismatched settings,
malformed onset projection, or stale chart fails the check. Regenerate after
changing source audio, aubio/FFmpeg behavior, or authoring settings. The
workflow requires Python 3, FFmpeg, and the already-installed `aubioonset`; it
installs nothing and uses no third-party Python packages.
