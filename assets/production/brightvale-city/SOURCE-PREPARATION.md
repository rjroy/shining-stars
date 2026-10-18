# Brightvale city — bounded source inventory and first-derivative proposal

**Historical planning report, retained as measured input to the later authorized conversion.** The statements below describe the inventory-only checkpoint. See [README.md](README.md) for the current candidate, final contract and validation; this proposal is not current execution status. The existing `brightvale-distant-city` production/runtime remains untouched.

## Source, execution and count method

- Approved immutable input: `../../authoring/brightvale-city/city.blend`, authoring commit `d37afb4`, SHA256 **`edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff`**.
- Blender **5.2.1 LTS**, installed official glTF exporter **5.2.40**. Inventory loaded the actual master read-only from a non-repository scratch cwd, with `--threads 8`, `--python-exit-code 1` and 180/120-second timeouts. Inventory and an independent second evaluated-count pass exited **0**; source hash is unchanged. No exporter operator was executed.
- About 1.3 TB repository capacity was free at preflight. Owned scratch: `/tmp/opencode/brightvale-production-source-inventory/`; detailed per-object scratch and logs are removed after this concise report is verified. No copied `.blend`, rendered images or bulky geometry dump is retained here.
- [`source-inventory.json`](source-inventory.json) holds measured counts, native camera/bounds, installed exporter options, effects and an explicit **107-material proposed role map** with original PBR values. It is inventory/proposal, not a conversion recipe or a runtime material contract.

Counts use Blender's actual evaluated meshes and `loop_triangles`, not polygon estimates. Raw mesh datablocks are counted once. Placed totals multiply each evaluated resource by dependency-graph placement; source instance status is recorded separately. Exact resource comparison hashes local positions, triangle order/indices and material-index layout, smooth flags, corner normals and UV data; material-bound comparison additionally includes material slot names/order. It does not normalize baked translations or discover equivalent meshes with reordered vertices.

Evaluation used the static **VIEWPORT** dependency graph. All **72 Bevel + 26 Solidify** modifiers have identical viewport/render enable flags; there are no other city modifiers. The two placed-count passes, seven-family sums and per-material triangle sums agree. These are **full assembled source counts**, not frame-visible geometry, glTF vertex counts, decoded storage, draw calls, timings or performance budgets.

## Measured source inventory

| Measure | Result |
|---|---:|
| All scene objects | 5,417 |
| Object types | 5,369 meshes; 18 lights; 30 cameras |
| Physical city meshes, families 01–07 | **5,368** |
| Raw unique city mesh datablocks | **5,368** |
| Raw unique / placed triangles | **2,928,884 / 2,928,884** |
| Evaluated unique attribute/layout resources | 5,311; **2,945,764 triangles** |
| Evaluated unique material-bound resources | 5,317; **2,945,900 triangles** |
| Evaluated placed city triangles | **2,946,548** |
| Dependency-graph city placements | 5,368 |
| True instances / collection instances / particle systems | **0 / 0 / 0** |
| Linked-mesh repeat groups / repeated objects | **0 / 0** |
| Exact material-bound duplicate groups / objects | 15 / 66 |
| Used city materials / all source materials | **107 / 114** |
| Nonempty object/material triangle groups | 6,644 — **not measured draw calls** |
| City meshes with UVs / without UVs | 153 / 5,215 |
| Color attributes / image textures | 0 / 0 |
| Armatures / actions / animated city objects | 0 / 0 / 0 |
| Hidden-render / invisible-view-layer city objects | 0 / 0 |

| Family | Mesh objects | Evaluated placed triangles |
|---|---:|---:|
| 01 Citadel | 331 | 234,688 |
| 02 Districts and occupied interfaces | 1,399 | 1,094,388 |
| 03 Middle/far skyline | 1,265 | 405,596 |
| 04 Terrain and retaining fabric | 1,124 | 75,554 |
| 05 Bridges and landings | 320 | 84,804 |
| 06 Water surfaces and accents | 37 | 93,400 |
| 07 Planting | 892 | 958,118 |

The one extra mesh outside these seven families is **`Low.ravine.mist.volume`**, a 12-triangle volume container, not missing city architecture. It must not become an opaque box in a city GLB.

### Reuse and batching implications

There is **no existing GPU instancing and no linked mesh reuse** to preserve as such. The 15 exact material-bound duplicate groups save only **648 resource triangles** if reused; their placed total is unchanged. Repeated-looking motifs often have positions baked into independent mesh data. Do not promise large instancing gains from visual similarity or label clones as GPU instances.

