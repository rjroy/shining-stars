# Brightvale MVP

## Requirements and setup

- Node.js `^22.13.0 || ^24.0.0 || >=26.0.0` (required by the pinned ESLint and Vitest versions)
- npm

Install the exact dependency tree from the lockfile and start the local Vite server:

```sh
npm ci
npm run dev
```

The browser entry is `index.html`; `src/main.ts` owns the application lifecycle and wires the chart, game, audio transport, and UI. The selected MP3 remains in `data/music/` and is imported as a Vite asset URL; do not copy it into a public directory or modify the original recording. Chart timing is still provisional and has not been listening-verified.

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

This runs all-miss and timed-WebDriver-key scenarios through the full excerpt and takes about two real-time track runs. It characterizes the provisional chart and UI resource accounting; it does not verify musical timing by listening or represent human performance. Screenshots are saved under `/tmp/opencode/brightvale-stage5/`.

For two full-length gameplay-flow checks on the real `AudioContext.currentTime` clock, use the separate normal-animation-frame browser run:

```sh
python3 tests/browser-flow.py http://127.0.0.1:5173/
```

This takes about two real-time excerpt runs. WebDriver sends timed lane keys against the provisional hand-authored chart; the run characterizes interaction and resource accounting, not musical accuracy or listening verification. Screenshots and JSON diagnostics go under `/tmp/opencode/brightvale-stage5/`.

The timing assertion can be checked with a test-only negative control (expected nonzero exit) that reveals the actual results panel at the final chart note while its audio source is still active:

```sh
python3 tests/browser-flow.py http://127.0.0.1:5173/ --scenario all-miss --early-results-negative-control
```
