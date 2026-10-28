# Brightvale platform — production transfer

The structure JSON referenced below was retired; its layout and verification
references are historical. Current runtime layout is maintained in
`src/rendering/brightvale/layout.data.ts`.

Current derivative: **approved shining-stars-ixp slot-cue model revision**.
The user approved the exact authoring `slot-cues-approved.png` model and
authorized production export and in-game verification. **Technical transfer is
verified; designer desktop browser review completed; user runtime appearance
acceptance remains pending.**
No gameplay, camera, scene placement or other asset changes were made.

## Source and narrow revision

Authority: [`platform-slot-cues.blend`](../../authoring/neon-twilight-platform/platform-slot-cues.blend),
185,772 bytes, SHA-256
`72ba506b25c7ddfc61541dc9cc54bd65880fa112ad1e51dd839a0fa794befe26`.
This is the exact approved candidate, now maintained outside ignored generated
outputs. Authoring [README](../../authoring/neon-twilight-platform/README.md)
documents reproducible patch generation and durable before/approved evidence.
The immutable v8.3 `platform.blend` and `build.py` remain packaged as lineage;
the older original GLB/reports are available in Git history.

Only `Timing | thin transverse light rule` was removed (Y=1.93, radius .018).
Each complete slot ring receives one exclusive `Slot border | ... 75 lane 25 gold`
material: linear RGB .75 authored hit color + .25 brushed-gold base, with original
gold metallic/roughness and no added emission. **No rear ring segments were cut.**
Actual inset targets/bezels, all stars, front apron/crest, outer frame and all
retained geometry/normals/transforms remain exact. No simplification, bake,
compression, textures, animation, rigs or duplicate production blend.

## Consumer contract

- `platform.glb`: **970,300 bytes; 52 nodes; 24,426 triangles; 65 material
  primitives; 31 named material roles.** Measurements are not draw calls or GPU
  memory. Previous derivative: 970,376 bytes, 53 nodes, 24,446 triangles, 66
  primitives, 27 roles. The 20 removed triangles belong only to the thin rule.
- SHA-256: `1ad2308e0a73dd245feb18e6e5567e0664ac9d45ff09aeefc1c0a2647709e9f1`.
- Unchanged glTF bounds: `(-6,-.45,-2.7)…(6,.695,2.8)`, dimensions
  **12 × 1.145 × 5.5**. Units remain provisional, not approved meters.
- Blender `(x,y,z)` → glTF `(x,z,-y)`: X lateral, Y up, front +Z. Preserve
  internal node origins; never recenter or axis-convert the loaded GLB again.
- Apply the unchanged `playfield.gltf` matrix from
  [`brightvale-structure-layout.json`](../brightvale-structure-layout.json)
  to the **whole loaded scene**, once. Existing 14° tilt and placement remain.
- Named nodes, mesh/material regions and portable base/PBR/emission values are
  preserved. No studio floor/lights/camera/compositor is exported. Four mineral
  graphs use authored constant base/roughness, not a texture bake. Pure emitters
  map to black-base Principled emission; `KHR_materials_emissive_strength`
  preserves intensity. Blender/AgX/reflections/bloom do not promise browser parity.

## Reproduce and verify

Blender **5.2.1 LTS**, glTF exporter **5.2.40**; installed RNA checked, no installs.
Keep sibling authoring source/lineage and this package together. `structural.py`
is shared with highway/framing; only its platform source guard and platform-only
checks changed. Other families retain their original pins/settings.

```bash
P="$PWD/assets/production/brightvale-platform"
W=$(mktemp -d /tmp/opencode/platform-production-XXXXXX)
timeout 240 blender --background --threads 8 --python-exit-code 1 \
  --python "$P/export.py" -- --output "$W/platform.glb" --report "$W/export.json"
timeout 240 blender --background --threads 8 --python-exit-code 1 \
  --python "$P/validate.py" -- --input "$P/platform.glb" \
  --compare "$W/platform.glb" --report "$W/validation.json" --negative-test
timeout 1200 python "$P/verify-slot-cues.py" --report "$W/relocated.json"
# Existing non-browser consumer loader/material tests (repository root):
npm test -- src/rendering/brightvale/assets-runtime.test.ts src/rendering/brightvale/appearance.test.ts
```

All output paths must be **new** direct package-root files or authorized scratch.
Exports never overwrite production/source files. After authorized replacement,
copy only a verified derivative and its matching reports; do not bypass source
hash/object guards. `--source` accepts only byte-identical approved source, not
legacy v8.3 or a different candidate. `verify-slot-cues.py --input NEW.glb` can
validate a replacement before promotion; default input is maintained GLB.

## Evidence and limits

`technical-validation.json` records exact transfer/material settings and negative
tests. `verification.json` records independent relocated **byte-identical GLB
reproduction**, independent authoring regeneration and scope checks, reimport,
unchanged inputs, 54 protected objects exact, four exact ring geometries and all
28 original authoring material graphs unchanged. Source and output bounds match.
Direct maximum position error is **0**; maximum normal component error is
**.00006557**. Reimport normal reconstruction error is **.00236124**, separate
from the strict direct GLB check. **160 inherited near-zero-area triangles** are
unchanged evaluated bevel triangulation, not new defects.

Negative tests reject restored timing cue, lost real bezel, altered ring/shared
gold color, role loss, origin/scale/normal changes, unsafe output paths, changed
source and the old source hash. No scene comparison/approval is inferred from
these checks. No Khronos validator, device benchmark or exhaustive intersection
test was run; performance budgets and physical scale remain unknown.

The existing consumer loader/material test files also passed **17/17 tests**,
including loading all seven real production GLBs through installed Three.js
0.186.1 `GLTFLoader`. This is compatibility evidence, not a browser screenshot,
lighting/appearance approval, or device-performance result.

The original `verify.py` and its exact-study comparator describe the historical
five-asset pre-ixp assembly. That saved study still includes the old rule/materials,
so it is **not the current platform verification command**. Its exact comparison
was not loosened or treated as passing for this revision. Current verification
uses the original preserved source to prove the authorized delta, then checks
full transfer/reimport; placement contract remains unchanged. Designer owns the
actual game browser review after this handoff.

Desktop actual-game review is now recorded in
`.lore/local/evidence/platform-slot-cues/actual-game-1600x900.png` with
`runtime-verification.json`. Chromium/SwiftShader requested the maintained GLB
(HTTP 200); fetched bytes match the SHA-256 above. All four inset targets remain
distinct, the separate transverse rule is absent, and the complete slot rings
show lane-tinted rather than shared-gold surfaces. No runtime material fix was
needed. The existing toon shader does not reproduce Blender metallic response;
the tinted rims remain visibly bright under game lighting. This single desktop
capture is not responsive/device-performance validation or user acceptance.
