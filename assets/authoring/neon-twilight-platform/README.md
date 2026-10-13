# Neon Twilight platform

Editable authoring asset: **model v8.3**, with approved **concept v4**. Brief v1,
concept v4 and model v8.3 were explicitly approved on **2026-10-10**. The user
selected source-binary inclusion: `platform.blend` and `concept.webp` are intended
for Git alongside these scripts. Generated previews, logs and rebuilds are not.
No gameplay integration or runtime export is authorized or present.

The standalone brief is a broad, shallow four-lane midnight-blue platform with
beveled gold framing, a solid central star/shield crest, colored recessed hit bars
and small star inlays; no highway, notes, scenery, crowd, HUD or judgment effects.

## Source and provenance

- `platform.blend`: exact approved v8.3 native file, **183,112 bytes**.
  SHA-256: `ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af`.
- `concept.webp`: current user-converted lossy WebP derivative of the approved v4 image, 1536×1024; SHA-256 `00f78d18cbd223d79b91c9c5aaba5fbe56f231d0bff2bb89f3bdc87078c48b75`. Accepted by the user for this purpose; this hash identifies the derivative, not byte-identical PNG bytes.
- Original approved v4 PNG: 1536×1024, **1,763,477 bytes**; historical SHA-256 `dd83404120add014aad9560a999149bcdf883c3574d250a1ec95aa221d16fa06` (not the current WebP hash).
- Concept generated through the user-authorized built-in image route using v3 as
  reference; native generation ID
  `01a126e0-6e0f-7ed3-b3f8-6658c98e41e1/exec-c745b67f-c9c2-4c34-84fa-1bf5e3dfc83e`.
  Model built deterministically in Blender by the authorized asset workflow.
  No third-party model/texture inputs or external file dependencies. No separate
  third-party or redistribution license is asserted.

## Rebuild and inspect

Requires **Blender 5.2.1 LTS** (2026-09-01 build) and its bundled Python modules;
no additional dependencies. Scripts resolve their paths relative to themselves,
so a fresh clone does not require the original authoring directories.

From the repository root:

```bash
ASSET="$PWD/assets/authoring/neon-twilight-platform"
timeout 180s blender --background --python-exit-code 1 --python "$ASSET/build.py"
timeout 180s blender --background "$ASSET/generated/build/platform.blend" \
  --python-exit-code 1 --python "$ASSET/validate.py"
# Optional disposable geometry evidence; does not save or alter the source:
timeout 600s blender --background "$ASSET/platform.blend" \
  --python-exit-code 1 --python "$ASSET/preview.py"
```

`build.py` refuses an existing output directory. For a later run, choose an unused
one with `-- --output-dir "$ASSET/generated/build-2"`. `preview.py` accepts the same
option. `validate.py` accepts `-- --report "$ASSET/generated/structure-2.json"` and
refuses an existing report. All outputs must remain within ignored `generated/`.
The validator compares all saved objects and presentation settings against the
approved source, checks mesh closure/volume/bounds and external dependencies.
Use it on either the approved source or a rebuilt blend. Blender save bytes may
differ on regeneration; structural equivalence, not binary identity, is tested.

The approved blend retains a historical render-output pathname to preserve its
bytes. That is not an input dependency. Use `preview.py`, which replaces it in
memory before rendering, instead of rendering directly to the scene's default
output path. Previews are geometry-review evidence, not the final product.

## Coordinates and runtime caveats

Normalized, provisional Blender units: asset bounds **12 × 5.5 × 1.145** excluding
studio ground. X spans lanes left-to-right; front is negative Y; Z is up, with
origin at chassis center. Physical scale and performance budgets are unknown.
The scene includes 45 meshes, 9 decorative curves, a camera and four studio
lights; floor/camera/lights/world are review scaffolding, not gameplay content.
Gold/chassis/shield/panel/inlay/emitter materials are named and separated, but
procedural nodes, emission and compositor bloom do not prove runtime parity.
Parts intentionally overlap; validation is not an exhaustive intersection proof.
No animation, collision, export-axis conversion or runtime integration is supplied.