Static, geometry-preserving batching by **exact source material within spatial/family partitions** is a plausible later packaging choice. It can reduce object/primitive overhead without changing accepted geometry. It must preserve split normals, material assignments, source-object provenance and world placement. A single whole-city batch would trade away culling granularity; chunk size needs the consumer camera/visibility contract, not an invented budget. The 6,644 source triangle groups are useful planning input but not a claim about rendered draw calls. No batching, deduplication, decimation, atlas, LOD or compression has been applied.

## Exact assembly contract proposed for the first derivative

1. **Input identity:** exact hash above; operate on a derived in-memory assembly or separate derived file, never save over `city.blend`.
2. **Scope:** include every physical city mesh in families 01–07, including accepted buried/interior components. No occlusion-based deletion or primitive regeneration. Keep study cameras, lighting and mist as separately described presentation data, not accidental mesh contents.
3. **Native coordinates:** right-handed Blender **+Z up**, original root origin **(0,0,0)**. The comparison camera approaches from negative Y. There are **no parented city objects**; **4,801** meshes have identity world matrices and origin zero, often with assembled positions already in their vertices. The remaining matrices still matter: **102 non-unit scales, including 96 nonuniform scales**, with no negative or singular determinants.
4. **Transform once:** retain evaluated local geometry plus its exact `matrix_world`; **or**, for a derived static batch, apply `matrix_world` once to vertices and the inverse-transpose to normals, then use identity batch transforms. Never apply both, reconstruct placements by eye, recenter each object, normalize the city, or invent a common center.
5. **Axis conversion once:** use the installed exporter's glTF +Y-up conversion. World-coordinate relation is **Blender `(x,y,z)` → glTF `(x,z,-y)`**. Do not add a second X-axis rotation in Three.js. Consumer placement/scale belongs to one separately agreed parent transform, not baked corrections scattered through nodes.
6. **Units:** source unit system `NONE`, `scale_length=1`, length `ADAPTIVE`. Retain numerical scale for the transfer; **1 BU is not an agreed physical meter**. Game placement and scale remain unknown.
7. **Native evaluated bounds:** `(-105.025734, -52.164455, -13.647833)` to `(103.477486, 113.020691, 97.000504)` BU. With axis conversion only, expected glTF bounds are `(-105.025734, -13.647833, -113.020691)` to `(103.477486, 97.000504, 52.164455)`.
8. **Study camera:** retain `Camera.Reference` as sidecar validation data, not an automatic gameplay camera. It is orthographic, scale **217.280792**, near/far **0.1 / 1000**, shift **0 / 0**, at native `(-27.147884, -181.003708, 52.845787)` with its exact matrix in JSON. The recorded matrix is row-wise native Blender data, not an unconverted Three.js column-major array. Existing evidence is 1792×1008. Game screen size and crop have not been measured here.

## Materials, UVs and portability

All **107 used materials** are a single constant **Principled BSDF → Material Output Surface** graph. No used surface graph has an image node, procedural texture, shader group, bump/normal map, vertex-color input or generated-coordinate texture. Thus baking is **not needed simply to transfer the existing surface materials**. The 153 `UVMap` layers are not certified bake atlases; most meshes have no UVs.

Preserve each source material's own base color, metallic, roughness, normal behavior and emission. **All used surfaces have alpha 1, transmission 0 and backface culling disabled.** The default Blender `DITHERED` material setting does not make these surfaces translucent. In particular, the accepted water is **opaque stylized water**, with separate surface, fall, foam and sheen geometry. Do not make it transparent/refractive, animate it, replace foam with textures, or force one water color without a visual decision.

Nine used materials have nonzero emission, all glazing/amber accents: citadel glazing variants 0/1, Left/Right glazing and lit-glazing, ravine amber, Middle warm glass and Far warm glass. Source strengths range **0.02–0.70**; preserve their relative intensity and source colors. The other citadel glazing variant is intentionally unlit. Gold/metal and stone/roof/glazing distinctions must survive any consumer mapping. Three ravine-water materials use **IOR 1.333**; all other used materials use 1.5. Check actual exported extensions and consumer handling rather than assuming all Principled controls survive unchanged.

Proposed stable functional roles (explicit per-source-name mapping in JSON):

`city.masonry`, `city.plaster`, `city.trim`, `city.roof`, `city.metal`, `city.paving`, `city.recess`, `city.glazing`, `city.rock`, `city.soil`, `city.foliage`, `city.wood`, `city.water.surface`, `city.water.fall`, `city.water.foam`, `city.water.highlight`.

