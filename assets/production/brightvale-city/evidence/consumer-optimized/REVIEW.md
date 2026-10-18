# Independent actual-app reduction comparison

**Historical reduction comparison.** Its image captures are preserved in the local ignored evidence archive; numeric comparison, reports and observations remain here. The current compressed delivery and its actual-browser verification are documented in [`../consumer-compressed/REVIEW.md`](../consumer-compressed/REVIEW.md). This report's timing results are software-backend observations, not target-device benchmarks or shipping approval.

## Actual evidence

All six full screenshots below were decoded and visually inspected, including actual city pixels, before archival. The material, fixture, camera, backend, frame and cleanup data remain in the paired `report.json` files.

| Actual app view | Full baseline | Optimized candidate |
|---|---|---|
| Audience | baseline screenshot (archived) | optimized screenshot (archived) |
| Settled Twilight | baseline screenshot (archived) | optimized screenshot (archived) |
| Observatory | baseline screenshot (archived) | optimized screenshot (archived) |

**Best candidate presentation:** the archived `optimized/twilight.png` / `baseline/twilight.png` pair. The actual sky and city lighting were settled purple/blue, not merely a changed mode label or a defeat-at-transition capture. These were controlled consumer-state reviews, not naturally earned Twilight gameplay.

The archived `observatory-detail-2x.png` files are labeled-by-path, 2× enlarged crops of the same actual screenshots (410×450 source pixels at +630,+150), not separately rendered views. `comparison.json` records decoded RGB diagnostics, fixed city crop boxes and alignment assertions. Gameplay full-image normalized RMSE is 0.00309 Audience / 0.00260 Twilight; city-only crop RMSE is 0.00652 / 0.00551. Observatory city crop RMSE is 0.00350. These are diagnostics, **not acceptance thresholds**, and not a background-only comparison.

## Comparison conditions and controlled modes

Both variants were freshly captured, sequentially, with installed Chromium 152, WebGL2, **ANGLE Vulkan SwiftShader software rendering**, 1440×900, DPR 1, same real Vite app. Prior baseline images were not reused because their note/time/brightness conditions differed. The harness substitutes only the old city GLB network response, streaming the exact chosen artifact. No permanent asset URL or game source file changes occur.

The bounded `CITY_REVIEW_CONTROLLED=1` hook is an ephemeral Vite response transform at **the existing `BrightvaleScene.updateFrame(frame)` input interface**. It passes a documented fixture to the unchanged app rendering path, original composition, appearance, sky, shadows, highway and camera; no parallel renderer or lookalike page is used. The real UI and muted audio/controller remain running. Fixture details:

- Same chart, normal timing windows, render time **16 seconds**, same actual `projectNotes()` output from notes at 16–18.4 seconds, no feedback effects, and same measured viewport layout.
- Audience: phase `audience`, transition progress **0**. Twilight: phase `twilight`, transition progress **1**. Both use intensity **0.5**, brightness **0.61**, victory false and motion disabled. Camera push stays **0** in both, preserving the requested camera rather than adding a handoff motion.
- Five city-render warmup invocations, then at least sixteen city invocations before each screenshot. The final interval buffers contain **18 samples per view**, after warmup. Observatory uses the actual app's different camera/PBR presentation, with elapsed time 0 and reduced motion true in both variants.
- Exact paired equality assertions passed for camera properties, renderer backend/DPR, complete input fixtures and city matrices. Gameplay matrix remains scale approximately .35 and translation approximately (0,3.9,-55), with the original float32 values. Highway, clipping and occlusion remain unchanged and accepted.

This validates actual settled **consumer lighting/appearance**, not the game rules' transition logic, earned strength, or natural gameplay performance. It deliberately avoids another unreliable full-song autoplay attempt. No UI text was rewritten to imply otherwise.

## Visible reduction versus baseline

Architectural silhouette, golden citadel, roofs/glazing, district layout, water ribbons, rock faces, bridge openings and dominant shadow structure remain consistent in both modes and the Observatory. No newly missing landmark, displaced material region, disconnected building or gross shadow seam was observed.

Foliage shows small canopy-edge/facet/highlight changes on close comparison, especially in the enlarged Observatory tree groups. It does **not** read as missing trees or substantially thinned crowns. Shallow trim curvature/shading changes are difficult to distinguish at native screenshot size; no objectionable stair-stepping or silhouette loss was found in the exposed trim. These are tolerable, reviewable stylized losses, not pixel identity. The Observatory's closer background is a useful independent check and still reads as the same detailed city.

The existing Blender-beauty versus app-Toon differences—warmer Audience masonry, darker green roofs, hard light bands, opaque water and absent authoring mist—remain shared by both variants. They are **not optimization regressions** and are not used to request a redesign or disturb the approved placement. Review is limited to these views, not every possible future camera or animation.

## Observed loading and materials

Both artifacts logged successful city loading/validation, scene composition and rendering. No app exceptions, missing required root/Window material, GLB decode failure, unsupported-extension warning or new material-mapping warning was observed. Both runs emitted the existing warning: `PCFSoftShadowMap has been removed. Using PCFShadowMap instead.`

