# Neon Twilight platform

Current editable asset: **`platform-slot-cues.blend`, approved shining-stars-ixp
slot-cue revision**. The user approved the exact `generated/ixp-after/comparison.png`
model revision and authorized production export and in-game verification; the
designer owns the subsequent browser review. Runtime appearance acceptance is
still pending. Original **model v8.3**, brief v1 and **concept v4** were explicitly
approved on **2026-10-10**. The user
selected source-binary inclusion: `platform.blend` and `concept.webp` are intended
for Git alongside these scripts. Generated previews, logs and rebuilds are not.
The current production derivative is maintained separately in
`assets/production/brightvale-platform/`; no gameplay/camera code was changed.

The standalone brief is a broad, shallow four-lane midnight-blue platform with
beveled gold framing, a solid central star/shield crest, colored recessed hit bars
and small star inlays; no highway, notes, scenery, crowd, HUD or judgment effects.

## Source and provenance

- `platform-slot-cues.blend`: current approved editable source, **185,772 bytes**;
  SHA-256 `72ba506b25c7ddfc61541dc9cc54bd65880fa112ad1e51dd839a0fa794befe26`.
  Exact copy of the reviewed candidate, not a resaved or reinterpreted model.
- `platform.blend`: immutable approved v8.3 lineage, **183,112 bytes**.
  SHA-256: `ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af`.
- `concept.webp`: current user-converted lossy WebP derivative of the approved v4 image, 1536×1024; SHA-256 `00f78d18cbd223d79b91c9c5aaba5fbe56f231d0bff2bb89f3bdc87078c48b75`. Accepted by the user for this purpose; this hash identifies the derivative, not byte-identical PNG bytes.
- Original approved v4 PNG: 1536×1024, **1,763,477 bytes**; historical SHA-256 `dd83404120add014aad9560a999149bcdf883c3574d250a1ec95aa221d16fa06` (not the current WebP hash).
- Concept generated through the user-authorized built-in image route using v3 as
  reference; native generation ID
  `01a126e0-6e0f-7ed3-b3f8-6658c98e41e1/exec-c745b67f-c9c2-4c34-84fa-1bf5e3dfc83e`.
  Model built deterministically in Blender by the authorized asset workflow.
  No third-party model/texture inputs or external file dependencies. No separate
  third-party or redistribution license is asserted.

## Legacy v8.3 rebuild and inspect

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

## Approved slot-cue revision — shining-stars-ixp

**Model approved; production exported and technically verified; designer desktop
browser review completed; user runtime appearance acceptance pending.** The legacy `platform.blend` and `build.py`
remain byte-unchanged, providing packaged source/generator lineage. Blender
5.2.1 LTS was used; no external dependencies or manual modeling steps were added.

Independent inspection corrected the preliminary target identification: the
thin straight false cue is **`Timing | thin transverse light rule`**, a separate
radius .018 curve from `(-5.7,1.93,.56)` to `(5.7,1.93,.56)`. This name is present
in the existing production GLB too. It is **not** the rear portion of each
`Lane N | substantial continuous profiled border`. Those rings remain fully
intact. The four real inset targets and bezels at Y=1.45 remain untouched.

- `revise-slot-cues.py`: source-preserving deterministic patch generator. Removes
  only that curve; assigns dedicated materials only to the four slot rings.
  Base color is linear RGB **75% respective authored `Hit | ... pure emitter`
  color + 25% brushed-gold base**. Gold metallic .82 and roughness .23 are retained;
  no emission is added. Shared gold, stars, front aprons, crest and outer frame
  are unchanged.
- Current saved source: `platform-slot-cues.blend`, SHA-256
  `72ba506b25c7ddfc61541dc9cc54bd65880fa112ad1e51dd839a0fa794befe26`.
- Durable actual-model preview source PNGs: `slot-cues-before.png` and
  `slot-cues-approved.png` (exact approved image bytes). Presentation derivatives:
  [before](slot-cues-before.webp) and [approved](slot-cues-approved.webp). PNGs remain unchanged originals. Both are 1200×800,
  Cycles 16 samples, saved
  concept-comparison camera at `(0,-16,12.5)`, 50mm. Original lighting, AgX,
  materials (apart from authorized tints) and compositor retained; source hashes
  checked unchanged. These are not runtime appearance evidence.
- `validate-slot-cues.py`: reopens saved candidate and original, checks exact
  protected object geometry/corner normals/transforms/material slots; exact
  retained ring geometry; all 28 original material graphs unchanged; exactly
  four added dedicated tint materials; camera/lights/world/compositor/render
  settings unchanged. Evaluated meshes remain closed, positive-volume with no
  zero-area polygon faces. Bounds are exactly unchanged:
  `(-6,-2.8,-.45)…(6,2.7,.695)`, dimensions `12 × 5.5 × 1.145`.
  Independent regeneration passed full structural equivalence. Report:
  `slot-cues-validation.json` (includes exact non-color
  gold-property checks on the new tints). Production transfer/reimport and
  independent relocated regeneration are separately recorded in the production
  package. No exhaustive overlap test was performed.

Visual inspection: the straight cross-lane cue is absent; slot rear edges still
close their rims, now in lane-tinted metal. Actual colored targets and gold
bezels, stars, central emblem, front apron and outer silhouette remain intact.
The material separation is clearer without adding bright rim emission. Existing
studio bloom/reflections soften the small target details; consumer appearance
still requires the parent's actual-runtime review.

Reproduce to **new** directories (outputs are ignored rebuilds, not automatic
replacement sources). Production reads the maintained source above, never
`generated/`. The patch generator still reads immutable `platform.blend`:

```bash
ASSET="$PWD/assets/authoring/neon-twilight-platform"
timeout 180 blender --background --threads 8 --python-exit-code 1 \
  --python "$ASSET/revise-slot-cues.py" -- --output-dir "$ASSET/generated/ixp-new"
timeout 180 blender --background "$ASSET/platform-slot-cues.blend" \
  --threads 8 --python-exit-code 1 --python "$ASSET/validate-slot-cues.py" -- \
  --report "$ASSET/generated/ixp-new/validation.json" \
  --compare "$ASSET/generated/ixp-new/platform.blend"
timeout 240 blender --background "$ASSET/generated/ixp-new/platform.blend" \
  --threads 8 --python-exit-code 1 --python "$ASSET/preview-slot-cues.py" -- \
  --output-dir "$ASSET/generated/ixp-new-preview"
```

For maintained-source validation, load `platform-slot-cues.blend` instead of the
rebuilt file; `--compare` is optional and, when supplied, must be a newly rebuilt
blend in `generated/`. The production package's `verify-slot-cues.py` performs
this regeneration/compare automatically in a fresh relocated package.

Production transfer is `assets/production/brightvale-platform/export.py`, using
shared `structural.py`; it pins the current maintained source hash and 52 geometry
objects, checks absence of the false rule, all 12 actual target components, and
exclusive assignment of four dedicated ring materials. Regeneration/validation
commands and measured GLB results are in that package's README. Assembly
transforms and gameplay/cameras remain unchanged. Other authoring study packages
remain pinned to the immutable v8.3 lineage; their historical exact-study checks
do not establish current slot-cue material/geometry acceptance and were not
weakened or regenerated by this task.
