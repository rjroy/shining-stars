# Brightvale MVP

## Requirements and setup

- Node.js `^22.13.0 || ^24.0.0 || >=26.0.0` (required by the pinned ESLint and Vitest versions)
- npm

Install the exact dependency tree from the lockfile and start the local Vite server:

```sh
npm ci
npm run dev
```

The browser entry is `index.html`; `src/main.ts` owns the application lifecycle and wires the selected generated difficulty chart, game, audio transport, and UI. Songs and collections are described in `data/catalog.json`; per-song charts are eagerly imported from `data/charts/generated/`, while source audio remains in `data/music/` and is imported as a Vite asset URL. Do not copy MP3s into a public directory or modify the original recordings. Onset-derived charts are provisional and have not been listening-verified.

Per-song percent-based excerpt settings and Easy/Normal/Hard authoring values live in `data/charts/song-authoring.json`; the runtime profile values remain in `data/charts/difficulty-profiles.json`. See the [chart workflow](docs/beat-chart-workflow.md) for the v2 schema, final-strength formula, cache freshness, catalog editing, and generated output paths.

## Song output volume

Set the Vite environment variable `VITE_SONG_VOLUME` to a number from `0` (silent output) through `1` (full output). The unset value preserves full volume. Blank, malformed, non-finite, or out-of-range values safely fall back to full volume. This controls only the audio output gain; song timing and gameplay continue normally. For silent AI/browser testing, start the development server with the variable set so the gain is initialized before any playback:

```sh
VITE_SONG_VOLUME=0 npm run dev -- --host 127.0.0.1 --port 5173
```

Keep that environment on the server while running automated song-playback checks such as `python3 tests/browser-flow.py http://127.0.0.1:5173/`.

## Music chart authoring dependencies

- **aubio** provides `aubioonset` for offline onset-timestamp extraction. The user installed Arch's `aubio 0.4.9-25`; the executable is `/usr/bin/aubioonset`.
- **FFmpeg** converts source audio to a full-track WAV when needed, preserving the original recording and timestamp origin.

These system tools are for chart authoring, not browser runtime dependencies. Installation is managed by the user; agents must never install software or dependencies on the user's behalf. See [the offline beat-chart workflow](docs/beat-chart-workflow.md) for generation, provenance, and cached-check instructions.

Generate and verify all 29 configured songs with `npm run chart:generate` and `npm run chart:check`. These defaults intentionally pass `--all`, producing/checking 87 difficulty variants plus onset caches. Run the focused, standard-library Python test suite with `npm run test:chart`.

## Checks and build

```sh
npm test             # deterministic Vitest tests
npm run typecheck    # strict TypeScript check
npm run lint         # ESLint
npm run format:check # Prettier check
npm run build        # typecheck and production Vite build to dist/
```

Use `npm run format` to apply the configured Prettier formatting. `format` and `format:check` use the same explicit app/setup allowlist: package manifests, TypeScript/Vite/ESLint configuration, the HTML entry, all TypeScript and CSS under `src/`, and this README. The Python browser harness is intentionally excluded. These commands do not traverse Beads, agent settings, lore, or data directories.

For browser lifecycle regression checks, start Vite and run the standard-library Python harness against its URL:

```sh
npm run dev -- --host 127.0.0.1 --port 5173
python3 tests/browser-lifecycle.py http://127.0.0.1:5173/
```

The harness requires Chromium and ChromeDriver at `/usr/bin/chromium` and `/usr/bin/chromedriver`. It suppresses the animation-frame loop to isolate retry and hidden-during-load lifecycle paths; it does not replace a real-tab check with normal animation frames, user-gesture playback, and actual pause/resume behavior.

For browser validation of the actual Observatory app and generated charts:

```sh
npm run test:brightvale:acceptance          # bounded real-app smoke
npm run test:brightvale:acceptance:exhaustive # all 87 chart variants
```

Both modes statically validate all 87 generated chart variants. Smoke plays representative charts from different songs and difficulties in the real app; exhaustive starts and returns from every supported song/difficulty pair and takes longer. Evidence is written under `.lore/local/evidence/observatory-acceptance/`. Playback is muted through `VITE_SONG_VOLUME=0`, uses trusted clicks and the browser's native audio clock, and does not claim musical accuracy or human approval. The script reports the number of actual playback runs; smoke does not imply 87 played runs.
