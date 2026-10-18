# Independent actual-consumer spatial comparison

**Historical spatial-artifact review.** At the time, this recommended `city-optimized-spatial.glb` for review. The spatial geometry was subsequently losslessly compressed and the runtime now selects `city-meshopt.glb`; the successful compressed-route browser review is recorded in [`../consumer-compressed/REVIEW.md`](../consumer-compressed/REVIEW.md). The paired PNGs are preserved in the local ignored archive; measured observations and comparison records remain here. This report concerns the uncompressed spatial payload only. It removed the previous optimized candidate's observed Observatory triangle over-submission with no discernible new visual loss. Gameplay traded more calls for essentially unchanged timing in this limited software run.

Approved city placement, camera, highway, clipping, occlusion and Toon style remain **exactly unchanged and accepted**. They are not reopened as blockers.

## Actual inspected evidence

| Actual app view | Fresh previous optimized | Fresh spatial candidate |
|---|---|---|
| Audience | optimized screenshot (archived) | spatial screenshot (archived) |
| Settled Twilight | optimized screenshot (archived) | spatial screenshot (archived) |
| Observatory | optimized screenshot (archived) | spatial screenshot (archived) |

The archived `spatial/twilight.png` was the best actual image; the matched previous-optimized screenshot and both `observatory-detail-2x.png` enlargements are also archived. All six full images and both enlarged crops were opened and visually inspected. FFmpeg fully decoded all six originals for RGB comparison.

Both gameplay views preserve the citadel/district silhouettes, roofs, windows, foliage mass, water sheets, stone articulation and dominant visible shadow structure. The closer Observatory preserves tree facets, fine bridge/roof trim, arch openings, cliff shading and receiving water. No newly missing object, material patch, seam or objectionable shadow change was discernible. This is visual equivalence at these views, **not global pixel identity** or certification of every future camera.

Fresh previous-opt versus spatial normalized RGB RMSE: Audience **0.00008655**, Twilight **0.00008049**, Observatory **0.00000281**. Fixed city-crop RMSE: **0.00016984 / 0.00016329 / 0** respectively. The inspected Observatory detail crop is pixel-equal; whole screenshots are not claimed equal. `comparison.json` records crop boxes, decoded-image hashes and diagnostics. These values are not acceptance thresholds and do not replace actual city-pixel inspection.

The retained [full-baseline Audience/Twilight/Observatory evidence](../consumer-optimized/baseline/) supplies context without another triple replay. The previously documented subtle leaf/trim loss from full baseline to reduced geometry remains; spatial grouping adds no visible reduction loss. Source-beauty versus app-shader differences remain shared consumer presentation, not this candidate's regression.

## Identical controlled actual-app setup

Fresh previous-opt and spatial captures ran **sequentially**, one real Vite app and owned Chromium at a time, using `tests/browser/brightvale/city-production-review.mjs`. Only artifact selection/separate evidence output and render-setting observation were added to the harness. Actual loading still intercepts the unchanged old city GLB request and streams the exact selected artifact; no permanent URL/source integration, surrogate renderer or lookalike UI.

The same existing validation-only Vite hook supplies frames at the real `BrightvaleScene.updateFrame` interface. Rendering/composition/appearance/shadows remain the app implementations. As before: 1440×900, DPR 1; normal chart; fixed render time **16 seconds**; identical chart-projected notes for 16–18.4 seconds; no feedback; intensity **.5**, brightness **.61**; Audience transition **0**, settled Twilight transition **1**; motion disabled and camera push **0**. Native audio/controller runs muted. Observatory elapsed time is **0**, reduced motion true. The actual DOM HUD is not relabelled; it still says Audience while the controlled Twilight render is purple/blue. These are **controlled visual-state comparisons, not naturally earned gameplay or a test of game-rule transitions**.

Exact equality assertions passed across fresh previous-opt, spatial, retained previous-opt and retained full-baseline reports for recorded camera, complete fixture and backend/DPR/city matrix. Fresh render settings also match: sRGB output, ACES filmic tone mapping (enum 4), exposure **1.05**, enabled shadows using actual PCF type **1**, shadow auto-update false, pixel ratio 1. Gameplay matrix remains the original float32 scale .35 / translation (0,3.9,-55), original perspective camera; Observatory uses its different original camera/placement. No camera, city or highway adjustment occurred.

Historical full-baseline evidence is therefore valid for appearance and recorded invocation-count context, **not a concurrent timing benchmark**. Fresh previous-opt gameplay screenshots decode identically to their retained prior counterparts; Observatory differs only minutely. No broad rerun was needed.

## Actual invocation measurements

These are renderer counters observed at the end of the **city-containing scene render invocation**, including other geometry in that scene. They are not city-only draws, a sum over the full sky/world/overlay/shadow frame, asset primitive counts, GPU memory or a target-device benchmark.

| View | Full baseline, retained | Previous optimized, fresh | Spatial, fresh |
|---|---:|---:|---:|
| Gameplay calls, both moods | 6,876 | 1,348 | **2,536** |
| Gameplay submitted triangles, both moods | 3,132,176 | 2,775,392 | **2,775,392** |
| Observatory calls | 4,353 | 915 | **1,607** |
| Observatory submitted triangles | 1,804,124 | 2,395,945 | **1,740,509** |

