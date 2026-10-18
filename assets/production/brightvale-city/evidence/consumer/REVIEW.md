# Historical full-baseline consumer review — superseded findings retained

**Historical full-baseline review.** The then-open placement and Twilight concerns were subsequently resolved by explicit placement acceptance and the compressed normal-route review in [`../consumer-compressed/REVIEW.md`](../consumer-compressed/REVIEW.md). The production GLB and earlier comparison images are archived locally; this report preserves the initial observations and measurement context.

## Method and identity

`tests/browser/brightvale/city-production-review.mjs` runs the real Vite app in installed headless Chromium at 1440×900. A disposable server middleware streams the exact new city GLB in response to the unchanged old city network URL. It does not replace the URL module, loader, geometry, appearance implementation, camera, highway or placement. An in-memory HTML entry wrapper imports the same installed Three module, observes real scene render callbacks, then imports the original app entry. No app source file is edited. Original scale .35 / translation (0,3.9,-55) and Y-up orientation remain.

Artifact SHA256 verified before each run: `fb03e38ffd4592bd14ed2f9451d0671c1f09de3fecf779ea22d36c292928277c`, 167,035,476 bytes. Source is immutable authoring commit d37afb4. Browser audio and Vite song volume are muted. One owned ephemeral app port and unique temporary Chromium profile at a time; none uses port 3100. All owned browsers, servers and profiles were cleaned up, with closed debug ports checked.

## Actual inspected evidence

- **`gameplay-audience-existing-placement.png`**: best actual-consumer image. Audience gameplay, real Toon appearance. City pixels inspected directly, especially left citadel/waterfall and right district, not only sky.
- `observatory-existing-placement.png`: actual app's menu camera and PBR presentation, **not** a Toon/Twilight/neutral substitute. It tightly crops the city to a cliff/bridge background.
- The native-playback transition capture is archived and remains **not evidence of settled Twilight appearance**. The current settled Twilight screenshot is in `../consumer-compressed/`.
- `report.json`: final Audience/material inspection; `attempt-2-native-playback.json`: earlier full native-playback attempt, including the original misleading capture name. The renamed PNG above is that same capture. Its gameplay `renderer.info` snapshots describe the last overlay pass, not whole-scene calls; use the final report's `citySceneRenderStats` instead.
- `attempt-1-instrumentation-failure.json`: failed observer attempt. It imported a second Three instance, so observation timed out even though load logs succeeded. The corrected harness shares Vite's optimized Three module. No multiple-instance warning in corrected runs. A third short observer run still watched the source-name root after gameplay batching; the final run watches `Brightvale.City` and captures actual consumer materials. No geometry or framing adjustments occurred between attempts.

## Findings

**Historical concern, later superseded by explicit user acceptance.** In this full-baseline capture, the central highway masked the hero crossing, much of the ravine, receiving river and lower terrace structure; the left gold spire extended beyond the top edge. The user later accepted the exact placement, camera, cropping and occlusion. Do not interpret these old observations as a current blocker or authorization to reframe.

**Actual mapping:** loader logs city validation and scene composition success; no decoder exceptions, missing-root/material failures or unsupported-extension warnings were observed. Gameplay city has 6,644 primitive batches/instances and **97 distinct MeshToonMaterial objects**, not 107 PBR materials. This is the current consumer's signature sharing, not exporter palette merging. Nine source emitting materials resolve to seven window Toon materials: left/right glazing pairs have identical source properties and share replacements. All seven carry `emissive_window`, double-sidedness and expected color/emission. At captured Audience brightness their observed intensities equal source strength × **0.22** (e.g. Window .65 → .143, far glass .02 → .0044). Full values are in `report.json` under `cityConsumer`.

Compared with the approved native Audience and the Blender reimported Audience/Twilight images, the browser's Audience city is much warmer, roofs read dark green/teal rather than blue, and stone/terrain flatten into hard Toon bands. Gold reads as lit yellow rather than reflective metal; water reads as opaque turquoise flat sheets. The preserved architectural silhouette, waterfall ribbons and stone articulation are still recognizable in visible regions. These are actual consumer lighting/shader differences, not evidence of changed GLB base colors. Metallic/roughness/IOR specular behavior and authoring mist/AgX/studio lighting are not reproduced by this Toon presentation. The bright green existing surrounding ground further separates it from the approved cliff/river presentation.

## Measured limits, not budgets

Initial host preflight: ~15.1 GiB available RAM and ~16 GiB free tmpfs; no crash or out-of-memory condition observed. Final cleanup left ~14.6 GiB available RAM. Actual Audience city-scene render callback recorded **6,884 calls / 3,132,464 submitted triangles** for that scene's render invocation, including other gameplay geometry; not city-only counts, full multipass frame totals or GPU memory. The city assembly itself has 6,644 one-instance batches: no effective repeated-geometry draw reduction for this artifact. Last overlay-pass counts of 6–9 calls in the earlier report are expressly not frame totals.

Final Audience observation: JS heap ~298 MB used / 340 MB allocated, **not GPU/process memory**. Last 72 requestAnimationFrame intervals averaged ~542 ms, with a 3,883 ms maximum; these include startup/composition and headless-environment effects, not a steady-state device benchmark. In the earlier prolonged native-playback run, last 120 intervals averaged ~1,421 ms. Automated native-clock keyboard playback missed most notes and reached defeat at transition; it did not produce a settled second lighting mode. This environment cannot establish acceptable gameplay performance. No target budget is invented.

Only corrected-run renderer warning: `PCFSoftShadowMap has been removed. Using PCFShadowMap instead.` No app exceptions recorded. No neutral mode was available in the inspected normal UI; none was fabricated.

## Handoff

This initial validation established working load and inspected Audience. Its placement/Twilight gates were addressed in later stages; see the current compressed normal-route review. Historical renderer measurements remain constrained to their original software backend and are not target-device claims.

Reproduce the bounded Audience inspection: `CITY_REVIEW_AUDIENCE_ONLY=1 timeout 150 node tests/browser/brightvale/city-production-review.mjs`. Omitting the environment flag runs native playback to the transition and requires visual inspection before making any Twilight claim. No new installs, committed runtime changes, source saves, GLB changes, commits or pushes occurred.

Final verification: harness syntax check passed; all three retained PNGs decoded with installed FFmpeg and were identified as 1440×900 sRGB images. A preliminary Pillow check was unavailable (`ModuleNotFoundError`); no dependency was installed. Both production GLB and immutable authoring hashes were rechecked and remain exact. The final harness's added scratch-space assertion and truthful transition filename received syntax verification; the actual captures predate those two bookkeeping changes. No broad application test suite was assigned or run.
