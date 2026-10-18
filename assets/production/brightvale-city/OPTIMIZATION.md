# Brightvale — targeted geometry reduction and spatial batching

**Historical reduction and batching report.** The measured full/reduced/spatial GLBs described here are retained in the local ignored archive, not as current runtime assets. The current compressed delivery and full reproducible chain are documented in [README.md](README.md) and [SPATIAL.md](SPATIAL.md). The approved native source and accepted layout/camera/highway remain unchanged.

## Placement approval is binding

User: **“The placement is perfect, but I agree that the geometry reduction needs to occur.”** Preserve external scale **.35**, translation **(0,3.9,-55)**, game camera/highway, cropping and occlusion exactly as [the actual gameplay capture](evidence/consumer/gameplay-audience-existing-placement.png). Its SHA-256 is `b21a2e9465d00e3c4cecff21e11bf391be6d1bf6ace5097f7c883475cdc0a6c1`; [placement-approval.json](placement-approval.json) records this separately from appearance/performance acceptance. The earlier reviewer framing objection is superseded, not an outstanding user blocker. Do not use this work to reframe the scene.

## Inputs and measured choices

- Approved native: `../../authoring/brightvale-city/city.blend`, SHA-256 `edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff`.
- Archived full GLB: `city-full-baseline.glb`, SHA-256 `fb03e38ffd4592bd14ed2f9451d0671c1f09de3fecf779ea22d36c292928277c`; **167,035,476 bytes / 2,946,548 triangles / 5,368 mesh resources / 6,644 material primitives / 107 materials**. Archive details: [archived-intermediates.json](archived-intermediates.json).
- Measured contributors: districts **1,094,388** triangles; planting **958,118**; skyline **405,596**; citadel **234,688**; water **93,400**; bridges **84,804**; terrain **75,554**. The 107 source material variants remain distinct; no palette collapse.
- Existing consumer evidence reports **6,884 calls and 3,132,464 submitted triangles** for a gameplay frame, with **6,644 city batches**. These are historical actual-app measurements, not predictions for this candidate.

The first small read-only pilot established that the large masonry objects are already minimal disconnected block faces: e.g. `Left | L.citadel.east.link | Left masonry` stayed **7,392** triangles even at a 6° dissolve. It was therefore protected, not destructively collapsed. `Left | L.high.outer.tower | Left trim` changed **8,148 → 6,838** at 2°, versus 6,220 at 6°; the more conservative **2°** choice was selected without chasing a numerical target. A representative rooted crown changed **4,216 → 2,108** triangles while retaining **all 527** leaf components; hanging foliage changed **5,200 → 2,600**, retaining **all 650** components.

### Geometry policy

1. Family 07, exclusively `city.foliage`, no UVs or custom normals: Blender collapse decimation **ratio .5**, triangulated. Existing octahedral leaflet components become tetrahedral components, not newly generated plants. The derived mesh is explicitly validated before counting (the exporter also does this). If global collapse would delete a rendered component or flatten a solid leaflet below four triangles, the **whole source object is retained unchanged**, not silently thinned. Connected-component and material-region counts must remain unchanged. Both directions of vertex-to-other-surface distance are measured in world BU; this is not an exhaustive Hausdorff bound.
2. Families 02/03, exclusively `city.trim`, no UVs or custom normals: **2° limited dissolve**, with normal/material/seam/sharp/UV delimiters and boundary dissolution disabled. This coarsens shallow trim curves, not whole buildings.
3. Everything else is protected: entire citadel/golden spire, all roof and glazing surfaces, masonry, bridges/arches, terrain, water, bark/soil, UV-bearing and custom-normal meshes. Every protected triangle's local position, normal and UV attributes is compared **bitwise** against the retained full GLB before batching. Every source node's world transform is checked. All 5,368 source objects remain accounted for, regardless of the gameplay camera's occlusion; observatory use is not discarded.

Changed foliage facets and shallow trim curvature are intentional, reviewable losses. An initial staged-count failure exposed exporter cleanup of over-collapsed small leaf components; that output was rejected, and explicit mesh validation plus the source-retention guard were added before producing the candidate. The test suite includes the otherwise-missed case where a leaf remains one connected component but collapses to a flat triangle. This is a bounded first reduction, not the maximum possible reduction and not a claim that the remaining geometry is cheap enough to ship.

