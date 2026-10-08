# Brightvale MVP

## Requirements and setup

- Node.js `^22.13.0 || ^24.0.0 || >=26.0.0` (required by the pinned ESLint and Vitest versions)
- npm

Install the exact dependency tree from the lockfile and start the local Vite server:

```sh
npm ci
npm run dev
```

The neutral browser entry is `index.html`; the application owner entry is `src/main.ts`. This bootstrap intentionally has no game behavior, audio loading, visual layout, or music import. Synthetic test support is isolated under `src/test-support/` and does not depend on the supplied track.

## Checks and build

```sh
npm test             # deterministic Vitest tests
npm run typecheck    # strict TypeScript check
npm run lint         # ESLint
npm run format:check # Prettier check
npm run build        # typecheck and production Vite build to dist/
```

Use `npm run format` to apply the configured Prettier formatting. Both `format` and `format:check` target the same explicit app/setup allowlist: package manifests, TypeScript/Vite/ESLint configuration, the HTML entry, `src/main.ts`, `src/test-support/*.ts`, and this README. They do not traverse Beads, agent settings, lore, or data directories. Keep TypeScript strict, prefer explicit types at module boundaries, and keep deterministic model tests independent of browser playback and source audio. Add future behavior tests before implementation; this bootstrap's tests only smoke-test the synthetic fixture and controllable clock.
