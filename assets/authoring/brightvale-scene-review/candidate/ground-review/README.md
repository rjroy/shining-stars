# Two-level ground review candidate

`shining-stars-4f4.26`, 2026-10-11. User explicitly authorized this change from checkpoint **e46e5ee**, preserving [framing-review](../framing-review/README.md). Current direction is recorded in [composition-brief.md](../../composition-brief.md). **Parent review and user scene acceptance pending.** No runtime/export, commits, source edits, additional wall, thickness or support geometry.

## Editable source and actual evidence

- [scene-review.blend](scene-review.blend)
- Matched gameplay views: [Neutral](preview-neutral.webp), [Audience](preview-audience.webp), [Twilight](preview-twilight.webp)
- [Two-level side diagnostic](diagnostic-levels.webp), **not a replacement gameplay camera**
- [Validation](validation.json), [preservation/regeneration checks](preservation.json)
- Reproduction: [build.py](build.py), [validate.py](validate.py), [preview.py](preview.py)

All four 1600×900 lossless WebPs are actual Blender renders, decoded/opened and visually inspected. Gameplay views have identical geometry/materials/camera; only the existing parent world/light mode values vary. Blender **5.2.1 LTS**, Cycles **24 samples**, denoising, AgX Medium High Contrast, exposure **0**, no bloom/fog/compositor or presentation redesign. Source hashes were checked after rendering. The first generated scene was retained; no corrective layout iteration was needed.

Scene SHA256: `8cca46b2edfd1794045d35112dc1f3c312e090ef91d0fc4f12f2ff85c96ab39f`.

Input framing checkpoint SHA256: `59af1409cedd26a792007df8c857feb08aed3c3f4fc3f6c0838ed10699b92849`.

## Measured ground relationship

Values are authoring units, not approved meters or runtime scale. The script measures actual evaluated vertices using double-precision accumulation of the saved mesh/matrix fields, not nominal source dimensions or an arbitrary offset.

| Measurement | Value |
|---|---:|
| Original city foundation minimum Z | **−9.5499999225** |
| Existing lower world-ground Z | **−.6499999762** |
| Derived common Z translation | **+8.8999999464** (approximately +8.9) |
| Previous crowd/frame local-ground Z | **−.6499999762** |
| New local-ground Z, after Blender storage | **8.25** |
| City foundation minimum after translation | **−.6500000656** |
| Foundation contact error | **−.0000000894** (float storage precision) |

The lowest city object is **`city::Infrastructure.MasonryAndStreets`**, the approved common foundation/retaining fabric, not an invented building datum. Its base now meets the fixed lower ground. Actual city bounds change from approximately `(-46.55,50.8,-9.55)..(46.55,89.65,36.3)` to `(-46.55,50.8,-.65)..(46.55,89.65,45.2)`.

Every asset and the camera receive the **same +Z translation** by moving hierarchy roots once. No rotations, scales, child local transforms, pose/action channels, base meshes, modifiers, material assignments or relative arrangement change. The 42-unit/14° playfield, fitted caps, 26-section/27-complete-post semicircle, city and ten spectators retain their prior relationships. Camera moves from `(0,-15,5)` to approximately **`(0,-15,13.9)`**, with exactly the same orientation, 28 mm lens and 36 mm sensor. This is not a new camera composition.

All four light objects, including the sun object, receive that same translation. Their orientations, energies, colors, sizes and camera/asset-relative positions remain unchanged. The directional sun's translation has no directional-light effect. World/background nodes remain unchanged. The exterior `Review.Ground` mesh, placement and material remain fixed; lighting distances to that lower plane necessarily change because the lights rise with the assembly.

### Circular local plane

`Review.LocalGround.Circle`: center **(0,20,8.25)**, radius **26.9963657525**, matching the existing semicircle's centerline radius and XY center. One **zero-thickness** mesh, **521 vertices / 520 upward triangles**, positive unit scale/no modifiers. It reuses the exact existing `Review.Ground.Material` datablock.

The rear half of the disk ends **inside the existing frame foot band**, not outside the enclosure; its edge is hidden beneath the existing feet rather than requiring a new perimeter. Centerline radius is appropriate because rigid chord sections and post feet span that circular edge. The **foreground half-circle is exposed/open**, as the approved frame has no front wall. No additional wall, retaining skin, extrusion or foundation was generated.

The disk covers the full playing and crowd footprints: minimum playfield radial margin **3.051** units, crowd margin **5.776** units. It ends at Y≈46.996; nearest city geometry begins at Y≈50.8, leaving **3.804** units of plan clearance. City and disk do not intersect.

