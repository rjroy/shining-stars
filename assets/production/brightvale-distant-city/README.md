# Brightvale city — bounded production slice

**Geometry/export candidate, 2026-10-11; ready for the separate browser lane.**
Authorized under `shining-stars-4f4.30`, not whole-city production, final look,
runtime integration, or user acceptance. This follows the endcap transfer/toon
pilot; it does not introduce a new toon design. No crowd or unrelated wall assets.

## Current package and provenance

- `city-slice.blend`: editable derivative, no camera/lights/reference objects.
- `city-slice.glb`: current uncompressed export; no duplicate baseline export here.
- `produce.py`, `validate.py`, `preview.py`: deterministic derivation, direct GLB
  and native checks, read-only matched rendering. `technical-validation.json`
  records checks; `comparison.webp` is inspected geometry evidence, not browser art.
- Immutable input: `../../authoring/brightvale-distant-city/city.blend`, SHA-256
  `4beb993e9b580bb0b6dd47e5523a0ad9aecc8c26804a4b4cbdc42cc5488caa2c`.
  Its README records the provisional detailed-baseline acceptance. No source
  changes, source regeneration, architecture redesign, or new approval implied.

**Source-preservation mechanism:** the original authoring `build.py` and detailed
`city.blend` both remain unchanged (verified against Git HEAD; blend hash checked
above). Production never imports, runs, or rewrites that generator. `produce.py`
opens the pinned detailed blend into disposable Blender memory, selects existing
source objects, identifies existing mesh shells, and removes selected faces via
Blender's mesh API. It reindexes only retained original vertices/faces, preserves
linked data, then saves a separate `city-slice.blend` and exports it. This is
mesh-level reduction of an in-memory source copy, **not procedural reconstruction
with lower-detail generation parameters**. There is no contract mismatch; UVs
and baking were not justified or performed for this bounded slice.

## Slice and measured reduction

Retains complete `District.09.landmark`, `District.01.front`, and
`District.08.middle`: spire/attached wings, detailed palazzi/towers and their
arcaded foundations. All source transforms and component names remain. Mesh
names beginning `District.00` are inherited shared-library names, not added districts.

| Measurement | Detailed source slice | Derivative |
|---|---:|---:|
| Objects / mesh placements / unique meshes | 31 / 27 / 24 | 31 / 27 / 24 |
| Unique / placed triangles | 75,108 / 82,924 | 33,246 / 36,489 |
| Unique Blender vertices | 44,310 | 28,746 |
| GLB bytes (same exporter/settings/metadata) | 3,615,260 | 1,584,308 |

Whole source inventory: 196 mesh placements, 64 unique meshes, 149,012 unique /
500,928 placed triangles; 132 additional linked placements. This slice preserves
three linked palazzo pairs (01.0↔08.3, 01.1↔08.4, 01.2↔08.5). GLB retains those
shared meshes, **not GPU instancing**: 132 unique material primitives, 150 placed
primitives, 57,220 decoded primitive vertices. These are structural counts, not
measured draw calls, GPU memory or a target-device budget.

The single reduction removes back/side faces of precisely recognized .07-unit
lancet/reveal shells and .09-unit narrow mullions. Exact outward faces and all
colors remain, including unlit recesses. Everything structural—roofs, gold roof
edges, ribs, buttresses, open crowns and arcade contours—stays untouched. No
decimation, bake, atlas, LOD, compression, or changed palette. **56.0% fewer placed
triangles / 56.2% fewer transfer bytes**, without introducing texture/decode costs.
The new detail faces intentionally have open boundaries; this is not watertight.

## Geometry evidence and known limitations

Opened all four actual PNGs and the retained WebP. Matching roof/pinnacle outlines,
open crown, flying-support gaps, window rhythm and arcade edges survive. Slight
window-edge shading differences do not change the architectural read. Both raw
image pairs have identical alpha>0.5 silhouettes (IoU 1.0; zero differing pixels);
this sampled measure supplements, not replaces, visual inspection.

The top row is an **unscaled 1000×600 crop** of the saved study's 1600×900 view;
no surrounding scene was exported or rendered. Study city scale .35, translation
`(0,55,3.9)`; camera `(0,-15,13.89999962)`, Euler X `1.45591974`, 28 mm / 36 mm
sensor. Removed extrusion depth measures mean .256 px, max .607 px. The repeated
palazzo pair is approximately 146 / 99 px high; the spire is 545 px high.
**The inherited study camera crops the spire top by 187 px.** No camera alteration
conceals that limitation. The bottom row is a separate complete-silhouette
diagnostic: orthographic scale 52, `(−69,−39,49)` aimed at `(−28,65,22)` after the
same city transform, 1000×1100. It is not gameplay framing.

