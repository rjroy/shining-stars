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