## Verification

- Saved candidate reopens successfully. **650 existing objects** compared against a fresh checkpoint reopen: exact data/material/modifier/pose/action/settings identity, preserved hierarchy and all rotation/scale values, expected common world translation and unchanged child local matrices. Maximum world-matrix error against the common translation is **.00000191** from float storage; no independent asset/camera move.
- World ground stays fixed. Frame feet meet the new plane exactly; crowd foot error is approximately **−.000000002**. The height difference between the two floors is **8.9** units. All previous heights relative to the local floor are preserved, including the already tilted playfield.
- Circular topology, radius, elevation, material reuse, absent thickness/modifiers and footprint coverage pass. **261 rear-perimeter samples** lie within actual evaluated existing masonry/post feet just above contact. The local and world planes are separated, not coplanar. Only intentional downward-facing foot/plane contact is coincident; no exposed duplicate floor or visible z-fighting was found in the inspected renders.
- **820 highway visibility rays** remain unobstructed by either floor, city, crowd or frame.
- Four meaningful deliberate defects rejected: city lowered back into the exterior ground, wrong disk elevation, oversized disk, and camera not translated with the assembly. Restoration reproduces identical existing-state and evaluated-geometry fingerprints.
- Independent regeneration and a relocated minimal source/script layout both reopen and match every semantic validation field, excluding `.blend` container hashes and the additional negative-test report. Scripts depend on relative packaged sources/checkpoint, not task scratch paths.
- All **116 approved source-package files** and every earlier scene/candidate artifact remain byte-identical. Of **151 previous authoring files**, only the explicitly updated composition brief changes. `initial` and `framing-review` blends, scripts, reports and previews are preserved. No source `.blend` was resaved. Preservation counts/hashes are in the linked report.
- Build, validation, regeneration, relocation and rendering exit **0**. Existing/missing/unauthorized output guards, script syntax, links, image dimensions and post-render integrity checked. Temporary verification copies were created only inside this scene-review package and removed after results were retained; no trial directories are maintained.

Matched-mode placement/camera signature: `270b2a605bff07b40ee5f86c083c4e95640125ec9cdb6b33c61efc65c430e872`.

## Visual critique and limitations

The gameplay silhouette, crowd placement, frame cadence and skyline projection stay fixed. More of the city's lower arches is visible at the outside edges instead of being cut by the old world-ground level. The central city base remains hidden by the raised disk/playfield: that is **occlusion**, not burial. No full-foundation visibility claim is made.

The side diagnostic visibly establishes the city resting on the lower ground and the play/crowd/frame plane at the upper level. It also honestly reveals the plane-only construction: **the local disk looks suspended, with no thickness or support below it**, and the tilted road still rises above that disk. These are not concealed with lighting or repaired with unauthorized structure. The existing perimeter is only the approved low frame. Physical support/collision and a constructed terrain transition remain unknown; any such geometry needs another decision.

Diagnostic camera is temporary and read-only: orthographic **(110,34,20)** toward **(0,34,16)**, scale **120**, neutral mode. It shows the two floors and actual foundation, not gameplay truth. No runtime camera equivalence, responsive fit, optimization, final materials or scene acceptance is claimed.

## Reproduce within authorized new paths

Keep the six sibling source `.blend` files, unchanged parent assembly/validation/preview scripts, candidate helper scripts, and the framing-review checkpoint in their relative layout. No software/dependencies were installed.

```bash
PACKAGE="$PWD/assets/authoring/brightvale-scene-review/candidate/ground-review"
WORK=$(mktemp -d "$PACKAGE/reproduce-XXXXXX")
timeout 180 blender --background --threads 8 --python-exit-code 1 \
  --python "$PACKAGE/build.py" -- --output "$WORK/scene-review.blend"
timeout 240 blender --background "$WORK/scene-review.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/validate.py" -- \
  --report "$WORK/validation.json" --negative-test
timeout 240 blender --background "$WORK/scene-review.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/preview.py" -- --output-dir "$WORK"
for image in neutral audience twilight diagnostic-levels; do
  cwebp -quiet -lossless -z 6 "$WORK/$image.png" -o "$WORK/$image.webp"
done
```

Scripts refuse existing outputs and any output outside the scene-review package. Do not automatically promote this candidate or replace earlier reviewed files. Parent independently reviews the actual images; user scene acceptance remains separate.
