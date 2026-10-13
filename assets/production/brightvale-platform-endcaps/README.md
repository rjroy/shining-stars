# Brightvale endcaps — production pilot

**Completed transfer pilot, not a production-approved game integration.**
`shining-stars-4f4.29` covers this uncompressed baseline and isolated browser
validation. The user subsequently authorized the harness-only cel-shading and
mode-lighting experiment, called it a good start, and asked to continue production
work. The current look is a working baseline, not final appearance approval.
No game integration or source shape reduction was performed.

Current [endcaps.glb](endcaps.glb), reproducible [export.py](export.py),
read-only [validate.py](validate.py), [technical report](technical-validation.json).
Browser evidence/harness is separately owned under `validation/`.

## Immutable source and inventory

Authority: [approved source/approval history](../../authoring/brightvale-platform-endcaps/README.md),
[endcaps.blend](../../authoring/brightvale-platform-endcaps/endcaps.blend).
SHA256 `c49ae80c34350ddb7281c3192c4ed90921852f0386fa047a9196087cc13b4207`.
User approved the modeled pair and its measured platform fit on 2026-10-10;
frozen `CANDIDATE/UNAPPROVED` labels in that exact binary are historical, not its
current approval status. Source concept, placement reference, editable model
and generator stay in authoring; none was modified or saved by this pilot.

- Two authoritative mesh objects: `Endcap | left | sculpted body and gold edging`
  and its `right` counterpart. Each: 80 editable vertices, 644 evaluated vertices,
  1,284 triangles. Bevel .023/3 segments and weighted normals are evaluated for
  export; procedural modifiers remain only in the editable source.
- Unit object scale, no rotation/mirroring. Blender seated origins
  `(±6.49,0,−.65)` are retained as glTF `(±6.49,−.65,0)`.
- No UVs, images, textures, vertex colors, animation, skin/joints or collision.
  All 53 reference-platform geometry objects, studio ground/camera/lights and
  historical custom status properties are excluded from the derivative.
- Source comparison camera: 50 mm / 36 mm sensor, `(0,−16,12.5)` in Blender;
  its outer-cap crop is known. Browser camera/evidence is separately documented
  by the validation lane. Target devices, performance budgets and final screen
  sizes are not established by this pilot.

## Portable material and coordinate contract

One shared asset for Audience and Twilight. Two original material roles, simple
constant Principled BSDF → output graphs; no graph replacement, bake or toon
shader. Linear glTF factor values:

| Material name | Base RGB | Metallic | Roughness |
|---|---|---:|---:|
| `Endcap body \| midnight-blue enamel` | .015, .028, .065 | .45 | .32 |
| `Endcap edging \| warm brushed gold` | .72, .36, .075 | .82 | .25 |

Both are opaque, double-sided (source culling disabled), non-emissive core
metallic/roughness PBR. No texture color-space/channel packing is involved.
GLTFLoader should import baseline materials; no mode-specific exports or decoder
configuration is needed. Source lighting, world, AgX tone mapping, compositor,
reflection environment and Blender-specific Principled BRDF behavior are not
portable appearance. **AgX is not equivalent to the project's sRGB/ACES Filmic
pipeline.** Runtime cel-shading/material redesign remains separate work.

Blender Z-up → glTF Y-up mapping: **(x,y,z) → (x,z,−y)**. Blender foreground −Y
becomes glTF foreground +Z; lateral X is unchanged. Authoring units are **not
declared meters**. glTF pair bounds: min `(-6.98,−.65,−2.7)`, max
`(6.98,1.15,2.8)`, dimensions `13.96 × 1.8 × 5.5`; empty center is the platform
placement gap, not a platform mesh. Consumers must not center each cap or apply
an additional axis conversion when loading glTF.

## Reproduce and check

Verified Blender **5.2.1 LTS**, installed glTF exporter **5.2.40**. RNA options
and installed implementation were inspected, including modifier evaluation,
normal export, selection filtering, Y-up and disabled compression. Scripts pin
these versions, check approved source bytes and refuse existing outputs.
Only direct production-root files or `/tmp/opencode` scratch are writable;
`validation/` is not an export output location. No software was installed.

```bash
P="$PWD/assets/production/brightvale-platform-endcaps"
W=$(mktemp -d /tmp/opencode/endcaps-pilot-XXXXXX)
timeout 180 blender --background --threads 8 --python-exit-code 1 \
  --python "$P/export.py" -- --output "$W/endcaps.glb"
timeout 180 blender --background --threads 8 --python-exit-code 1 \
  --python "$P/validate.py" -- --input "$P/endcaps.glb" \
  --report "$W/technical-validation.json" --compare "$W/endcaps.glb" --negative-test
```

Exports are validated in owned scratch before exclusive creation of a destination.
Success scratch is removed; failures retain an identified diagnostic directory.
No `.blend` is saved. Independent export from a relocated byte-identical source
and package must match current GLB bytes.

## Technical findings and limits

- **138,388 transfer bytes**, 2 nodes/meshes, 2 shared materials, 4 primitives,
  2,568 triangles, 4,982 exported primitive vertices (normal/material splitting).
  No extensions, textures or compression. These are decoded geometry counts,
  **not measured GPU memory or browser draw calls**.
- Every exported triangle's positions/material region/winding matches evaluated
  source. Max position error 0; max direct normal component error **.00006286**.
  Normals are finite/unit; bounds, origins and orientation pass.
- Blender reimport reproduces all triangle positions/regions exactly, but custom
  corner normals are not an exact roundtrip: 3 triangles exceed .001 component
  error, max **.049504 left / .013778 right**. One is degenerate, two are not.
  The untouched GLB's direct normal check is separate from this importer result.
- **14 inherited near-zero-area triangles** (6 left, 8 right) occur in source
  evaluated triangulation. Earlier source validation checked polygon area, not
  every loop triangle. Baseline preserves them; no cleanup/reduction was
  authorized. This is a disclosed limitation, not a claim of perfect topology.
- Scope/material/origin/compression/normal defects and output/source guards are
  tested. Structural checks are explicit local checks, not an official Khronos
  validator certification. The exporter logs unavailable MeshOptimizer at
  initialization even with compression disabled; the successful GLB contains no
  compression extension and requires no MeshOptimizer.

Parent reviews this derivative and actual browser evidence before promotion.
This small pair does not establish city/crowd cost, final appearance or runtime
acceptance. Research context: `.lore/work/research/blender-threejs-production-sources.md`.