### Batching policy — separate from reduction

`composition.ts:233–280,310–333` groups by **geometry identity + mapped material**, then gives all city batches cast/receive shadows. Independent source meshes therefore do not combine merely because they share a color. The recipe creates one primitive per **original material + city family + 32-BU 3D spatial cell + attribute layout**. The cell comes from each source primitive's world-bounds center; a primitive stays whole rather than being cut at cell edges. This retains regional culling rather than making one giant city mesh, though large source primitives can span cells.

Batching uses already-Y-up exported geometry. It applies each original world transform **once**, with inverse-transpose normals; output root and batch nodes are identity. It does **not** apply the external game placement or a second axis conversion. Only exactly identical position/normal/UV tuples are deduplicated. Every staged triangle corner's complete attributes are compared against the batched artifact; material boundaries and all **107** material records remain unchanged. This includes the real `Window`, nine source `emissive_window` variants and original colors/strengths; seven Toon equivalents are expected from existing mapping, not merged by this recipe.

There is **no GPU instancing in the GLB**. Batching changes resource and culling granularity; it does not justify predicting frame time, GPU memory or actual renderer calls. The app still owns appearance and uniform city shadow participation. Geometry reduction and batching have separate recorded counts so their benefits/losses are not conflated.

## Measured candidate

The historical `city-optimized.glb` stage was **136,641,564 bytes**, SHA-256 `7afe010e17ad3dcf87c67efc63d158b96bd8d6a75cdfc313013d2bec570d5fff`; it is preserved in the local ignored archive. [optimized-manifest.json](optimized-manifest.json) identifies that stage; [reduction-coverage.json](reduction-coverage.json) accounts for every original object and [batch-coverage.json](batch-coverage.json) maps every source material primitive into its batch. The current delivery is [`city-meshopt.glb`](city-meshopt.glb).

| Stage | Unique / placed triangles | Mesh resources | Material primitives | Bytes |
|---|---:|---:|---:|---:|
| Preserved full baseline | 2,946,548 / 2,946,548 | 5,368 | 6,644 | 167,035,476 |
| Reduced, before batching (scratch only) | 2,589,764 / 2,589,764 | 5,368 | 6,644 | 145,948,180 |
| Reduced + spatially batched candidate | **2,589,764 / 2,589,764** | **1,116** | **1,116** | **136,641,564** |

Actual geometry reduction: **356,784 triangles (12.1%)**. Primitive/resource consolidation: **83.2% fewer material primitives**, **not measured renderer calls**. Final byte reduction: **18.2%**. The still-large **2.59M triangles / 136.6MB** is a conservative baseline improvement, not an agreed delivery size. Batching changes no triangles or complete triangle attributes. Index packing uses unsigned 16-bit where valid, otherwise 32-bit; it does not quantize positions, normals or UVs. A forced-32-bit intermediate was 149,561,920 bytes; selecting the appropriate integer width saved 12,920,356 bytes without a geometry/material change.

| Family | Before → candidate triangles |
|---|---:|
| Citadel/golden spire | 234,688 → 234,688 |
| Districts | 1,094,388 → 1,048,648 |
| Skyline | 405,596 → 405,596 |
| Terrain | 75,554 → 75,554 |
| Bridges | 84,804 → 84,804 |
| Water | 93,400 → 93,400 |
| Planting | 958,118 → 647,074 |

There are **651 objects with fewer triangles**: 570 foliage objects and 81 trim objects. Another 202 trim trials produced no triangle saving. **66 foliage objects were retained unchanged** by the safety guard; 4,449 other objects were protected from the outset. No object/family was omitted or moved. Maximum measured source-vertex→reduced-surface distance is **0.181660 BU**, reverse **0.098941 BU**; these are sampled-at-all-vertices surface-distance measurements, not pixel error or a full surface Hausdorff guarantee.

### Integrity checks

