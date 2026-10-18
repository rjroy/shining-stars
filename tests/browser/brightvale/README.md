# Brightvale browser validation

Run browser checks from the repository root:

```sh
npm run test:brightvale:browser -- responsive
npm run test:brightvale:browser -- normal # First Shining Star / Normal variant
npm run test:brightvale:browser -- gameplay the-first-shining-star hard
npm run test:brightvale:browser # gameplay plus responsive checks
npm run test:brightvale:favorites # actual-app favorites toggle regression (Chromium required)
```

The bounded gameplay harness selects a song ID and generated difficulty
variant through the actual Observatory controls. Its native-clock judgment
scenarios use four safe audience notes at or after 12 seconds, at least four
seconds before Twilight, and spaced at least 0.75 seconds apart. It supports
full tracks as well as excerpts when the selected chart provides those notes;
catalog acceptance below covers broader full-track playback. Gameplay output
is muted, the Play action is trusted, and the run uses the native
`AudioContext.currentTime` clock. A separate
post-judgment screenshot probe is explicitly labeled as clock-scaled visual
evidence and is not native-clock judgment evidence.
The no-key visual pass owns the audience screenshots/OCR and audience viewport
samples. The native-clock receipt replay performs no captures or viewport
changes; Twilight responsive screenshots run after it pauses at the transition.
The Victory outcome is checked from its live HUD and scene geometry after the
final time-sensitive input probe; it does not add a late-run screenshot.
The browser preload keeps per-note judgment and trusted-keydown receipts
independent and explicitly retires each note after its judgment/input window,
so a Miss notification cannot erase a late keydown or let stale same-lane
notes claim later events.
Gameplay renderer state/retry checks are scoped to the gameplay experience
screen. On failure, the report includes bounded CDP exception/console/request
events and a compact DOM/resource snapshot; the original failure remains the
reported cause. Each run preflights its single owned temporary root and removes
its browser profile during cleanup.

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
