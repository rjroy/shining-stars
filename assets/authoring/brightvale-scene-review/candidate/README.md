# Gameplay-dominant composition candidate — Sol bounded pass

**Framing correction:** the original long-short/no-post direction below was mistaken and is superseded by the user's approved section-post semicircle. The framing-only revision and current evidence are in [framing-review/README.md](framing-review/README.md). The original `initial` scene/previews and this historical pass's measurements remain preserved; all nonframing composition is unchanged in the revision.

`shining-stars-4f4.26`, 2026-10-11. Authorized by the parent's explicit scene-revision instruction and [designer handoff](../composition-brief.md). **Pending independent parent/designer review and user acceptance.** No source redesign, crowd revision, export, runtime integration, or model approval is claimed.

## Selected evidence and editable files

The **first composition is retained unchanged**; no corrective layout iteration was used.

- [Editable scene](initial/scene-review.blend)
- [Neutral hierarchy](initial/preview-neutral.webp)
- [Audience](initial/preview-audience.webp)
- [Twilight](initial/preview-twilight.webp)
- [Generator-built longer highway](initial/highway.blend), including the generator's original reference/studio context; the assembled scene imports only its 14 highway meshes.
- [Saved-scene validation](initial/validation.json)
- [Long-highway topology/junction validation](initial/highway-validation.json)
- [Before/after protected-file hashes](protected-sha256.json)
- Reproduction: [build.py](build.py), [compose.py](compose.py), [validate.py](validate.py); reuse the unchanged parent [preview.py](../preview.py).

All three 1600×900 lossless WebPs are actual Cycles renders, decoded/opened and inspected against both original Golden City / Neon Twilight mockups and the previous neutral assembly. They use one saved camera and identical geometry, materials, crowd poses and placement. Only the parent's existing world/light mode values change. No narrow crops, fog, bloom, compositor, exposure changes, or new lighting treatment were used to conceal layout issues.

Scene SHA256: `a41201169324b57ae9fd511035d320d7f6a5af9c24f0dd71663cf283f9f29250`.

Longer highway SHA256: `752abd57e22b4209f6491b55c7ed433b391b34e42be5aa6aec223de37b5270db`.

## Exact composition changes

Coordinates are provisional authoring units, not meters or a runtime mapping. X is lateral, +Y recedes, Z is up.

| Item | Candidate change |
|---|---|
| Highway | Approved unchanged `brightvale-highway/build.py --length 42`, versus retained source length 18; four parallel lanes, original widths/colors/order and fitted noses preserved. Generated in authorized scratch because the source generator refuses this scene package, then copied byte-for-byte into the candidate. |
| Playfield | Platform + fitted endcaps + longer highway parented under `COMPOSITION.Playfield.ForegroundPivot`; common matrix `T(0,-2.8,-.65) Rx(14 degrees) T(0,2.8,.65)`. Uniform scale **1**, no local asset transforms changed. The foreground edge is the pivot; no separated cap placement or junction stretch. |
| City | Only `CITY.ProvisionalLayout` changed: position **(0,55,-5)**, uniform scale **.35**, original rotation. All descendant meshes/materials/local transforms preserved. Its lower foundation is below the unchanged review ground; the spire is intentionally cropped at the top. No hidden-city mesh deletion or foundation edit. |
| Crowd | All **ten spectators / 173 drawables / ten rigs** retain their original world/local transforms, geometry, scales, action channels and poses. Yaw was **not recomputed** for the new camera. |
| Camera | Perspective **(0,-15,5)** toward **(0,24,.5)**, **28 mm / 36 mm sensor**, .1–5000 clipping, 1600×900. This is a study camera, not either runtime camera. |
| Ground/lights/materials | Existing ground and presentation setup unchanged. Cycles **24 samples**, denoising, AgX Medium High Contrast, exposure **0**, Blender **5.2.1 LTS**. |

The source-local chassis junction remains **Y=2.7**, nominal gap **0**. Existing nose/frame clearance **.002** and terminal top step **.012** remain intact, and the common rigid matrix preserves them after tilt. Actual world road bounds are approximately `(-6,2.099,1.022)..(6,43.202,11.950)`. City bounds are `(-46.55,50.8,-9.55)..(46.55,89.65,36.3)`; the nearest city geometry remains **7.598** Y units behind the road's world bound. No old greater-than-10 spacing requirement is imposed.

### Alternating curved boundaries

**44 wall meshes total: 22 per side, each 11 long + 11 short**, in `long, short, long, short` order. No posts or separated three-component clusters. Meshes are exact linked copies of the source's left long/short masonry prototypes, including material/modifier assignments. Root transforms alone establish the layout.

The shallow symmetric curves start near Y=-4, reach a minimum lateral center X≈±11.8 near Y=10, and finish near Y=43.5. The slope field is `dx/dy = side * .006*(y-10)`; each rigid piece follows its local tangent. Centers are chained using each piece's half-body length minus **.07** at each adjoining end, creating **.14 nominal body overlap** (**.26** at projecting cap/base ends). This avoids the wedge holes that square-ended pieces would leave if merely butted on a curve. The maximum adjacent angle is **.743 degrees**. The outer wall contours remain subtly faceted, not bent or mitered. All transforms are positive unit scale. Full placement coordinates are in the validation report.

This is a gapless **overlapping assembly**, not a Boolean-unioned or flush-mitered wall. Dressed caps show repeated joints; source chamfers and profiles are retained. The existing pieces can meet on this shallow curve without source modification. Sharper curves or perfectly flush curved joints would require another decision; they are not silently synthesized here.

