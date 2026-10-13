# Brightvale reduced static crowd bank

Production candidate for the authorized combined browser review under
`shining-stars-4f4.31`. User approved the prototypes and authorized remaining
production without intermediate approvals. **Not final runtime acceptance.**
No study placements, authoring files, runtime code, shaders, or animation changed.

- [crowd.glb](crowd.glb): reusable mesh-PBR pose bank, **449,668 bytes**.
- [crowd.blend](crowd.blend): editable reduced mesh derivative, not the rig authority.
- [comparison.webp](comparison.webp): lossless actual source/reduced renders, opened and inspected.
- [validation.json](validation.json): measured bounds, fingerprints, export checks,
  source comparisons, negative checks and independent reproduction result.
- [build.py](build.py), [validate.py](validate.py), [compare.py](compare.py): deterministic
  derivation, read-only validation, and read-only comparison-sheet generation.

## Provenance and scope

Immutable input: [approved variants](../../authoring/brightvale-crowd/variants/README.md),
`variants.blend` SHA256
`854a120872c1152c0c7722e5f49f2d78572da69d485afbc646a5a6bcdba1b397`.
Its contemporary clothing, anime proportions, three hairstyles, palettes and
stored Calm/Cheering/Reaching actions are retained. Original authoring scripts
are neither imported nor rerun. The production script loads the approved blend,
selects its existing single-frame actions, freezes evaluated copies, and uses
Blender's Collapse Decimate on those copies. It does not reconstruct anatomy.
Original editable rigs, actions, weights, and high-detail meshes remain untouched.

**Static is a scoped review decision, not a permanent motion architecture.**
All nine combinations are frozen poses, with no skin, skeleton, morphs, loops or
animation payload. Required future crowd motion is still unresolved. Do not
treat this bank as an animated replacement for the approved source rigs.

Blender **5.2.1 LTS**; intended browser consumer Three.js **0.186.1**. Geometry,
native/export checks are this lane's responsibility. Parent/designer owns actual
GLTFLoader/browser population, two lighting modes, visibility and final review.
Blender AgX/Cycles is not Three.js ACES/toon material parity.

## Reduction and visible result

| Variant | Source triangles / pose | Reduced Calm / Cheering / Reaching |
| --- | ---: | ---: |
| A: swept dark hair, teal tee | 5,530 | 1,998 / 1,998 / 1,999 |
| B: chestnut bob, coral cropped tee | 5,538 | 2,000 / 2,000 / 2,000 |
| C: gathered hair, mustard collared shirt | 5,772 | 2,073 / 2,073 / 2,073 |

**Same nine poses: 50,520 → 18,214 triangles, 63.95% fewer.** Do not compare the
nine-entry bank total against the original three-character lineup's 16,840.
The original assigned trio (A Reaching/B Cheering/C Calm) is 6,072 triangles.
These are measured results, not invented polygon or population budgets.

Reduction ratios are surface-specific: arms/hands .28, hair .18, head .25,
trousers .32, shoes .45, waistband .4. Small facial layers, ears, collar/placket,
and fitted shirts remain intact. An early shirt reduction dropped a narrow seam;
the retained shirt geometry preserves that material boundary and shoulder fit.
No UVs, textures, lighting bakes or compression: the bounded task found no
screen-space benefit requiring them. Tiny face regions cost little and keep the
original character read instead of substituting faceless primitives.

The unchanged composition study's ten full projected bodies measure
**65.60–149.70 px** at 1600×900: camera `(0,-15,13.89999962)`, 28 mm. These are
full projected bounds, not the visible pixels after occlusion. The comparison
sheet uses front orthographic bodies approximately 138–150 px and 61–66 px,
plus larger three-quarter diagnostics. Every pair shows **source left / reduced
right**, identical lights/camera/settings. Cycles 24 samples, denoising, AgX
Medium High Contrast, neutral gray world and three broad area lights; no blend
is saved during rendering. ImageMagick only labels/assembles the actual renders;
`cwebp -lossless -exact` preserves the assembled 8-bit image in the maintained
WebP. PNG intermediates stay in
scratch; no duplicate capture is retained in this package.

Inspected result: arm gestures, finger separation, head/neck proportions, bob
outline, swept fringe, rear knot, garment cuts and color blocks remain readable.
Hair and shoe contours are slightly coarser in the larger diagnostics. Fine
facial expression is not dependable at the smallest size, in either source or
derivative. The inherited angular clothing, pointed chin, simplified hands,
related shared anatomy and intentional layered hair contacts are not redesigned.
No fundamental silhouette degradation was observed. This does not certify
exhaustive whole-body intersections or browser appearance.

## Placement and reuse contract

The GLB contains **nine root groups**, named `Crowd.{A|B|C}.{Calm|Cheering|Reaching}`.
Each owns one named `.Surface` mesh, exported as **14 material primitives**.
All groups overlap at origin deliberately: this is a library, **not a placed
crowd**. Select groups individually; never display the entire bank unchanged.
Group extras include `pose_id`, `variant_id`, `pose`, `static_review_only`,
`forward_gltf`, `up_gltf`, source/reduced counts and source-coordinate bounds.