Spatial cuts Observatory submissions **27.4% versus previous opt**, and **3.5% below the retained full baseline**, at the cost of **75.6% more Observatory calls than previous opt** (still 63.1% fewer than full baseline). The observed triangle regression is resolved at this camera. **1,740,509 is an actual app measurement**, distinct from the offline city-only proxy 1,740,485.

Gameplay calls rise **88.1% versus previous opt**, while submitted triangles stay exactly equal; calls remain **63.1% below full baseline**. Actual city composition has **2,304 one-instance batches**, versus previous opt's 1,116. These batch/resource counts are distinct from the scene invocation counters above.

## Frame sample and tradeoff

Installed **HeadlessChrome 152 / WebGL2 / ANGLE Vulkan SwiftShader software rendering**, not the user's hardware GPU. Each view received five city-render warmup invocations and at least sixteen further city invocations before capture; each final timing buffer has **18 rAF intervals**. One fresh run per artifact, not repeated hardware trials or isolated GPU timings. App/UI work remains present; no shipping/device budget is assumed.

| Mean observed rAF interval | Previous optimized, fresh | Spatial, fresh | Change |
|---|---:|---:|---:|
| Audience | 1,107.4 ms | **1,116.6 ms** | +0.8% |
| Settled Twilight | 1,103.7 ms | **1,118.5 ms** | +1.3% |
| Observatory | 825.0 ms | **725.0 ms** | **−12.1%** |

This supports the spatial candidate as the better balanced option: a meaningful observed Observatory improvement, with small gameplay interval differences that are **not enough to establish a reliable hardware slowdown**. More calls may matter differently on a real GPU/CPU. The candidate is not a universal performance win, and the gameplay-call increase remains explicit.

Historical full-baseline intervals were ~1,252 / 1,250 / 781 ms; earlier previous-opt Observatory was ~1,046 ms, versus ~825 ms in this fresh run despite identical call/triangle counters. This substantial cross-run variability is why no precise speedup versus historical baseline is asserted, and why the new result must not be advertised as recovering a guaranteed 34% hardware regression. The fresh sequential comparison is the relevant timing evidence.

**Still clearly heavy:** 135,037,616-byte delivery, 2.59M asset triangles, 2.78M submitted gameplay triangles and approximately 1.1-second gameplay intervals on this software backend. Gameplay JS heap point samples increase from approximately **206/207 MB** previous opt to **237/246 MB** spatial (Audience/Twilight), consistent with more consumer objects but affected by GC. They are not peak, process or GPU memory measurements. A slightly smaller GLB does not imply a smaller decoded/runtime footprint.

## Loading, materials and shadows

Both fresh runs logged successful city validation, scene composition and first rendering. **No app exception, missing root/Window role, decode error or unsupported-extension/material warning was observed.** Both emitted only the existing renderer warning: `PCFSoftShadowMap has been removed. Using PCFShadowMap instead.` Complete load attempts/outcomes and browser stderr are in each `report.json`.

Independent read-only GLB JSON checks confirm **all 107 material dictionaries exactly equal** across full baseline, previous opt and spatial. In both gameplay moods, **all 97 mapped Toon materials' observed name/type/role/color/emission/intensity/side properties match exactly across all four reports** (retained full/previous and fresh previous/spatial). Nine source emitters still resolve to seven equivalent `emissive_window` replacements. Window intensity is **.396499985** and far glass **.0121999997**, source strength × controlled brightness .61, in both variants and moods. No role or emission treatment is lost. The original app shadow policy/settings remain enabled; dominant visible shading/shadows were compared directly, without introducing inspection lights or toggling shadows off.

## Verification and safety

`hashes-before.json` and `hashes-after.json` match for all four inputs:

- Spatial: `73022af6f2bc45e38cd5bcbb7eb03f24cfacdd43d9b3f715e91f489fe0e464ff`.
- Previous opt: `7afe010e17ad3dcf87c67efc63d158b96bd8d6a75cdfc313013d2bec570d5fff`.
- Full baseline: `fb03e38ffd4592bd14ed2f9451d0671c1f09de3fecf779ea22d36c292928277c`.
- Authoring: `edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff`.

Both runs preflighted memory/disk; initial available RAM was ~15 GiB and scratch ~15.3 GiB. Unique owned ephemeral app/debug ports and profiles, no port 3100 or user browser, muted audio. Both owned browsers exited, app servers closed, temporary profiles were removed and debug ports confirmed closed in `finally`. No crash/OOM, failed attempt or retry occurred in this followup.

Harness syntax, paired alignment/material assertions, all four unchanged hashes and actual screenshot decoding passed. No geometry/export/modeler unit tests were rerun and no broader app suite was assigned. Writes are confined to bounded harness adaptation and this new evidence/report. No GLB/authoring/runtime source changes, installs, exports, commits or pushes.

Reproduce one at a time:

```bash
CITY_REVIEW_CONTROLLED=1 CITY_REVIEW_SPATIAL_COMPARISON=1 CITY_REVIEW_VARIANT=optimized timeout 240 node tests/browser/brightvale/city-production-review.mjs
CITY_REVIEW_CONTROLLED=1 CITY_REVIEW_SPATIAL_COMPARISON=1 CITY_REVIEW_VARIANT=spatial timeout 240 node tests/browser/brightvale/city-production-review.mjs
```

**Parent/user retain acceptance. Prefer the spatial candidate for the next decision; do not automatically integrate, ship, or start another optimization pass.**
