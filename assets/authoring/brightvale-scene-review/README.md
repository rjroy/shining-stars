# Brightvale composition study

Current editable study: [scene-review.blend](scene-review.blend). Actual matched
views: [Audience](preview-audience.webp) / [Twilight](preview-twilight.webp).
[Brief](composition-brief.md), [current validation](validation.json).

## Status and provenance

`shining-stars-4f4.26` assembled existing sources; `.27` consolidates this saved
state without changing geometry, materials, poses, crowd, camera or lighting.
User accepted the section/post semicircle direction and two-level ground
revision, then authorized six existing crowd placements to prevent complete
hiding. **Crowd-pass scene acceptance remains pending.** This is not production
approval, final density, export or runtime integration. The user's “80%” is
crowd density, not overall scene quality; the ten-person density is unresolved.
**Partial occlusion is allowed; complete hiding is always forbidden.**

Full history and superseded briefs/evidence remain in Git **e32e4d4**; earlier
framing checkpoint **e46e5ee**. Failed/obsolete candidates are not archived here.
Historical provenance properties inside the unchanged blend are intentionally
retained, including superseded composition fields; they are not the current
framing contract. The build preserves those original checkpoint hashes as
history, rather than mislabeling scratch serializations as original files.

Sibling source ownership remains separate and immutable:
[platform](../neon-twilight-platform/README.md),
[endcaps](../brightvale-platform-endcaps/README.md),
[highway](../brightvale-highway/README.md),
[framing](../brightvale-outer-framing/README.md),
[city](../brightvale-distant-city/README.md),
[crowd variants](../brightvale-crowd/variants/README.md).
Their approval/concept records stay in those packages; this study grants no new
source approval. Original mockups in `.lore/work/mockups/` are composition
references, not geometry specifications. No stage or performer.

## Reproduce and verify

Blender **5.2.1 LTS**; no dependencies installed. Keep this package beside its
six unchanged source packages. Paths are relative to scripts, not the shell's
working directory. [build.py](build.py) runs the original assembly, generator-
built 42-unit road and transform-only framing/ground/crowd recipes in owned
scratch. No predecessor blends are needed. Successful scratch is removed;
failure scratch is retained and reported. Existing outputs are refused.

```bash
P="$PWD/assets/authoring/brightvale-scene-review"
W=$(mktemp -d /tmp/opencode/brightvale-reproduce-XXXXXX)
timeout 1200 python "$P/build.py" --output "$W/scene-review.blend"
timeout 240 blender --background "$P/scene-review.blend" --threads 8 \
  --python-exit-code 1 --python "$P/validate.py" -- \
  --report "$W/validation.json" --compare "$W/scene-review.blend" --negative-test
# Optional read-only actual previews; source is never saved:
timeout 600 blender --background "$P/scene-review.blend" --threads 8 \
  --python-exit-code 1 --python "$P/preview.py" -- \
  --output-dir "$W" --modes audience twilight
```

The maintained blend and lossless 1600×900 WebPs were relocated byte-for-byte.
Scene SHA256 `fb630ac23fc576c42ebe4961b917b207fefb4894f9bbfc0b812bb6bf7329046b`.
Validation pins all 651 objects' semantic data/transforms, rig/action channels,
materials, camera, four lights, world/render settings and historical properties;
fresh regeneration matches exactly. Independent checks cover two ground levels,
city foundation, plaza footprints/perimeter, 26 sections/27 complete posts,
5,200 solid-joint samples, all ten spectators' first-hit 2-pixel-grid visibility
and 820 clear lane rays. Deliberate defects must fail. Binary regeneration is
not promised byte-identical because Blender serialization differs.

## Read and limitations

X lateral, +Y toward city, Z up; authoring units are **not approved meters**.
Road length 42, playfield tilt 14°; city uniform scale .35. Lower ground Z −.65,
plaza Z 8.25, center XY (0,20), radius 26.99636575. Common scene/camera/light
translation was +8.899999946 Z; crowd roots still share plaza height.
Camera (0,−15,13.89999962), 28 mm, 1600×900. Cycles 24 samples, denoised,
AgX Medium High Contrast, exposure 0. Audience/Twilight alter only inherited
world/light presets. Saved scene is neutral; previews are Blender evidence,
not Three.js fidelity proof.

Opened both retained images: five staggered spectators per side remain readable
above/around caps, with intentional partial body/limb overlap; rear figures are
small and darker in Twilight. Skyline cropping, plane-only suspended plaza,
physical support, portrait fit, density, optimization and runtime appearance
remain unresolved/out of scope. Cleanup does not start production work `.23`.