- glTF **Y up, +Z forward**; Blender Z up, -Y forward.
- Root/local mesh transforms are identity; root origin `(0,0,0)` on ground Y=0.
- Both soles are within **0.1 authoring mm** of ground; measured maxima are 0.07111 authoring mm.
- Exact per-pose glTF min/max bounds are in `validation.json → export.bounds_gltf`.

The source uses a metre-based **authoring dimensional convention**, not an
approved game-scale contract. **No runtime metre mapping is approved.** Bounds
and coordinates below are source units; mm measurements here (and `_m` fields
in the validation report) refer only to that authoring convention. Runtime
placement scale remains the scene owner's decision.

| Pose | Width X | Height Y | Depth Z across variants |
| --- | ---: | ---: | ---: |
| Calm | 1.01422 | 1.79701–1.85039 | .26623–.33867 |
| Cheering | 1.02237 | 1.94967 | .27312–.35187 |
| Reaching | 1.22294 | 1.79701–1.85039 | .69548–.76885 |

Reaching extends toward +Z to **.56351**; account for that hand clearance.
Rotate each audience root toward the player, not toward the city. For a Y-up
consumer and +Z-forward root, yaw is `atan2(playerX-rootX, playerZ-rootZ)`.
Keep body scale uniform. Population count is the browser owner's composition
decision; no final density or spacing target is invented here. Partial overlap
is allowed, but every placed individual must remain at least partly visible.

Recommended pool: all nine entries to avoid tying an outfit to one gesture;
the original three assigned poses are a useful initial sanity check. Repeated
copies of a given pose/variant should share its geometry/material resources.
For GPU instancing, bucket descendant primitives by **pose_id + material** and
apply the same placement matrix to all 14 primitives of each person. There are
126 bank primitives, not one draw call. No `EXT_mesh_gpu_instancing` is exported;
Blender reuse, scene cloning and GLB mesh reuse do not automatically establish
GPU instancing. Different baked poses currently have distinct geometry, including
their legs; this bank does not implement cross-pose submesh deduplication.

## Materials and validation

All **34 named source materials** retain their source PBR base colors, roughness
and metallic values. Portable material extras: `role` (e.g. `Skin`, `Hair.Plane`,
`Tee.Seam`), `family` (`skin/hair/face/clothes`), `variant` (`A/B/C/shared`).
Source names such as `B.Tee` remain stable. Source double-sided behavior remains;
no emissive materials are present. No glTF extensions are required or used.
Designer may later map these roles to shared toon materials; that is separate
runtime work, not performed here.

Native file reopens; GLB binary/accessors and Blender reimport pass. Checks cover
all pose IDs, both feet, local transforms, axis conversion, finite/unit export
normals, nondegenerate triangles, material assignments/values, and no unintended
skins, animation, images or textures. Source-vs-reduced geometric occupancy is
tested front/three-quarter/side/back, whole body and upper body, at 66/150 px:
worst intersection-over-union **97.5945%**. Bidirectional vertex/triangle-centroid
surface samples: maximum **10.679 authoring mm**, worst pose's 95th percentile
**2.732 authoring mm**.
These are sampled diagnostics/regression tolerances, not visual approval or an
exhaustive continuous-surface error bound.

Negative checks reject floating feet, a nonfinite vertex, a collapsed upper
silhouette, invalid export material, accidental skin payload, wrong root offset,
wrong source checksum, existing outputs, immutable-source outputs and writes
outside the package/scratch. Independent 8-thread generation in a relocated
path containing a space matches all native semantic records and produces the
**same GLB bytes**. Blend serialization bytes are not promised identical.
All original crowd/study package file hashes and modification times were checked
unchanged; integrity snapshots and transient logs remain in scratch only.

Export transfer size is 449,668 bytes; summed decoded POSITION/NORMAL/index
arrays are **437,148 bytes**, not GPU memory. Draw calls, load/decode time,
frame timing, full population visibility and target-device performance remain
for the combined browser review. The installed exporter logs its unavailable
optional MeshOptimizer library even though compression is disabled; export exits
0 and the resulting GLB uses no compression extension. Nothing was installed.

## Reproduce safely

Keep this package in the repository layout, or pass `--source` explicitly to a
checksum-identical approved `variants.blend`. Outputs must be new paths under
this package or `/tmp/opencode`; source and existing outputs are refused.

```bash
P="$PWD/assets/production/brightvale-crowd"
W=$(mktemp -d /tmp/opencode/crowd-production-check-XXXXXX)
timeout 180 blender --background --threads 2 --python-exit-code 1 \
  --python "$P/build.py" -- --output "$W/crowd.blend" --glb "$W/crowd.glb"
timeout 240 blender --background "$P/crowd.blend" --threads 2 \
  --python-exit-code 1 --python "$P/validate.py" -- --glb "$P/crowd.glb" \
  --report "$W/validation.json" --compare "$W/crowd.blend" --negative-test
mkdir -p "$W/images"
timeout 180 blender --background --threads 6 --python-exit-code 1 \
  --python "$P/compare.py" -- --derived "$W/crowd.blend" \
  --scratch "$W/images" --sheet "$W/comparison.webp"
```

Current GLB SHA256:
`57a36fc257fef491946d1d616445e2845bca9cad7ed9a575db4afa3fbdf3b5bb`.
Full source/export/native hashes and per-pose measurements are in the report.
