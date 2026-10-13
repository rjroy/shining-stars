# Brightvale browser validation

Run production-browser checks from the repository root:

```sh
npm run test:brightvale:browser -- responsive
npm run test:brightvale:browser -- normal
npm run test:brightvale:browser -- hard
# all three in sequence:
npm run test:brightvale:browser
```

The checks use the installed Chromium, Vite, and production runtime. Gameplay
runs mute song output. Each runner owns its loopback Vite/Chromium processes and
fails if its listeners remain. Reports and captures are written only to
`.lore/local/evidence/brightvale-runtime/`, which is ignored by Git. The
runner first executes deterministic responsive-readiness/report-state tests.
Responsive readiness waits for a fresh measured-layout event and matching CSS
and DPR-scaled canvas dimensions; a timeout is recorded as `failed`, and an
interrupted run leaves a `running` marker rather than an old pass. The
Normal/Hard runs exercise the actual app and chart. Responsive checks exercise
the actual app at measured layouts and DPR values, including canvas backing
dimensions and WebGL readback across resize cycles. They cover the checked
samples, not a minimum supported viewport or device-performance budget.

Runtime-layout data is regenerated from the authoritative structure JSON and
accepted review source with:

```sh
node tools/brightvale-layout/generate.mjs
```

The unit/DOM test suite remains `npm test`; the browser checks are explicit and
separate because they require Chromium and take real audio-clock time.
