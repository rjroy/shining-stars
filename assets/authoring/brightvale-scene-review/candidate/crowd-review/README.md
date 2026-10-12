# Crowd placement review

`shining-stars-4f4.26`, 2026-10-11. **Parent image review / user acceptance pending.** User accepted ground-review and authorized one lightweight placement pass. **Partial occlusion is allowed and complete hiding is forbidden as standing rules**, not study-only compromises. This is a composition study for later Three.js, not runtime integration. The user's **“80%” refers to crowd density, not overall scene quality**; density is a separate unresolved concern. This pass preserves the existing ten-person sample and does not establish that it meets the intended density. Parent will reconcile the density follow-up; no population expansion is authorized here.

- Editable [scene-review.blend](scene-review.blend), reproducible [place.py](place.py).
- Actual matched gameplay renders: [Audience](preview-audience.webp), [Twilight](preview-twilight.webp).
- [Placement brief and visible-sample evidence](placement-notes.md), [validation](validation.json), [preservation/regeneration](preservation.json).
- Read-only [validate.py](validate.py) and [preview.py](preview.py).

Six existing crowd roots move in XY and yaw toward the unchanged player camera. The other four spectators are untouched. Geometry, clothes, rig/pose/action channels, scale and local child transforms stay unchanged. **All 458 noncrowd objects**, including camera, four lights, city, floors, frame and playfield, preserve their exact checkpoint state. Every one of the **162 pre-existing authoring files** remains byte-identical. Source: [accepted ground checkpoint](../ground-review/README.md), SHA256 `8cca46b2edfd1794045d35112dc1f3c312e090ef91d0fc4f12f2ff85c96ab39f`.

Both lossless WebPs were decoded and visually inspected at 1600×900. Inherited Blender **5.2.1 LTS**, Cycles **24 samples**, denoising, 28 mm gameplay camera, AgX Medium High Contrast, exposure 0; only the unchanged parent Audience/Twilight world/light presets vary between views. No camera, lighting or material redesign. Scene SHA256 after rendering: `fb630ac23fc576c42ebe4961b917b207fefb4894f9bbfc0b812bb6bf7329046b`.

Saved reopen and independent regeneration match every semantic validation field. **820 lane rays clear**; all ten have meaningful first-hit screen samples and readable upper silhouettes in actual renders. Four deliberate defects rejected: lane intrusion, floating feet, fully hidden spectator, camera drift. Builds, validation, regeneration and render exit 0. Prior ground/frame/source checks are reused rather than repeated exhaustively.

## Reproduce

Keep the scene-review package and its unchanged sibling asset sources in their relative layout. Outputs must be **new paths inside scene-review**, never earlier candidates. No dependencies were installed.

```bash
P="$PWD/assets/authoring/brightvale-scene-review/candidate/crowd-review"
W=$(mktemp -d "$P/reproduce-XXXXXX")
timeout 180 blender --background --threads 8 --python-exit-code 1 \
  --python "$P/place.py" -- --output "$W/scene-review.blend"
timeout 240 blender --background "$W/scene-review.blend" --threads 8 \
  --python-exit-code 1 --python "$P/validate.py" -- --report "$W/validation.json" --negative-test
timeout 240 blender --background "$W/scene-review.blend" --threads 8 \
  --python-exit-code 1 --python "$P/preview.py" -- --output-dir "$W"
for mode in audience twilight; do
  cwebp -quiet -lossless -z 6 "$W/$mode.png" -o "$W/preview-$mode.webp"
done
```

No new characters, population increase, anatomy work, polishing, exports, runtime changes or commits. Whole-body visibility, portrait crops, production crowd density, physical support, optimization and Three.js appearance remain outside this study. Do not promote the candidate without review.
