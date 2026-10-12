# Brightvale — full-city production derivative

**2026-10-12 · `shining-stars-4f4.31` · ready for assembled browser review.**
User approved the city-slice previews and authorized completing the rest without
intermediate approvals. This extends that proven reduction, not the city design.
Final assembled appearance, target-device performance and game integration remain
separate. Prior slice approval/evidence is preserved in Git **3422c0c**; obsolete
slice binaries and the independent slice browser harness are no longer maintained.

## Current files and immutable inputs

`city.glb`, editable `city.blend`, deterministic `produce.py`, `validate.py`,
read-only `preview.py`, `technical-validation.json`, and **one** `comparison.webp`.
The blend retains all district/building origins and linked editing relationships;
there are no studio objects, cameras, lights, external textures or libraries.

Detailed authority: `../../authoring/brightvale-distant-city/city.blend`, SHA256
`4beb993e9b580bb0b6dd47e5523a0ad9aecc8c26804a4b4cbdc42cc5488caa2c`.
Its README holds the approved brief/concept and provisional model acceptance.
Original `build.py` SHA256
`c44934cbf1c4064a320a3dd5caaa3c880ddbd9f211bfb5c8846d6b0b29c0a29d`.
**Neither file is modified; the authoring generator is never imported or run.**
Production opens the detailed blend in disposable Blender memory, removes only
identified shell faces, and saves/exports a separate derivative. It does not
regenerate architecture with cheaper parameters.

## Reduction and retained form

| Full-city measurement | Source | Production |
|---|---:|---:|
| Objects / mesh placements / unique meshes | 221 / 196 / 64 | 221 / 196 / 64 |
| Unique / placed triangles | 149,012 / 500,928 | 71,110 / 216,633 |
| Unique Blender vertices | 87,554 | 58,654 |
| GLB bytes (same settings/metadata) | 7,063,500 | 3,359,324 |

**56.8% fewer placed triangles, 52.4% fewer transfer bytes.** All 21 districts,
2 arcaded connectors, common retaining infrastructure and 132 additional linked
placements survive unchanged.
All roofs, pinnacles, gold edges, ribs, buttresses, arcade contours, crown openings,
flying-support gaps, transforms and six material assignments remain.

The only reduction keeps the exact outward caps of 3,768 unique .07-unit lancet
shells and 631 .09-unit mullions, removing their nonresolving backs/edges. Guards
check actual pointed/rectangular outlines, affine tower taper, material names,
ordered rings, face connectivity and depth—not a blind mesh-name classification.
All 9 palace, 23 tower and 8 landmark meshes are checked; 24 structural meshes are
untouched. Retained source polygons match exactly. No decimation, UV/bake, atlas,
LOD, compression or design change was justified. Detail boundaries are deliberately
open: this is a distant facade asset, not a watertight interior model.

## Geometry evidence

Opened all four actual renders and the current comparison sheet. Roof rhythms,
layered skyline, open lanterns/crown, arcades and all city negative spaces retain
their source read. Small window-edge shading differences do not alter architecture.
Both source/derivative alpha>0.5 silhouettes match exactly (IoU 1; 0 differing
pixels). Removed extrusion depth at the study camera: mean **.233 px**, max
**.607 px** across 105,753 projected vertex pairs.

Top row: complete **1600×900 saved study view**, no image crop/reframing. Its spire
top remains cropped by 187 px, an inherited composition limitation. Bottom row:
separate complete-silhouette orthographic diagnostic, scale 100.45, camera
`(10.5,-39.5,49.4)` aimed at `(0,69,18.95)` after the same city transform. Both pairs:
Cycles 24 samples/seed 422, AgX Medium High Contrast, neutral broad lights, no fog
or bloom, emission suppressed equally only for inspection. GLB emission survives.
Repetitive architecture and oversized exposed foundations are inherited, not fixed
or concealed. These are geometry previews, **not browser/final-lighting evidence**.

## Export and composition contract

