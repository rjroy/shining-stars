# Section–post semicircle framing review

User-approved framing correction for `shining-stars-4f4.26`, 2026-10-11. **Parent review and user scene acceptance pending.** The prior long-short/no-post interpretation is superseded in [composition-brief.md](../../composition-brief.md). Only framing was replaced; no new asset geometry/materials, export, runtime work or commits.

## Evidence

- [Editable scene](scene-review.blend)
- [Neutral](preview-neutral.webp), [Audience](preview-audience.webp), [Twilight](preview-twilight.webp): actual 1600×900 matched-camera renders.
- [Top-down plan](diagnostic-top.webp): actual **1000×1000 orthographic diagnostic**, not a replacement gameplay view. Camera `(0,22,100)` toward `(0,22,0)`, ortho scale **62**. The complete arch and playfield are visible; the distant city is mostly outside this diagnostic frame.
- [Validation](validation.json) and [preservation checks](preservation.json).

All four images were decoded/opened and visually inspected. Cycles **24 samples**, denoising, AgX Medium High Contrast, exposure **0**, Blender **5.2.1 LTS**. Landscape geometry/camera/materials are identical across modes; only the unchanged parent preview's existing world/light mode values vary. No fog, bloom, compositor or lighting redesign. Previewing does not resave the source.

Scene SHA256: `59af1409cedd26a792007df8c857feb08aed3c3f4fc3f6c0838ed10699b92849`.

## Arc construction

One exact **180° centerline semicircle**, opening toward foreground **−Y**. Center **(0,20,−.65)**, radius **26.996366** authoring units; not meters or runtime scale. Ends at approximately **(±26.996,20,−.65)**; rear apex **(0,46.996,−.65)**. This is not two flattened side runs.

**26 existing long wall sections + 27 complete posts**: 53 ordered modules, **107 mesh drawables** (26 wall meshes + 81 post components). The interior sequence alternates section/post continuously; a complete terminal post finishes each open end. Every post includes the exact approved **stone pier + warm metal bezel + inset amber lens**, kept together with source local transforms/materials/modifiers. Post light faces point into the enclosure.

Post centers occupy angles **0…180°**, spaced **6.923077°**. Each unchanged **2.8-unit long section** follows the straight chord between its two neighboring post centers. Chord pitch **3.26** combines 2.8 wall + .70 post body minus two **.12** nominal joint overlaps. Radius is derived from `3.26 / (2 sin(pi/(2*26)))`, not from stretching meshes. Section ends overlap behind the post side cheeks; dressed cap/base overlap is slightly greater. This is a connected, subtly faceted assembly, not a Boolean-unioned or bent wall.

The scene's framing bounds are approximately `(-27.416,19.530,-.65)..(27.416,47.416,.70)`. Arc radius was selected to enclose the fixed long playing footprint without crossing it. No other asset was moved to make the arc fit.

## Checks

- Saved scene reopened; independently regenerated output reopens and matches all semantic validation fields, excluding the `.blend` container hash and additional negative-test results. Reproduction also checked under a relocated relative source/script layout.
- Nonframing semantic state is **exactly identical** to a fresh reopen of `candidate/initial/scene-review.blend`: object hierarchy/local/world matrices, base/evaluated geometry, material/modifier/rig/pose/action channels, ground, camera settings, world, lights and render setup. Highway length **42**, tilt **14°**, platform/endcaps, city and crowd remain fixed. Fingerprint: `accefe643ff280747ebebf1298d7ab7015ceb6dac8b48962b90ba1568ed1b5bf`.
- All framing mesh/material/modifier identities and child local transforms match fresh approved-source imports. **27 full visible three-component posts**, exact alternating sequence, true circular post centers, chord placement, inward post orientation and 180° extent pass. Maximum saved radius residual: **0.00000242** units.
- **5,200 evaluated solid-union samples** cover all 52 section/post joints: five longitudinal seam stations × five transverse stations across .44 of the .54 wall-body depth × four heights. They span .24 into the wall through .04 into the post side cheek. The source's intentional central lamp-pocket cavity is not falsely required to be filled. No sampled open seam; nominal overlap minimum **.119999**. This is a substantive sampled check, not an exhaustive solid-union proof.
- **820 lane visibility rays** clear. Every evaluated playfield vertex stays inside the circle. Linear support projections of the framing vertices bound its complete polygon faces outside the playfield's maximum radius: conservative radial plan separation lower bound **2.631** units. Thus the framing does not cross the fixed playfield footprint or rely on its elevation to avoid collision.
- Four deliberate errors rejected: noncircular post placement, hidden post component, actual section/post gap, and changed nonframing camera. Test restoration reproduces the same evaluated geometry/state fingerprints.
- All original source-package files, maintained scene-review files, and **every `candidate/initial` file including its three previews remain byte-identical**. Only the handoff brief, build wrapper and candidate README were intentionally amended; new framing scripts/evidence are separate. Source hashes and preservation counts are recorded in the linked reports.
- Successful build, saved reopen, validation, regeneration and all four renders exit **0**. Existing outputs are refused. Syntax, local links, image dimensions and source/candidate post-render hashes checked. Logs and rebuild copies stay in `/tmp/opencode/brightvale-framing-review/`, not accumulating maintained trial directories.

## Visual findings and limits

The top-down diagnostic clearly establishes a semicircular arch open toward the player. The section/post cadence is continuous, with square post caps between rigid chord sections. No visible open joint was found. The unchanged gameplay camera strongly foreshortens the low arch; it reads as a curved rear boundary with repeating amber post faces. Its center is hidden by the elevated road, and the distant arc endpoints lie outside the landscape frame. The top view diagnoses this honestly rather than replacing or adjusting the requested gameplay camera.

There is no source-shape or gameplay-obstruction blocker for this radius. Overlaps retain the approved profiles and may show shallow cap seams; this is not a seamless curved mesh. Foreground side space is now open, as expected for a semicircular arch rather than the prior straight side runs. City/ground appearance, elevated-ramp appearance and crowd arrangement are explicitly tabled and unchanged. No final runtime/responsive fit or scene acceptance is claimed.

## Reproduce to new outputs

Keep the existing scene-review package/sibling sources and `candidate/initial` intact. Scripts use relative paths; no scratch input dependency.

```bash
PACKAGE="$PWD/assets/authoring/brightvale-scene-review/candidate"
WORK=$(mktemp -d /tmp/opencode/brightvale-framing-reproduce-XXXXXX)
python "$PACKAGE/build.py" --framing-only --output-dir "$WORK/build"
timeout 240 blender --background "$WORK/build/scene-review.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/framing-validate.py" -- \
  --report "$WORK/validation.json" --negative-test
timeout 240 blender --background "$WORK/build/scene-review.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/framing-preview.py" -- --output-dir "$WORK"
for image in neutral audience twilight diagnostic-top; do
  cwebp -quiet -lossless -z 6 "$WORK/$image.png" -o "$WORK/$image.webp"
done
```

The `--framing-only` branch never regenerates the highway or reassembles other assets. Default legacy build behavior remains available to reproduce the preserved initial composition, not as current framing direction.