Both pairs: Cycles 24 samples, seed 422, denoised, AgX Medium High Contrast,
neutral broad lighting, emission suppressed identically for geometry inspection,
no bloom/fog. Exported emission is **not** suppressed. The oversized foundation
cutoffs, repetitive architecture and unapproved study framing are inherited
limitations, not repaired or hidden here. Close/oblique runtime views still need
review; this is a distant-view derivative, not an interior asset.

## Browser handoff contract

GLB uses **X right, Y up, source +Y mapped to −Z**. Root `CITY.ProvisionalLayout`
is at origin with identity transform; district and building origins/transforms
are preserved, not centered or baked to study scale. Bounds:
`min (−117.45,−7,−60.36)`, `max (−41.43,118,4.015)`.
Blender bounds: `(−117.45,−4.015,−7)` to `(−41.43,60.36,118)`.
These are provisional authoring units, **not established runtime meters**.

For the exact study projection in Three.js, put the loaded scene under a group
with uniform scale `.35`, position `(0,3.9,−55)`. At 1600×900 use perspective
vertical FOV `39.76070473°`, camera `(0,13.89999962,15)`, rotation X
`−0.1148765842` radians, Y/Z zero, Y up. Do not silently recenter the asset.
This deliberately reproduces the inherited crop; use a separately labeled
diagnostic camera to inspect the entire spire, not as substitute gameplay proof.

Material names and `material.userData.city_role` after GLTFLoader extras transfer:
`Limestone→body`, `Recess→recess`, `Slate→roof`, `Cornice→stone_trim`,
`Gilt→gold`, `Window→emissive_window`. `source_material` is also retained.
Objects retain `source_object`, `shared_geometry_id`, and existing
`library_variant` where present. All six materials are opaque/double-sided,
flat-shaded geometry, source linear PBR values preserved. Only Window emits:
linear RGB `(1,.47,.12)`, strength `1.8`, through supported
`KHR_materials_emissive_strength`; no textures/UVs, animation, skin or external URI.

Next lane: Three.js **0.186.1** GLTFLoader and the existing provisional shared
MeshToon mapping from `../brightvale-platform-endcaps/validation/`, warm Audience /
violet Twilight. Preserve IDs/emissive intent when replacing materials; do not
expect Principled/AgX parity or copy Blender review lighting as final art. Measure
loader output and renderer costs; material/lighting acceptance stays separate.

## Reproduction and verification

Blender **5.2.1 LTS**, installed glTF exporter **5.2.40**; no installations.
Scripts reject existing outputs and mismatched source hashes. Inputs may be
relocated with `--source`; the immutable source is an explicit dependency, not
duplicated in this production package. Writes are limited to package-root files
or `/tmp/opencode`. Use a fresh scratch directory and absolute paths:

```bash
P="$PWD/assets/production/brightvale-distant-city"
W=$(mktemp -d /tmp/opencode/city-reproduce-XXXXXX)
timeout 180 blender -b -t 8 --python-exit-code 1 --python "$P/produce.py" -- \
  --output "$W/city-slice.glb" --blend "$W/city-slice.blend" --report "$W/build.json"
timeout 180 blender -b -t 8 --python-exit-code 1 --python "$P/validate.py" -- \
  --blend "$W/city-slice.blend" --glb "$W/city-slice.glb" \
  --compare "$P/city-slice.glb" --negative-test --report "$W/validation.json"
timeout 360 blender -b -t 8 --python-exit-code 1 --python "$P/preview.py" -- \
  --derived "$W/city-slice.blend" --output-dir "$W" --comparison "$W/comparison.webp"
```

Preview assembly uses installed ImageMagick, Adwaita Mono and cwebp. It only adds
labels, equal matte and the stated crop; no retouching. All runs exited 0. Native
save/reopen, independent derivation and relocation with a space in the path pass;
relocated GLB bytes match. Direct GLB checks cover hierarchy, shared reuse,
transforms/bounds, material roles/emission, oriented triangles and corner normals
(max position error 7.63e−6; normal-component error 6.50e−5). Blender reimport
preserves geometry/materials with measured normal reconstruction error .000298.
Eleven deliberate defects/guard violations are rejected. Source checksums remain
unchanged. This is explicit local validation, not an official Khronos-validator
run or browser performance/appearance approval.
