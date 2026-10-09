# Offline beat-chart authoring

This workflow uses the installed `ffmpeg` and `aubiotrack` executables, Python's
standard library, and the existing chart model. It is an offline authoring tool;
neither system tool is a browser dependency. The selected source is
`data/music/The First Shining Star (Remastered).mp3`.

## Generate

```sh
npm run chart:generate
```

The command reads the complete original audio without modifying it or trimming
the input. FFmpeg writes a temporary mono, 44.1 kHz, signed 16-bit PCM WAV;
aubio emits beat timestamps in seconds from the start of that full track. The
temporary WAV is removed on success and failure. The command writes:

- `data/charts/the-first-shining-star.beats.json`: source SHA-256, source path,
  chart settings, complete beat list, selected-note provenance, and normalized
  tool commands (temporary paths are represented by placeholders).
- `src/mvp-chart.ts`: the deterministic `MVP_CHART: ChartConfig` projection,
  with the source SHA-256 in a comment.

Both outputs are fully built and validated before either is replaced. Each file
is replaced atomically on its own; the two-file update is not a transaction.
If extraction, parsing, selection, or rendering fails, existing outputs remain
untouched. The chart module is generated output: change settings or the
workflow, then regenerate, rather than hand-editing generated note times.

The selected excerpt retains the existing settings: source offset `107.1`
seconds, duration `65.8` seconds, and the audience/Twilight boundary at `39.2`
seconds relative to the excerpt. Note time is source beat time minus the source
offset. Selection begins at the first detected beat at or after the excerpt
start, then takes every fourth beat index in the full detected sequence. It
does not restart at the handoff boundary. Lanes cycle through `0, 2, 1, 3` for
selected notes. Chart hit-window and handoff guards can discard centers; the
workflow never shifts a beat to make it fit. Times are rounded to six decimal
places, serialized as round-trip-safe numeric literals, and checked again after
rounding.

This is deliberately a low-density, beat-derived starting chart. Aubio beat
tracking does not infer a reliable downbeat, meter, or melody, and the lane
pattern is only an abstract assignment. No fixed-tempo grid is fabricated and
the result is not claimed to be musically perfect or human-verified. Listen to
the generated chart in the game and adjust the authoring method/settings if its
musical alignment is unsuitable. Beat intervals can vary substantially within
the recording; a single average BPM is not a reliable substitute for the
detected timestamps.

## Check cached outputs

```sh
npm run chart:check
```

Check mode does not invoke FFmpeg or aubio. It hashes the current source,
compares the source path and chart settings with the cached artifact, rebuilds
the expected chart from the cached full beat list, and compares that text with
`src/mvp-chart.ts`. It exits nonzero for a changed/missing source, mismatched
provenance/settings, malformed or stale beat projection, or stale chart. Run
`npm run chart:generate` to re-extract when source audio, tools, or extraction
behavior changes. The artifact records the requested executable names and
commands, not version output; compare installed FFmpeg/aubio versions when
investigating changed extraction results.

The defaults can be overridden for isolated runs, for example:

```sh
python3 scripts/beat_chart.py \
  --source "data/music/The First Shining Star (Remastered).mp3" \
  --artifact /tmp/first-star.beats.json \
  --chart /tmp/mvp-chart.ts
```

The command requires Python 3, FFmpeg, and aubio's `aubiotrack` to already be
installed. It installs nothing and uses no third-party Python packages.