One identity root **`CITY.ProvisionalLayout`**, never recentered or baked to study
scale. Blender is X lateral, +Y toward city, Z up. GLB is **X right, Y up, source
+Y → −Z**. Bounds: Blender `(-133,-12,-13)` → `(133,99,118)`; GLB
`(-133,-13,-99)` → `(133,118,12)`. Units remain provisional, not agreed meters.

Current composition authority is `../../authoring/brightvale-scene-review/scene-review.blend`
(SHA256 `fb630ac23fc576c42ebe4961b917b207fefb4894f9bbfc0b812bb6bf7329046b`).
Read its saved camera and checked **all 221 city matrices** against one common
transform (max error 7.63e−6). Three.js: put the loaded city under a group at
`(0,3.89999985695,-55)`, uniform scale `.34999999404`. At 1600×900 use vertical
FOV `39.76070473°`, camera `(0,13.8999996185,15)`, Euler X `−.1148765842`, Y/Z 0.
Do not infer placement from historical embedded study properties.

Material IDs / `material.userData.city_role`:
`Limestone→body`, `Recess→recess`, `Slate→roof`, `Cornice→stone_trim`, `Gilt→gold`,
`Window→emissive_window`. `source_material`, `source_object`, `shared_geometry_id`,
existing `library_variant`, district roles and hierarchy survive glTF extras.
Source linear PBR colors remain; all six are opaque/double-sided, flat shaded.
Only Window emits: RGB `(1,.47,.12)`, strength `1.8`, via
`KHR_materials_emissive_strength`. No textures, skins or animation.

**Reuse is not automatic instancing or fewer draw calls.** The export contains
288 unique material primitives / **1,080 placed primitives**, 123,122 decoded
unique primitive vertices. A consumer can group by `(shared_geometry_id, material
role)` and retain each world matrix to instance repeats; that requires consumer
work and culling checks. 288 groups is a structural potential, not measured calls.
No GPU-instancing extension or custom batching is imposed here. The designer owns
the next assembled Three.js **0.186.1** check and shared Audience/Twilight MeshToon
mapping. Preserve role/emission intent; Blender PBR/AgX is not MeshToon fidelity.

## Reproduction and validation

Installed Blender **5.2.1 LTS**, glTF exporter **5.2.40**. No installations.
Inputs remain explicit sibling dependencies (or pass `--source` / `--study`).
Scripts reject existing outputs and changed inputs; writes are package-root or
`/tmp/opencode` only. Raw preview/baseline exports belong in scratch.

```bash
P="$PWD/assets/production/brightvale-distant-city"
W=$(mktemp -d /tmp/opencode/city-reproduce-XXXXXX)
timeout 240 blender -b -t 8 --python-exit-code 1 --python "$P/produce.py" -- \
  --output "$W/city.glb" --blend "$W/city.blend" --report "$W/build.json"
timeout 600 blender -b -t 8 --python-exit-code 1 --python "$P/validate.py" -- \
  --blend "$W/city.blend" --glb "$W/city.glb" --compare "$P/city.glb" \
  --baseline-output "$W/source.glb" --negative-test --report "$W/validation.json"
timeout 600 blender -b -t 8 --python-exit-code 1 --python "$P/preview.py" -- \
  --derived "$W/city.blend" --output-dir "$W" --comparison "$W/comparison.webp"
```

Preview labels/matte use installed ImageMagick, Adwaita Mono and cwebp; no retouching.
Reopened derivative, exact retained surfaces, hierarchy/reuse, materials, bounds,
oriented GLB triangles and unit normals pass. Native: 28,900 intentional boundary
edges, zero invalid nonmanifold edges/degenerate faces. Max export position error
7.63e−6, normal-component error 6.49e−5; Blender reimport normal error .000340.
No source or exported degenerate triangles were found (area threshold 1e−10);
no important surfaces were dropped to hide a source defect. Independent derivation
from a relocated script directory containing spaces produces byte-identical GLB;
**19 deliberate defects/guard violations** are rejected. Final builds/checks/renders
exit 0; source hashes remain unchanged. No unrelated source-generation matrix was rerun. This is
explicit local validation, not an official Khronos-validator or device budget.
