# Brightvale browser validation

Run browser checks from the repository root:

```sh
npm run test:brightvale:browser -- responsive
npm run test:brightvale:browser -- normal # demo excerpt / Normal variant
npm run test:brightvale:browser -- gameplay the-first-shining-star hard
npm run test:brightvale:browser # gameplay plus responsive checks
```

The bounded gameplay harness selects a song ID and generated difficulty
variant through the actual Observatory controls. It requires the demo excerpt
so its native-clock judgment scenarios remain bounded; use catalog acceptance
below for full tracks. Gameplay output is muted, the Play action is trusted,
and the run uses the native `AudioContext.currentTime` clock. A separate
post-judgment screenshot probe is explicitly labeled as clock-scaled visual
evidence and is not native-clock judgment evidence.

The responsive runner uses the installed Chromium, Vite, and production
runtime. Each runner owns its loopback Vite/Chromium processes and fails if its
listeners remain. Evidence is written under
`.lore/local/evidence/brightvale-runtime/`. Responsive readiness requires a
fresh measured-layout event and matching CSS/DPR-scaled canvas dimensions; a
timeout is recorded as failed, and an interrupted run cannot leave an old pass
marker. Tested sizes are samples, not a minimum viewport or performance budget.

Actual-app catalog acceptance has an explicit bounded smoke and exhaustive
mode:

```sh
npm run test:brightvale:acceptance
npm run test:brightvale:acceptance:exhaustive
```

Both statically validate 29 songs / 87 variants. Smoke plays three variants
across songs and difficulties; exhaustive plays all 87. Reports record planned
and completed playback counts. They use muted output, trusted Play clicks, and
native `AudioContext.currentTime`; they do not alter judgment timing or bypass
autoplay policy. Playback does not establish listening approval.

Runtime-layout data is regenerated from the authoritative structure JSON and
accepted review source with:

```sh
node tools/brightvale-layout/generate.mjs
```

The unit/DOM test suite remains `npm test`; browser checks are explicit because
they require Chromium and take real audio-clock time.
