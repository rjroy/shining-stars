# Historical normal-route smoke — spatial GLB before lossless compression

**Historical smoke only.** This bounded test passed against the uncompressed spatial GLB before the Meshopt delivery was selected. Its payload, route and screenshots do **not** validate the current compressed runtime. The later compressed normal-route verification is recorded in [`../consumer-compressed/REVIEW.md`](../consumer-compressed/REVIEW.md).

## Normal request and exact payload

- Actual request: `http://127.0.0.1:43539/assets/production/brightvale-city/city-optimized-spatial.glb`.
- HTTP **200**, `model/gltf-binary`, **135,037,616 bytes**.
- SHA256 of the actual browser response body: **`73022af6f2bc45e38cd5bcbb7eb03f24cfacdd43d9b3f715e91f489fe0e464ff`**, exactly matching the selected file. Disk hash rechecked unchanged afterward.
- CDP observed the normal asset request/response, not disk/service-worker cache. No old distant-city GLB request occurred.
- **No asset substitution middleware was installed. No route interception, redirect or response replacement was used.** A read-only fetch observer clones the normal returned response for byte counting/hash calculation; the original response goes unchanged to the real loader. `verification.json` records response identity and observed network responses; `report.json` retains loader/composition outcomes.

## Actual renders inspected

- The prior `observatory.png`, `audience.png`, and `twilight.png` copies were identical to the final compressed screenshots and are preserved in the local ignored evidence archive. Use [`consumer-compressed/REVIEW.md`](../consumer-compressed/REVIEW.md) for the retained current screenshots.

All three screenshots were opened, visually inspected and fully decoded with installed FFmpeg. **Decoded RGB pixels exactly match the corresponding prior spatial evidence**, with equal recorded camera, fixture, backend and renderer settings. All 97 observed gameplay Toon materials/emission properties also match. No missing/displaced city or new shading/shadow defect observed.

The normal asset URL/load is **not overridden** by the visual fixture. Only the existing actual-app scene-update input receives the same fixed 16-second notes, .5 intensity/.61 brightness, transition 0/1 and disabled motion/camera push. Native controller/audio runs muted; DOM HUD remains Audience, not falsified to imply earned Twilight. These captures prove controlled consumer appearance, not natural game-rule transitions. No fake UI or parallel renderer.

Smoke used two warmup and two additional observed city-render invocations per view rather than repeating the benchmark. Invocation counters remain as expected: Observatory 1,607 calls / 1,740,509 triangles; gameplay 2,536 calls / 2,775,392 triangles. **No timing/performance conclusion is drawn from this short SwiftShader software-rendered smoke.** Existing size/performance limits and user-testing-only status remain.

## Errors, verification and cleanup

No app exceptions, console errors, city loading/validation/composition failures or unsupported material/extension warnings. Only existing warning: `PCFSoftShadowMap has been removed. Using PCFShadowMap instead.`

Memory/disk preflight passed (~15 GiB available RAM, ~15 GiB scratch); unique owned app/debug ports and profile, never port 3100 or user browser; `VITE_SONG_VOLUME=0` and `--mute-audio`. Owned Chromium exited, server closed, profile removed and debug port verified closed in `finally`. No crash or OOM.

Harness syntax, response hash/length/status/path assertions, no-old-URL assertion, screenshot decoding/comparison, mapped-material comparisons and cleanup checks passed. No full benchmark, broader test suite, bake, export, install, commit or push was performed. Fixer's earlier tests/build are outside this smoke's claimed validation.

Reproduce:

```bash
CITY_REVIEW_CONTROLLED=1 CITY_REVIEW_INTEGRATED_SMOKE=1 CITY_REVIEW_VARIANT=spatial timeout 150 node tests/browser/brightvale/city-production-review.mjs
```

Parent/user own final handoff and acceptance. Texture/normal baking remains discussion only; none was started.
