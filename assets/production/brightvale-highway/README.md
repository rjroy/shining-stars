# Brightvale highway — 42-unit production transfer

Authorized structural lane of `shining-stars-4f4.31`; **production candidate,
combined browser review pending**. This exports the detailed **42-unit road in
the current [scene-review.blend](../../authoring/brightvale-scene-review/scene-review.blend)**,
not the original 18-unit file. Study SHA256
`fb630ac23fc576c42ebe4961b917b207fefb4894f9bbfc0b812bb6bf7329046b`.
The unchanged [highway authority](../../authoring/brightvale-highway/README.md)
records piece/junction approval; the study records the extended composition.
No generator is executed and no authoring file is saved or edited.

## Asset and assembly contract

- [highway.glb](highway.glb): **417,772 bytes; 14 nodes; 11,336 triangles;
  18 primitives; 8 material roles**. Exact evaluated geometry, no simplification,
  textures, compression, animation, studio or reference inclusion.
- Local Blender bounds `(-6,2.535,-.30)…(6,44.70,.505)`; glTF bounds
  `(-6,-.30,-44.70)…(6,.505,-2.535)`. Width 12, chassis length **42**, full
  length including terminal noses **42.165**. Units are provisional, not meters.
- The saved common playfield parent is removed **in memory**, retaining every
  original child local transform. All road nodes retain their junction origin:
  Blender `(0,2.7,0)` → glTF `(0,0,-2.7)`. Do not move the road another 2.7,
  bake out the tilt, recenter it or apply a second axis conversion.
- Apply `playfield.gltf.matrix_column_major` from
  [brightvale-structure-layout.json](../brightvale-structure-layout.json) to the
  whole loaded platform, road and existing endcap scenes, or one common parent.
  It is Three `Matrix4.fromArray` compatible; translation
  `(0,9.5580739975,.2404211015)`, quaternion XYZW
  `(.1218693703,0,0,.9925461411)`, scale 1: **14°**, not `.14` radians.
- The `.001` suffix on highway material names is inherited from study append
  collisions, not a new material direction. Named chassis, quiet enamel, broad
  seam, warm titanium and cyan/magenta/amber/green inlay roles and their linear
  base/PBR/emission values are retained in
  [technical-validation.json](technical-validation.json).

## Pure scene data for the browser lane

[layout.py](layout.py) extracts/validates the **current saved study**, never a
deleted candidate or historical scene property. It records the source hash,
common playfield matrix, city source-layout root, exact 26 long-section and 27
complete-post placement matrices,
camera basis/FOV/clips, four lights/preset values, and **exact** lower-ground and
520-triangle circular-plaza meshes/material/placement. These planes may be
created by the browser from data; no unrelated ground asset was generated.
Crowd placement is not part of this shared layout contract. The waist-up crowd
runtime owns its own population and attachment mappings.

Camera: glTF position `(0,13.89999962,15)`, vertical FOV **39.76070473°** at
1600×900, 28 mm/36 mm sensor. Lower ground Y `−.65`; plaza center
`(0,8.25,−20)`, radius `26.99636575`, so the two ground levels differ by 8.9.
Blender AREA wattage, world strength and AgX are not equivalent Three.js settings;
data is not a shader/lighting implementation or a pixel-fidelity promise.

## Reproduction and checks

Blender **5.2.1 LTS**, exporter **5.2.40**. Keep the sibling
[shared implementation](../brightvale-platform/structural.py) and source layout.
No production `.blend` is needed: the unchanged saved derivative study is the
editable highway source, and the exporter performs only copy-space operations.

```bash
P="$PWD/assets/production/brightvale-highway"
W=$(mktemp -d /tmp/opencode/highway-production-XXXXXX)
timeout 240 blender --background --threads 8 --python-exit-code 1 \
  --python "$P/export.py" -- --output "$W/highway.glb" --report "$W/export.json"
timeout 240 blender --background --threads 8 --python-exit-code 1 \
  --python "$P/validate.py" -- --input "$P/highway.glb" \
  --compare "$W/highway.glb" --report "$W/validation.json" --negative-test
timeout 180 blender --background --threads 8 --python-exit-code 1 \
  --python "$P/layout.py" -- --input "$P/../brightvale-structure-layout.json" \
  --report "$W/layout.json" --negative-test
timeout 300 blender --background --threads 8 --python-exit-code 1 \
  --python "$P/validate-assembly.py" -- --report "$W/assembly.json" --negative-test
```

[Shared verification](../brightvale-platform/verification.json) proves independent
relocated byte-identical export/layout, reimport and source integrity. Direct
position error 0; direct normal error ≤ `.00006426`; no degenerate road triangles.
Blender importer normals deviate by up to `.00418097`; direct GLB normals remain
strictly checked. No official Khronos validator was installed/run.

Exported assembly reconstructs **176 current study geometry objects / 133,854
triangles**, max world position error `.0000038147`. Actual GLB junction rays:
chassis gap **0**, four lane centers `[-4.5,-1.5,1.5,4.5]`, widths 2.75,
travel top .44, nose top .502/under .492, nominal retained-frame clearance .002,
84 sampled minimum clearance **.00245452**, nose-to-cap lateral clearance .125.
The existing frame ridge and .012 terminal top step are deliberately preserved,
not flattened. Shifted lane/section, missing bezel, actual wall-solid gap,
material/origin/normal/scope/source/output defects are rejected by negative tests.

Actual current Audience/Twilight evidence was opened and inspected. No reduction
means no fabricated before/after render. Browser validation, material appearance,
performance and final acceptance remain separate parent/designer work.