## Verification

- All **128 pre-existing authoring files** checked before/after: **116 source-package files plus 12 scene-review files**, including the maintained scene, scripts, five previews, diagnostics, README and brief. Zero changed, missing, or replaced files. Protected hashes are retained in this candidate only.
- Saved candidate reopened successfully; exact source geometry/material/modifier/rig identities verified against fresh source imports. The only differing highway geometry is compared to the actual generator-built 42-unit candidate, not misrepresented as identical to the 18-unit source.
- Exact source-local playfield transforms and the common world matrix checked for every platform, cap and highway object. Independent highway validation confirms all base/evaluated meshes are closed manifold, consistently wound, nondegenerate and positive-volume, with the unchanged measured junction and shoulders. Longer highway: **11,336 evaluated triangles**.
- **820 lane visibility rays** clear across all four lanes and the longer travel extent. No walls, crowd or city obstruct the sampled playfield. Continuous four-lane beds and source correspondence also pass the unchanged highway validator.
- **4,200 actual evaluated solid-union wall-joint samples** pass across the two boundaries: five longitudinal stations × five transverse stations across .46 of the .54 body depth × four body heights × 42 joints. Horizontal local-space parity rays avoid precision loss and double crossings through the source's small beveled horizontal contour transitions. These are substantive gap checks, not a bounding-box overlap assertion, but not an exhaustive solid-union proof. Minimum aggregate lateral crowd clearance is **1.595 left / 1.688 right**.
- Exact crowd world/local matrices, source data, pose channels and source action keyframes compared against fresh imports from the maintained scene. No crowd edits. Five of ten own-head visibility rays now hit the raised playfield/caps first; that is reported, not disguised as a crowd visibility pass.
- Four intentional defects rejected: displaced wall root, actual mesh joint gap with unchanged roots, shifted lane local transform, and moved crowd. Restored evaluated geometry fingerprint matches the original report. Missing/existing-output handling and script syntax checked; build-over-initial is refused before generation.
- Independent regeneration in scratch, then a second regeneration from a **relocated minimal packaged script/source layout**, both reopen and match every semantic validation field (excluding binary container hashes and the additional negative-test report). No scratch input dependency is required for normal reproduction.
- Build, final validation, highway validation, relocation and all render processes exit **0**. Source/candidate hashes remain unchanged after rendering. Matched-mode camera/placement signature: `c54f7eaedf3e4c72862f10693fc04408639a81dac3afd8a51f1d8cb3c2cda9f8`.

Validation development initially caught an action-ID comparison error, diagonal parity double crossings at beveled profile transitions, and float decomposition drift in test restoration. Those checks were corrected without changing any candidate layout or geometry. Failed and successful logs remain in `/tmp/opencode/brightvale-sol-composition/`.

## Visual critique and remaining limits

The highway now has a long rising silhouette, spanning approximately **433 vertical pixels** versus **229** previously, with the coherent platform/endcaps reaching from the foreground into it. The combined assembly spans approximately Y=153–860 of the 900-pixel view. The city is nearly frame-wide with its tall landmark cropped, rather than a small isolated diorama. The continuous walls replace visibly separated modules. These are real composition gains visible in neutral lighting, not lighting-only improvements.

The playfield is the largest coherent central element and follows the mockups' dominant trapezoid hierarchy. **The simplified projected lane-surface polygon covers 30.94% of the entire frame**, excluding caps/trim/crest; this is not a claim that measured gameplay pixels exceed 50%. It rises steeply and ends at a visible finite top edge. The city still has a relatively level cut-away base and repetitive architecture; surrounding ground/sky remain plain. No new terrain, skyline dressing, support structure or mockup-only feature was invented. The tilted playfield is visibly elevated above flat ground; physical support and collision remain unknown.

Five untouched spectators are hidden by the tilted assembly in sampled head rays. Remaining visible spectators are mostly upper-body views around the platform; crowd spacing/density and later world relationship are explicitly deferred, not corrected here. Side walls are partly cropped. Twilight is dimmer but retains lane and window separation; the plain sky and central specular highlight are existing preview presentation, not final atmosphere/material approval.

This does **not** prove final responsive fit, runtime camera equivalence, Three.js material parity, gameplay timing/projection, performance, or population acceptance. Existing distinct scenery/runway runtime perspectives remain untouched. Parent/designer must independently review before any user approval presentation.

## Reproduce into new paths

From the repository root, with installed Blender and cwebp only:

```bash
PACKAGE="$PWD/assets/authoring/brightvale-scene-review/candidate"
WORK=$(mktemp -d /tmp/opencode/brightvale-composition-reproduce-XXXXXX)
python "$PACKAGE/build.py" --output-dir "$WORK/build"
timeout 240 blender --background "$WORK/build/scene-review.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/validate.py" -- \
  --road "$WORK/build/highway.blend" --report "$WORK/validation.json" --negative-test
timeout 240 blender --background "$WORK/build/scene-review.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/../preview.py" -- \
  --output-dir "$WORK" --modes neutral audience twilight
for mode in neutral audience twilight; do
  cwebp -quiet -lossless -z 6 "$WORK/$mode.png" -o "$WORK/preview-$mode.webp"
done
```

Keep the candidate scripts beside the unchanged parent scene-review scripts/current scene, and retain the six sibling source `.blend` files plus the unchanged highway generator. The build wrapper bounds each Blender subprocess to 180 seconds, refuses existing output directories, and preserves generator scratch on failure. Do not promote or overwrite the original scene automatically.
