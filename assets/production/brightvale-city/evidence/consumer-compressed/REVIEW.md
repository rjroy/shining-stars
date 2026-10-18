# Final compressed-asset browser check

**Ready for parent commit gating/user testing: actual-browser load and visual checks passed.** No commit was made by this reviewer; no shipping/GPU-performance approval is implied.

## Normal route and decoder

Actual request: `http://127.0.0.1:37455/assets/production/brightvale-city/city-meshopt.glb`, HTTP **200**, **59,559,056 bytes**. The browser's actual response-body SHA256 is **`db79454415423002bf87eb36d845a427f2c6c3e2dc4a3e63a05e4b2ded1be878`**, exactly matching the selected disk artifact before and after the run.

**No network substitution/interception middleware was installed**, no redirected asset URL, no old-city fallback. A read-only fetch observer clones the normal response for hashing and leaves the loader's original response unchanged. The real configured GLTFLoader loaded, decoded, validated and rendered the compressed city successfully.

The installed Three Meshopt decoder module was requested from this same app origin under `/node_modules/.vite/deps/three_addons_libs_meshopt___decoder__module__js.js` and returned **200**. **Every observed HTTP request was same-origin; no external CDN/decoder/WASM request, `Network.loadingFailed` event or app exception occurred.** This is successful actual decoding, not merely a successful GLB download. Request/response identity, decoder URL, outcomes and checks are retained in `verification.json`.

## Actual images and comparison

- [`observatory.png`](observatory.png)
- [`audience.png`](audience.png)
- [`twilight.png`](twilight.png) — best settled-mode inspection image

All three were opened and visually inspected, including city surfaces, silhouette, foliage, water and dominant shadows. All three fully decoded RGB images are **pixel-identical to the matching prior integrated spatial screenshots** under `../consumer-integrated-smoke/`. Recorded camera, complete scene fixture, backend and renderer settings match exactly. All **97 observed gameplay Toon materials/emission properties** also match. No visual regression or change to the approved placement/camera/highway was found.

Audience/Twilight use the same existing controlled actual-app scene-update inputs: fixed render time 16 seconds and chart notes, intensity .5 / brightness .61, transition 0/1, motion disabled and camera push 0. Real UI/audio/controller runs muted; HUD remains Audience, not relabelled to imply naturally earned Twilight. Observatory uses its unchanged camera with elapsed time 0. These are real app render paths, not a surrogate renderer or a test of natural game-rule progression.

Only a short smoke was run: two warmup and two further observed city invocations per view, no new benchmark. Existing invocation counts remain unchanged (Observatory 1,607 calls / 1,740,509 triangles; gameplay 2,536 / 2,775,392). SwiftShader software backend; no hardware-performance claim.

## Limits, warnings and cleanup

This harness runs the **normal dev app**, not the built `/shining-stars/` preview; its controlled source-interface hooks do not support the built entry. Fixer's supplied build and five subpath checks remain separate deployment evidence, not independently rerun or claimed as browser-tested here. No decoder subpath failure occurred at the observed dev URLs. Built-subpath browser decoding is not asserted.

No app/decoder console errors or exceptions. Existing warning: `PCFSoftShadowMap has been removed. Using PCFShadowMap instead.` One unrelated **`/favicon.ico` HTTP 404** was observed; it did not affect assets or rendering and is not concealed as an entirely error-free network trace.

Disk/RAM preflight passed (~14 GiB available RAM, ~15 GiB scratch). One unique owned app/debug port and temporary Chromium profile, no port 3100/user browser; `VITE_SONG_VOLUME=0`, `--mute-audio`. Browser exited, server closed, profile removed and debug port confirmed closed in `finally`. No crash/OOM or retry.

Compressed hash and authoring hash `edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff` were rechecked unchanged. Harness syntax, response identity, image decoding/pixel comparisons, material/fixture comparisons and cleanup assertions passed. No model/export/full test-suite reruns, runtime source or asset edits, installs, commits, pushes, baking or further optimization. Verbose temporary capture data was consolidated into the compact `verification.json`; final evidence contains only three screenshots, this report and verification.

Reproduce: `CITY_REVIEW_CONTROLLED=1 CITY_REVIEW_INTEGRATED_SMOKE=1 CITY_REVIEW_VARIANT=meshopt timeout 150 node tests/browser/brightvale/city-production-review.mjs`.
