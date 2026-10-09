# Brightvale MVP

## Requirements and setup

- Node.js `^22.13.0 || ^24.0.0 || >=26.0.0` (required by the pinned ESLint and Vitest versions)
- npm

Install the exact dependency tree from the lockfile and start the local Vite server:

```sh
npm ci
npm run dev
```

The browser entry is `index.html`; `src/main.ts` owns the application lifecycle and wires the chart, game, audio transport, and UI. The selected MP3 remains in `data/music/` and is imported as a Vite asset URL; do not copy it into a public directory or modify the original recording. The active chart is generated from detected onsets; its timing is still provisional and has not been listening-verified.

Per-song authoring settings, including initial Twilight Strength, live in `data/charts/song-authoring.json`; see the [chart workflow](docs/beat-chart-workflow.md) for the schema and validation rules.

## Music chart authoring dependencies

- **aubio** provides `aubioonset` for offline onset-timestamp extraction. The user installed Arch's `aubio 0.4.9-25`; the executable is `/usr/bin/aubioonset`.
- **FFmpeg** converts source audio to a full-track WAV when needed, preserving the original recording and timestamp origin.

These system tools are for chart authoring, not browser runtime dependencies. Installation is managed by the user; agents must never install software or dependencies on the user's behalf. See [the offline beat-chart workflow](docs/beat-chart-workflow.md) for generation, provenance, and cached-check instructions.

Generate the chart with `npm run chart:generate`; verify that the generated chart and cached beat artifact still match the source and current settings with `npm run chart:check`. Run the focused, standard-library test suite with `npm run test:chart`.

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

For the full gameplay flow, use the normal animation-frame loop and the actual browser `AudioContext.currentTime` clock:

```sh
python3 tests/browser-flow.py http://127.0.0.1:5173/
```

This runs two native-audio, real-`AudioContext.currentTime` WebDriver scenarios with the normal animation-frame loop: all-miss defeat at the Twilight handoff, and a timed strategic run that reaches a combat outcome when the configured chart supports it. It checks displayed Renown/strengths, unresolved future notes, early audio stopping, source non-overlap, and restart from the configured excerpt offset. The run characterizes interaction and scoring, not musical accuracy or listening verification. Screenshots and JSON diagnostics go under `/tmp/opencode/brightvale-stage5/`.
