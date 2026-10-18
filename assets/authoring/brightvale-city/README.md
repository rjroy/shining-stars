# Brightvale city — editable sources

- **Continue editing the delivered city:** [`production.blend`](production.blend).
  Its reduced geometry, spatial batches, material assignments and runtime metadata
  are saved locally; no generator or historical production replay is needed.
- **High-detail original:** [`city.blend`](city.blend), preserved unchanged. It
  retains the original component organization, modifiers, lighting and cameras.
- **Current delivery:** [`city-meshopt.glb`](../../production/brightvale-city/city-meshopt.glb),
  unchanged. Git holds history; these sources do not promise byte-identical exports.

## Decisions

The original was approved on 2026-10-17. Its 5,368 geometry objects evaluated to
2,946,548 triangles. Subsequent authorized production work reduced foliage and
selected trim, then regrouped the city into spatial/material batches. Those
changes previously existed only in GLB files, not in the original Blender scene.

On 2026-10-18, the delivered geometry was preserved in `production.blend`: 2,304
editable mesh objects, 2,589,764 triangles, seven family collections and 107 local
Principled materials. The source was the existing uncompressed spatial GLB,
verified equivalent to the shipped GLB through Three.js's actual Meshopt loader.
This was preservation, not additional optimization or visual approval.

All PBR values, UVs, the `Window` name, nine `emissive_window` materials and
`city_role`/`surface_role`/`source_material` properties remain available. No linked
libraries or external images are needed. Object origins remain at the assembly
origin, matching the delivered spatial batches; disconnected pieces remain
editable in mesh Edit Mode. No source-object reconstruction is required.

Blender's importer discarded 2,378 redundant/degenerate triangles in 36 batches.
Their corners were separated without moving vertices to retain every delivered
triangle. The file also carries the imported custom shading normals in the
CORNER-domain vector attribute `delivery_normal`, in Blender coordinates. It is
a snapshot of the preserved delivered geometry, not an automatic source of truth
after edits. Future exports use current mesh corner normals; this saved attribute
is informational and is not forced onto edited geometry. Blender viewport
shading may differ slightly from the shipped GLB.

## Placement and export

Blender uses Z-up; glTF uses Y-up. Keep the assembly root and provisional BU scale.
The gameplay transform remains external: scale `0.35`, position `(0, 3.9, -55)`.
Do not bake it, recenter the city or convert axes twice. Delivered Y-up bounds:
`(-105.025734, -13.647833, -113.020691)` to
`(103.477486, 97.000504, 52.164455)`.

Export a review candidate from the saved source with Blender 5.2.1 and Node 22+:

```bash
npm run export:brightvale-city
```

This writes the ignored `test-results/brightvale-city/city-candidate.glb`. The
command exports current mesh normals, UVs, PBR materials and custom properties,
then Meshopt-compresses eligible buffer views (including shared accessors). It
never overwrites the shipped GLB. Review the candidate in the actual game before
deliberately copying it into the runtime package. The saved `delivery_normal` is
not exported or forced onto subsequently edited geometry. Byte-identical
regeneration is not expected.

## Verification and limits

Both saved Blender sources reopened successfully on 2026-10-18. The maintained
export command is validated against the saved source and actual game route; this
does not itself authorize replacing the shipped asset. No target-device
performance claim is made.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `city.blend` | 26,693,060 | `edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff` |
| `production.blend` | 81,812,470 | `a5caa2d3ec237971e401e11deb226f091e6dd9ab9e980c796b5ccbda836a9ca5` |
| `city-meshopt.glb` | 59,559,056 | `db79454415423002bf87eb36d845a427f2c6c3e2dc4a3e63a05e4b2ded1be878` |

Approved concept references and selected original-scene evidence remain under
[`references/`](references/) and [`evidence/`](evidence/). The original's known
limits remain: stylized static water, a locally raised/narrow far-right approach,
and no claim of watertightness, navigability, physical scale or solved hydrology.