These are semantic tags, **not permission to collapse 107 variants into sixteen colors**. Keep original material names/identity and per-variant factors alongside the tags. Preserve Left/Right/Middle/Far and citadel palette differences. A future derived recipe can emit deliberate whitelisted extras such as source object, source material, family and role; do not blindly copy every authoring custom property into an export.

### Presentation that does not transfer automatically

- **Local fog:** `Atmosphere | faint local ravine mist` is Principled Volume (density approximately 0.007). This is not a portable glTF surface material or an ordinary transmissive solid. Propose excluding its container from the physical GLB while retaining its visual intent in the appearance contract. Consumer fog replacement or deliberate omission needs explicit review.
- **Worlds:** Audience/Twilight use procedural normal-Z color ramps, Light Path camera-ray branching and separate background/illumination shaders. These do not serialize as a glTF environment. Neutral has a simple background. Exact node/link/ramp records are in the inventory; no environment bake is proposed.
- **Lights:** 18 total—3 suns, 5 areas, 10 warm local points, split across the three rigs and local anchors. The saved scene enables Audience and local anchors; Neutral/Twilight collections are disabled. Preview switches these rigs in memory. `KHR_lights_punctual` can represent sun/point/spot semantics, **not area lights** or the whole Blender lighting result. Do not export all mood rigs active together or add duplicate consumer lighting.
- **Tone/shading:** source uses AgX, exposure 0, gamma 1. There is no active compositor node group, despite a legacy `use_nodes=True` flag. Cycles lighting/reflections/shadows and AgX pixels are not guaranteed by numeric PBR transfer. A consumer-wide toon override, altered double-sidedness, fog, tone mapping or emission treatment is an appearance choice, not a geometry/export fix.

All surface materials are straightforward transfer candidates; the **volume/world/lighting presentation** is the main nonportable part. No external textures, fonts, linked libraries, rigs or particle caches are required. Two **unused-by-city local materials** retain non-loading append-history paths to an experiment checkpoint (`Water | falling sheets`, `Water | receiving lips`); the immutable master keeps this disclosed history. An assigned-material physical derivative need not include those unused datablocks.

## Installed exporter and bounded next execution

The installed exporter exposes `GLB` and `GLTF_SEPARATE`; the dynamic enum was inspected through its actual format callback. Relevant property defaults/descriptions are recorded in JSON. This is availability inspection, **not proof of a completed transfer**.

Recommended first authorized execution, **after consumer findings are combined**:

1. Write a deterministic, hash-guarded conversion recipe from this master into this new destination only. Select the complete physical city explicitly. Preserve full evaluated geometry and original material variants. No primitive regeneration, source regeneration, decimation, bake, LOD, compression or texture generation.
2. For a faithful static transfer use `export_apply=True`—its default is **False**, which would omit the accepted Bevel/Solidify result. Use `export_yup=True`, `export_materials='EXPORT'`, normals and available texcoords enabled, explicit selection/active scene, no collection recentering. Omit cameras, lights, animations, skins and morph animation from the physical asset; preserve the study camera and mood/effect descriptions separately. Keep `will_save_settings=False` and never invoke a source save.
3. Keep `export_gpu_instances=False` initially. Its installed description explicitly warns of Empty-parent requirements and possible multi-material omission; the source has no true instances to transfer. Keep Draco, Meshopt and `export_use_gltfpack` **off** for this first fidelity check. Do not silently enable simplification or lossy quantization.
4. Decide whether the first candidate retains source nodes or uses **geometry-preserving** family/spatial/material batches only after the consumer's material mapping and culling expectations are known. Preserve a source-object correspondence table either way. Export only the agreed candidate, not an automatic series of optimization variants.
5. Before implementation, add count/transform/material regression fixtures covering an ordinary mesh and an instanced mesh with count greater than one, plus nonuniform transform/normal handling. Validate the exported artifact's placed and unique triangles, bounds, normals, material assignments and extensions against the evaluated source. Actual GLB vertex count may increase at split-normal/UV/material boundaries; do not equate it to Blender vertex count.
6. Only with the parent's subsequent authorization, perform the bounded loader/visual comparison using **the same geometry in both modes**. Loader transfer and appearance approval are separate. Leave the old production path and actual game untouched.

**Blocking consumer/visual information:** actual loader/version and extension support; target placement/root transform, camera and screen size; whether material-role mapping preserves PBR variants or deliberately changes them; agreed world/fog/lighting/tone mapping and emission handling. These are not answered by this source inventory. Target-device/delivery budgets and whether reduction/baking/LOD would help remain **unknown**—the triangle count alone does not authorize changing accepted detail.