[optimized-validation.json](optimized-validation.json) records **all 107 material dictionaries exactly unchanged**, all 5,368 sources accounted for, every source transform preserved, **5,403,612 protected triangle corners byte-compared**, and **7,769,292 staged/batched triangle corners attribute-compared**. Overall Y-up bounds are **exactly unchanged**. All root/batch nodes are identity; no external dependencies, cameras, lights, skins or animations are introduced.

Clean Blender reimport has 1,116 meshes and **2,587,386 triangles**. Its `mesh.validate()` removes **2,378 duplicate index-faces** exposed by shared batch indexing (including the known four water duplicates); the actual GLB retains all **2,589,764** triangles. Every batch's unique triangle-coordinate set is checked unchanged, with matched-vertex error **0**. Duplicate coordinate faces with distinct normal/UV indices can remain; no claim of a watertight or duplicate-free union is made. Blender evidence therefore has this disclosed importer-cleanup difference from the GLB that the actual consumer will load.

### Completed reproducibility and visual verification

**16/16 tests passed**, including unsigned-short/unsigned-int index boundaries and equivalence of the isolated-city camera projection to the unchanged accepted game placement/camera. Final production, fresh-process repeat, independent staged/batched validation and all five renders exited **0** from a non-repository scratch cwd. Two independent native evaluations/reductions produced **byte-identical staged GLBs**; final packing reproduced a **byte-identical optimized GLB, manifest and both coverage records**. Canonical semantic hash also matches. Same-machine/version determinism only; versions and exact commands/helper hashes are in [optimized-verification.json](optimized-verification.json).

| Actual inspected comparison | Baseline | Candidate | Full-image normalized RMSE |
|---|---|---|---:|
| Gameplay-camera-equivalent Audience, 1440×900 | historical image (archived) | historical image (archived) | 0.00188315 |
| Gameplay-camera-equivalent Twilight, 1440×900 | historical image (archived) | historical image (archived) | 0.00144639 |
| Original city study Audience, 1792×1008 | historical image (archived) | historical image (archived) | 0.00236042 |

All six comparison inputs were decoded and visually inspected, including an enlarged foliage/trim crop. No new missing/repositioned landmark, disconnected roof, closed bridge opening, displaced water route or lost foliage mass was observed. Leaflet facets and trim shading show subtle differences; **not pixel-identical**. The accepted spire crop remains unchanged, not treated as a new framing defect. Cropped RMSE diagnostics (to avoid relying only on unchanged background) are **0.00230457 / 0.00177102 / 0.00317253**; crop definitions and commands are recorded. These are diagnostics, not approval thresholds or actual-app captures.

The artifact has **4,891,684 position-accessor entries**, 135,587,080 embedded binary bytes, 1,105 unsigned-short index accessors and 11 unsigned-int accessors. These are serialized resource measurements, not GPU memory or performance. Historical intermediate GLBs are preserved in the local ignored archive; reports and selected full renders remain in this package.

## Historical recipe and tests

The historical test suite and measured provenance remain available in this package. The current from-master reproduction entry point is [`reproduce-city.mjs`](reproduce-city.mjs), which writes all full→reduced→spatial→compressed stages into a new external workspace and does not depend on the ignored archive. The lossless output is independently decoded and compared through Three.js GLTFLoader.

## Review boundary

Blender evidence is an **isolated-city PBR** comparison, not a browser capture. The gameplay-camera equivalent is derived from the recorded actual camera and inverse accepted city placement, without changing either asset or the app camera/layout. Original native mood lighting/world/mist are inspection context, not GLB payload. Highway/UI occlusion remains for the parent's actual consumer harness; no surrogate overlay is passed off as gameplay. Both mood pairs use exactly the same geometry/camera per artifact. A separate original whole-city view checks composition beyond the accepted gameplay crop. Historical PNG evidence is preserved in the ignored local archive and indexed by [archived-evidence.json](archived-evidence.json); measured diagnostics remain above.

The runtime now selects the compressed delivery with the bundled Meshopt decoder. Parent/designer's compressed normal-route Audience/Twilight/Observatory comparison passed and is recorded in [`evidence/consumer-compressed/REVIEW.md`](evidence/consumer-compressed/REVIEW.md). No target-device performance acceptance is inferred from this historical reduction report.
