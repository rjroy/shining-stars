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
after edits: when topology or shading changes, treat it as stale until deliberately
updated and reviewed. Blender viewport shading may differ slightly from the
shipped GLB.

## Placement and export

Blender uses Z-up; glTF uses Y-up. Keep the assembly root and provisional BU scale.
The gameplay transform remains external: scale `0.35`, position `(0, 3.9, -55)`.
Do not bake it, recenter the city or convert axes twice. Delivered Y-up bounds:
`(-105.025734, -13.647833, -113.020691)` to
`(103.477486, 97.000504, 52.164455)`.

Open `production.blend` in Blender 5.2.1 LTS (glTF exporter 5.2.40). Export all city
meshes and their root as GLB, +Y up, materials, normals, UVs and custom properties
enabled; animations, cameras, lights, extra attributes and modifier application
disabled. Preserve the mesh batches and material names.

For a future export, start from the saved `production.blend`; do not replay the
old reduction or batching pipeline. A stock Blender export is not yet a verified
replacement: Blender quantizes the custom shading normals, can omit non-default
IOR/emission metadata, and its output may use shared accessors unsupported by the
previous one-off compressor. No maintained export bridge is retained. Until a
small bridge is separately implemented and validated against the edited scene,
keep the shipped GLB unchanged. Any bridge must use current geometry/normals,
update stale `delivery_normal` values intentionally, preserve PBR metadata and
custom roles, compress below the 100 MiB delivery limit, and verify actual
GLTFLoader semantics; byte-identical output is not required.

## Verification and limits

Both saved Blender sources reopened successfully on 2026-10-18. The retained
production source and shipped GLB have been independently validated; no future
export is approved by that preservation check. The shipped GLB remains unchanged.
No new render or runtime appearance/performance acceptance is claimed.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `city.blend` | 26,693,060 | `edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff` |
| `production.blend` | 81,812,470 | `a5caa2d3ec237971e401e11deb226f091e6dd9ab9e980c796b5ccbda836a9ca5` |
| `city-meshopt.glb` | 59,559,056 | `db79454415423002bf87eb36d845a427f2c6c3e2dc4a3e63a05e4b2ded1be878` |

Approved concept references and selected original-scene evidence remain under
[`references/`](references/) and [`evidence/`](evidence/). The original's known
limits remain: stylized static water, a locally raised/narrow far-right approach,
and no claim of watertightness, navigability, physical scale or solved hydrology.