Independent read-only GLB JSON comparison confirms **all 107 material dictionaries exactly equal**. In actual gameplay, **all 97 mapped Toon materials' observed properties match exactly**, baseline versus candidate, in both modes. Nine source emitting variants still resolve to seven shared `emissive_window` Toon materials; both left/right glazing pairs are equivalent. At controlled brightness .61, Window's observed intensity is **.396499985** (.65×.61), far glass **.0121999997** (.02×.61); all seven match across artifacts and modes. Same-mode strength is intentionally fixed, so no extra emission gain is expected solely from switching the lighting preset.

Actual gameplay city batches fall from **6,644 to 1,116**, all one-instance consumer batches. This is observed composition accounting, separate from the following actual renderer counters; modeler primitive counts are not substituted for draw calls.

## Actual renderer and timing observations

Counters below are the renderer's exposed statistics at the **end of the city-containing scene render invocation**, including other scene geometry. They are not city-only draws, sums across sky/overlay/shadow passes, GPU memory or a target-device benchmark. Fixed note fixtures explain the baseline's small difference from the historical 6,884-call capture.

| View | Calls baseline → optimized | Submitted triangles baseline → optimized | Mean rAF interval baseline → optimized |
|---|---:|---:|---:|
| Audience | 6,876 → **1,348** | 3,132,176 → **2,775,392** | 1,251.8 → **1,117.6 ms** |
| Settled Twilight | 6,876 → **1,348** | 3,132,176 → **2,775,392** | 1,249.9 → **1,119.4 ms** |
| Observatory | 4,353 → **915** | 1,804,124 → **2,395,945** | 780.5 → **1,046.3 ms** |

Gameplay: **80.4% fewer observed calls**, **11.4% fewer submitted triangles**, approximately **10–11% shorter mean intervals** in this limited software run. **Observatory regresses:** despite 79.0% fewer calls, submitted triangles rise **32.8%** and mean intervals grow **34.0%**. This is consistent with coarser spatial-batch culling submitting whole batches containing offscreen geometry; it is not evidence of extra authored content. Reduced delivery triangles do not guarantee reduced submissions from every camera.

**Candidate remains clearly heavy:** 136.6 MB delivery, 2.59M asset triangles, 2.78M submitted triangles in this gameplay invocation, and roughly 1.1-second software-rendered intervals. The large draw-call improvement is real here but is not an equivalent frame-time gain or a universal performance win. Do not call it runtime-ready. Observatory culling/batch granularity deserves a separately authorized measured decision before claiming broad performance improvement; no automatic further reduction or reframe is requested.

Backend is SwiftShader, not the user's GPU. These are one fresh run per variant, 18 observed intervals per view after warmup, not repeated hardware benchmarks or isolated CPU/GPU timings. All UI/app work and screenshot orchestration remain present. JS heap samples: gameplay Audience approximately **290 MB → 206 MB** used, Twilight **314 MB → 206 MB**; these are point-in-time JS heap observations affected by GC, **not decoded GPU storage, total process memory, peak memory or guaranteed savings**. No device or shipping budgets are invented.

## Verification, attempts and cleanup

Initial controlled hook attempt ran after Vite's TypeScript transform and rejected its expected marker. It failed safely before rendering, then cleaned up. `baseline/attempt-1-hook-failure.json` records it. The hook now explicitly runs before TypeScript transformation. Initial successful paired captures suspended native audio, which caused the actual pause modal; both variants were recaptured with audio running muted. Only final unobstructed paired screenshots/reports are current evidence; no defeat/paused image is used for the final verdict.

Each final run preflighted available RAM (~15.4 GiB) and scratch (~15.3 GiB), used one unique owned profile and ephemeral app/debug ports, never user port 3100. Browser stderr, load attempts/outcomes, warnings and cleanup outcomes are retained in each report. All owned browsers exited, app servers closed, profiles were removed and debug ports were confirmed closed. No crash or OOM occurred. Post-cleanup available RAM was ~15.1 GiB.

Final hashes rechecked unchanged:

- Baseline `city.glb`: `fb03e38ffd4592bd14ed2f9451d0671c1f09de3fecf779ea22d36c292928277c`.
- Candidate `city-optimized.glb`: `7afe010e17ad3dcf87c67efc63d158b96bd8d6a75cdfc313013d2bec570d5fff`.
- Native `city.blend`: `edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff`.

Harness syntax check passed. All six original PNGs decoded through installed FFmpeg for comparison; both enlarged crops were separately opened and inspected. Paired fixture/camera/backend/material assertions passed. The modeler's geometry/export tests were not rerun; no broader app tests were assigned. No geometry changes, authoring edits, exports, installs, app source edits, permanent integration, commits or pushes occurred.

Reproduce sequentially from repository root (one process at a time):

```bash
CITY_REVIEW_CONTROLLED=1 CITY_REVIEW_VARIANT=baseline timeout 240 node tests/browser/brightvale/city-production-review.mjs
CITY_REVIEW_CONTROLLED=1 CITY_REVIEW_VARIANT=optimized timeout 240 node tests/browser/brightvale/city-production-review.mjs
```

Parent/user retain final acceptance. **Visual reduction looks acceptable for review; performance remains a mixed result with an explicit Observatory regression.**
