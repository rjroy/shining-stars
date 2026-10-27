# Brightvale outer framing — reusable production modules

The structure JSON referenced below was retired; the described assembly is
historical. Current runtime layout is maintained in
`src/rendering/brightvale/layout.data.ts`.

Authorized structural lane of `shining-stars-4f4.31`; **production candidate,
combined browser review pending**. The original approved reusable pieces stay
editable and immutable in [authoring](../../authoring/brightvale-outer-framing/README.md).
Source `framing.blend` SHA256
`cd17e3162c434ce4054f6c32d86d4b6a885e9dbad44c1841b563513fffd75542`.
No generator runs, reduced rebuild, source save, duplicate `.blend`, texture bake,
compression, new model or old full-studio arrangement is included.

## Reusable files and pivots

| File | Bytes | Nodes | Triangles | Material primitives | glTF dimensions X/Y/Z |
|---|---:|---:|---:|---:|---|
| [long.glb](long.glb) | 144,180 | 1 | 2,668 | 4 | 2.92 / 1.15 / .68 |
| [short.glb](short.glb) | 80,080 | 1 | 1,448 | 4 | 1.92 / 1.15 / .68 |
| [post.glb](post.glb) | 55,784 | 3 | 968 | 6 | .94 / 1.35 / .84 |

These are exact evaluated transfers, not budgets or measured browser draws.
All are centered on their **floor origin `(0,0,0)`**. The original left module
parent's studio placement/rotation is removed in memory; child local transforms,
bevels, shapes and material assignments stay unchanged. GLBs are Y-up already:
Blender `(x,y,z)` → `(x,z,-y)`, X along section length, front/lens facing **+Z**.
All scales are positive 1. Units are provisional, **not approved meters**.

Each wall is one shaped, closed masonry mass with crown, foot, slab reveals and
fissures; each **complete post** has stone pier, warm metal bezel and inset amber
lens as three mesh nodes in one GLB. Clone/instance the **whole post scene**,
not just its stone node. All six stone/capstone/mortar/metal/lens roles retain
their named partitions and source linear base/PBR/emission values. Only the
post needs `KHR_materials_emissive_strength`. No studio/reference objects,
extras, animations, linked sources, textures or decoders.

## Current exact assembly

[structure-layout](../brightvale-structure-layout.json) supplies **26 long-section
and 27 complete-post matrices**, exactly extracted from the current study.
Apply each matrix to the whole respective GLB scene; preserve internal origins.
Do **not** render the short section in the current semicircle—it is optional
reusable stock. The section crowns are 2.92 long, body length 2.80; posts have
.70 body width. Chord pitch 3.26 gives nominal .12 body overlap per joint.
Semicircle radius 26.99636575, Blender center `(0,20,8.25)`, open toward −Y;
glTF center `(0,8.25,−20)`, open toward +Z. Lenses face inward. No negative-scale
mirroring or wall bending. The approved pieces are not redesigned into a new
continuous mesh; repeated sections/posts make the accepted continuous read.

[technical-validation.json](technical-validation.json) and
[shared verification](../brightvale-platform/verification.json) record scope,
dimensions, exact oriented triangle/material/normal transfer, **5,200 actual
exported solid-joint samples**, complete posts, exact current-study assembly,
byte-identical independent relocated exports and negative tests. No new
degenerate triangles: all three modules have zero. Maximum direct normal error
`.00006474`; Blender importer normal reconstruction has max error `.00513423`
(long), `.00181491` (short), `.00051390` (post), not an artifact normal defect.
The study's framing `.001` material-collision suffix is normalized only during
cross-study role comparison; original production role names are retained.

## Reproduce and validate

Blender **5.2.1 LTS**, exporter **5.2.40**. Keep these packages with sibling
[shared structural.py](../brightvale-platform/structural.py) and byte-identical
authoring sources; paths are relative to the packages, not the shell directory.
Outputs require new package-root files or `/tmp/opencode` scratch; source and
nested production directories remain read-only even when relocated.

```bash
P="$PWD/assets/production/brightvale-outer-framing"
W=$(mktemp -d /tmp/opencode/framing-production-XXXXXX)
for KIND in long short post; do
  timeout 240 blender --background --threads 8 --python-exit-code 1 \
    --python "$P/export.py" -- --kind "$KIND" \
    --output "$W/$KIND.glb" --report "$W/$KIND-export.json"
  timeout 240 blender --background --threads 8 --python-exit-code 1 \
    --python "$P/validate.py" -- --kind "$KIND" --input "$P/$KIND.glb" \
    --compare "$W/$KIND.glb" --report "$W/$KIND-validation.json" --negative-test
done
timeout 240 blender --background --threads 8 --python-exit-code 1 \
  --python "$P/validate.py" -- --kind all --report "$W/all-modules.json" --negative-test
```

Current actual neutral-module and Audience/Twilight scene images were opened and
inspected; exact geometry transfer requires no new simplification comparison.
Preserved caps/feet/recessed lenses read coherently; no placement redesign was
made. Source AgX lighting/emission is not browser fidelity. No official Khronos
validator, exhaustive self-intersection, physical support/collision, target-device
performance or responsive crop claim. Parent/designer owns browser instancing,
material/mode presentation and combined end review; no game integration here.
