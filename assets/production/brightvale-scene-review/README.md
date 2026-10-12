# Brightvale combined browser review

This isolated Three.js 0.186.1 harness assembles the current approved study layout from the production GLBs and the authoritative `../brightvale-structure-layout.json`. It is a browser appearance/structure review, not game integration, runtime acceptance, or a target-device benchmark.

## Current evidence

- [Audience](audience.webp) and [Twilight](twilight.webp): real headless Chromium WebGL captures at the unchanged 1600×900 study camera.
- [report.json](report.json): per-mode source hashes, baselines, placement/camera signatures, instancing bounds checks, crowd frustum evidence, assembled-scene triangle/object counts, renderer counters, local load/first-render timing, WebGL backend and scene-surface pixel difference. `geometry.sceneTriangles` counts all assembled geometry with each `InstancedMesh` multiplied by its instance count; `renderer.triangles` is the separate count submitted in the rendered frame. Unique decoded geometry storage is reported separately.
- `index.html`, `main.js`, `validate.sh`: local isolated review harness and bounded reproduction/validation.

The current browser build uses the 42-unit highway, original platform and endcaps under the exact shared 14° playfield matrix; the complete full-city asset under its saved `.35`/translation transform; 26 long sections plus 27 complete posts under their supplied matrices; both exact study ground surfaces; and 25 static audience figures. The crowd retains ten original crowd matrices and adds fifteen review-only distributed positions, selected from the nine-pose bank. This is a visual-density choice for this review, not a proposed final count, population rule, or animation system. Figures are directed toward the player and placed outside the four gameplay lanes. The automated crowd check tests only whether geometry bounds intersect the camera frustum; it does not prove unobstructed visibility or occlusion. Partial visibility is established by parent/designer image review, and partial overlap is allowed.

All seven loaded GLBs are checked against their current SHA-256 values in the harness. Layout GLB matrices are applied as whole-scene transforms; source node origins are retained and no extra axis conversion/recentering is done. City repeat geometry/material pairs, identical framing modules and repeated audience primitive geometry/materials are rendered as `InstancedMesh` batches. These batches preserve per-instance world matrices; the browser checks aggregate bounds against the unbatched sources. They are review-consumer work only and do not change any source GLB.

## Material and lighting treatment

The harness retains the imported source materials as recorded baseline evidence and uses shared browser-only `MeshToonMaterial`s with a nearest-filtered three-step ramp. Source linear base colors, material roles, emissive channels and emissive strengths remain separate; pure-emission hit regions remain black-based. Audience uses warm amber light and Twilight violet light. Both retain the same geometry, transforms, material mapping and camera. A pixel-difference check compares the lower scene crop, not the sky/backdrop alone.

Mineral-panel procedural fine noise is not baked or synthesized; the production package's constant base colors and roughness are used. Toon shading does not reproduce source metallic/roughness response, reflection environments, Blender AgX or the authored procedural noise. Window, hit-region and post-lens emission is carried through Three.js material emissive channels; no bloom/glow is claimed.

## Run

From any directory:

```bash
assets/production/brightvale-scene-review/validate.sh
```

The script uses only already-installed repository Vite, Chromium, Prettier and ImageMagick. It starts its own loopback Vite server on a temporary port, tests invalid and missing GLB routes, runs both scene modes, writes only the two current WebPs and report in this directory, and removes its scratch directory/server on success. Failure scratch is retained under `/tmp/opencode` and named in the error. No package install, game source/config edit, source-asset edit, or write to another production package occurs.

## Review limits

Decoded typed-array sizes, GLB transfer sizes, draw calls, assembled-scene triangles and rendered-frame triangles are measured here, but are not GPU-memory or target-device performance estimates. The current screenshots intentionally retain the approved camera, playfield tilt, raised circular plaza/low ground, semicircular post-and-section enclosure, cropped skyline, and central gameplay lanes. The ten original crowd matrices are retained and fifteen additional static figures are review-only. Physical support, collision, runtime meter scale, adaptive framing, and final approval remain open outside this harness.
