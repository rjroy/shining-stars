---
title: "Blender-to-Three.js Asset Production Research"
date: 2026-10-11
status: completed
tags: [blender, threejs, gltf, assets, research]
---

# Blender-to-Three.js Asset Production Research

## Key Findings

- glTF is a runtime interchange format, not a copy of a Blender project. Blender's current exporter documents core metallic/roughness and unlit materials; it serializes recognized node patterns, not arbitrary Blender shader networks. Do not expect procedural graphs, custom toon ramps, Blender-only modifiers, or a Cycles render to transfer with image parity.
- Treat Blender source as the editable source-of-truth and GLB as a derived deliverable. Preserve procedural authoring and composition study in source; bake only selected appearance data when it serves a screen-space need and test in the actual browser renderer.
- Because the game deliberately changes between warm Audience and violet Twilight lighting, baked lighting/shadow color is risky: it can encode one mode into both. Prefer geometry, neutral base color, and emissive detail that remain useful under both modes. AO describes occlusion caused by nearby geometry, not illumination from a fixed light setup; it may double-darken under runtime shading or bake inter-object occlusion that becomes stale when placement changes. Baked normal maps can transfer high-frequency shape, not silhouette.
- Meshopt/Draco/KTX2 are optional delivery choices, not source-authoring defaults. Three.js requires configured decoders/loaders for compressed assets. Compare measured browser startup, transfer size, GPU memory, draw calls, and visual results before adopting any option.
- For the repeated crowd, distinguish reusable mesh instancing from rigged character animation: `InstancedMesh` targets identical geometry/material with per-instance transforms and reduces draw calls, while skinned characters need animation/skeleton behavior. A static baked crowd or billboard/pose atlas is an option only if crowd movement is unnecessary at its distance; it is not equivalent to rigged animation. There is no player avatar/performer in scope; do not introduce one.
- Preserve city silhouette and landmark shapes before reducing detail. Any simplification should be judged at actual camera framing and distance, then checked against the recognizable skyline, rather than applying a triangle-count target without evidence.

## Scope and evidence labels

This memo addresses approved study for a future production-pass skill: rhythm highway/platform/endcaps, reusable section-post walls, intricate distant fantasy city, and repeated three-character crowd. It does not set budgets or authorize runtime exports. **Documented fact** means directly supported by cited docs; **local evidence** is read from current project files; **inference** applies those facts to this project's two lighting modes; **option** is a path to test, not a settled production choice. Research checked 2026-10-11. Web docs may track rolling versions; verify installed Blender/Three.js versions before writing version-sensitive instructions. `status: completed` means research is complete, not user acceptance or implementation authorization.

## Local project audit synthesis

Evidence read: `package.json` pins Three.js **0.186.1**. `src/scene.ts` sets renderer output to sRGB, ACES Filmic tone mapping, exposure 1.05 and pixel-ratio cap 1.5 (lines 252–261); scenery uses a 36° perspective camera (263–271), while the board/runway uses 60° (497–527). The runway is largely `MeshBasicMaterial` (530–558); city materials, emissive accents, lights, mode changes and veil are runtime-controlled around lines 273–277, 296–475, 972–999. The audited scene code shows no toon-material pipeline. This makes Blender preview matching especially unsafe to assume: local asset READMEs report Blender 5.2.1 / AgX authoring, while the web scene uses Three.js r186 / ACES Filmic. Keep shared baked appearance neutral where feasible.

Authoring evidence: `assets/authoring/brightvale-distant-city/README.md` describes six shared material regions, linked Blender mesh reuse, palette variants, and no textures/UVs; it explicitly makes no claim of runtime GPU instancing. `assets/authoring/brightvale-platform-endcaps/README.md` records an approved editable pair with 2,568 evaluated triangles, two materials and two objects, while runtime export/integration remains unauthorized. `assets/authoring/brightvale-highway/README.md` documents a static 14-mesh, 8-material-region highway and separates its provisional authoring interface from runtime integration. `assets/authoring/brightvale-scene-review/README.md` is the current editable composition study; crowd-pass acceptance remains pending, partial occlusion is allowed, complete hiding is not, and there is no stage or performer. `assets/authoring/brightvale-crowd/README.md` records approved character base, rig, poses and three variants, while full population/density/placement and runtime animation/export remain open. No target devices or performance budgets were found in these audited sources.

**Pilot ordering recommendation (inference):** first use the approved endcap pair as a minimal transfer/material pilot; it is small and measurable, but proves nothing about city/crowd performance. Next use a representative city slice with landmark silhouette and several material regions as the first meaningful geometry/material/texture optimization test. Treat crowd as its own animation-versus-static study, starting with the current three-character set. The city README's linked meshes do not establish runtime GPU instancing; verify actual behavior. Include the reusable section/post family in the composition study or an appropriate pilot slice to assess repeatability and visibility.

The current `.agents/skills/asset-workflow` and `blender-model` skills already preserve source, provenance and approvals, and defer export/runtime integration. A focused production skill should complement rather than duplicate those responsibilities.

## What crosses the Blender → glTF boundary

**Documented facts.** Blender's glTF exporter says it supports Metal/Rough PBR (glTF core) and Shadeless (`KHR_materials_unlit`), constructing a glTF material from recognized Blender nodes. It lists Principled BSDF-supported inputs and texture connections; arbitrary shader graphs are not a glTF material contract. The exporter uses evaluated mesh data, so modifiers may affect exported geometry when applied/evaluated for export, but the procedural modifier setup itself is not a runtime glTF feature. Blender's exporter docs also note that instancing support has constraints (instances must be meshes, cannot have children, and share parent constraints). Blender docs: [glTF 2.0 exporter/importer](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html).

glTF core carries mesh attributes, node transforms, PBR materials and textures, skins/joints/weights, and animation data. The format is not a Blender node graph, modifier stack, geometry-nodes recipe, or a Cycles renderer. Accordingly, export should be treated as baking/translation into the portable contract, not as live Blender evaluation inside Three.js. Khronos core spec: [glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/); [Khronos PBR guide](https://www.khronos.org/gltf/pbr).

**Three.js rendering distinction.** Three.js has a `MeshToonMaterial` and toon-related rendering features, but that does not make Blender toon shader nodes portable through core glTF. A glTF material imported by `GLTFLoader` is mapped to Three.js material behavior; a project-specific toon look may need a post-import material/shader pipeline or a texture-based look, and is a runtime integration decision outside asset-skill scope. `GLTFLoader` documents its supported extensions and material handling: [GLTFLoader docs](https://threejs.org/docs/GLTFLoader.html), [MeshToonMaterial docs](https://threejs.org/docs/MeshToonMaterial.html).

**Bake options (inference/options).**

- **Base-color/detail atlas**: suitable for painted patterns, windows, graphic marks, and other non-lighting appearance. It survives as a base-color texture, but verify UV layout, texture color space, resolution at screen size, filtering, and atlas padding.
- **Normal map**: suitable for small surface form that cannot be read from silhouette at expected distance. It changes shading, not geometry or silhouette; high contrast/stylized facets may need authored geometry instead.
- **AO map**: represents occlusion caused by nearby geometry, not fixed-light illumination. It can convey contact/readability, but runtime shading may darken it again (double-darkening); baked inter-object occlusion may become stale if objects are repositioned. Keep restrained and check both lighting modes and intended placements.
- **Emission**: appropriate for intended self-lit accents, not as a substitute for colored lighting on whole objects. glTF emission is a material property/map; actual bloom/glow is a renderer/postprocessing effect, not inherent to a texture.
- **Full diffuse/beauty bake**: most likely to lock in one Blender lighting mode and lose response to runtime mode changes. Avoid as default for shared-mode assets; consider only isolated distant set dressing after side-by-side tests and explicit approval.

Do not promise Cycles-to-Three.js image parity. Bake outcomes depend on the chosen bake pass, color transforms, UVs, renderer tone mapping, light setup, and supported material fields. Blender documentation describes export mapping, not guaranteed pixel parity.

## Color and channel packing

glTF PBR uses base color plus metallic-roughness parameters. The standard packed metallic-roughness texture convention places roughness in G and metalness in B; occlusion may use the R channel of a separate texture, although glTF allows sharing image/UV data in controlled ways. Base-color and emissive color textures represent color data and should be treated as sRGB; normal, roughness, metalness, and AO are data maps and should be sampled linearly. Three.js color management handles glTF color textures through `GLTFLoader`; custom textures must be assigned the correct `colorSpace` (`SRGBColorSpace` for color maps; leave data maps linear). [Khronos PBR](https://www.khronos.org/gltf/pbr), [Three.js color management](https://threejs.org/manual/en/color-management.html), [glTF spec](https://registry.khronos.org/glTF/specs/2.0/).

Texture channel packing is a storage/texture-fetch optimization, not a free quality gain. Keep packed map meaning explicit in names/authoring notes, and inspect imported channels. A painted base-color atlas is not an AO/lightmap: keep appearance maps separate conceptually so mode-tint control remains available.

## Instances, rigging, crowds, and draw calls

Blender collection/object instances are an authoring concept; exporter behavior and glTF node reuse are distinct from runtime GPU instancing. The Blender manual explicitly documents exporter instance limitations. Three.js `InstancedMesh` is a runtime class for repeated same-geometry/material objects with distinct transforms and reduces draw calls. `EXT_mesh_gpu_instancing` may represent instance transforms in glTF and is supported by current Three.js `GLTFLoader`, but confirm the chosen exporter and exact library versions produce/consume it as expected. [Blender glTF exporter](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html), [Three.js InstancedMesh](https://threejs.org/docs/InstancedMesh.html), [GLTFLoader supported extensions](https://threejs.org/docs/GLTFLoader.html).

Three.js animation clips, `AnimationMixer`, skins, and `SkinnedMesh` are available for animated glTF characters. A rigged crowd is not automatically equivalent to one instanced draw: each independently animated rig has per-character state/costs; common skeleton/animation may make batching strategies possible but need a prototype. Conversely, one static combined crowd mesh is compact and simple but cannot provide independently responsive movement. Consider three explicit tiers and select from shot requirements:

1. **Visible audience**: reusable low-complexity characters with a small set of loops/poses if independent animation is wanted; test runtime costs and visual repetition.
2. **Far audience**: static posed clusters, merged geometry, impostors, or texture/atlas are options if screen-size and motion requirements permit.

These tiers are recommendations, not documented performance guarantees. Need a representative browser prototype before deciding between instancing, skinning, merged/static, or billboards. [Three.js AnimationMixer](https://threejs.org/docs/AnimationMixer.html), [SkinnedMesh](https://threejs.org/docs/SkinnedMesh.html), [InstancedMesh](https://threejs.org/docs/InstancedMesh.html).

## Screen size, city detail, and LOD

No source cited here establishes a universal polygon/texture budget for this game. Use expected camera framing and screen-space contribution as the decision basis: retain silhouette-defining towers, roof shapes, and landmark negative spaces; reduce/remove details that do not resolve at distance, or represent them by color/emission accents. For a city, blind decimation can alter the main visual identity even when triangle reduction is large. Use camera comparison before/after and inspect both lighting modes. `THREE.LOD` supports distance-selected objects, but how/if to create city LODs is a scene/runtime decision, not something to assume the Blender export sets up automatically. [Three.js LOD](https://threejs.org/docs/LOD.html).

For the highway/platform/endcaps and repeated section walls, modularity and clean joins likely matter more than tiny unseen bevels. This is project-specific inference: establish a representative camera and a pixel-height/visibility criterion during the pilot; do not invent a numeric threshold now.

## Compression and browser integration

- **Meshopt (`EXT_meshopt_compression`)**: compresses geometry and can cover morph targets/keyframe animation in glTF tooling; Three.js needs `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`. This adds decoder setup/versioning and must be tested in the real app.
- **Draco (`KHR_draco_mesh_compression`)**: geometry compression supported by Three.js through configured `DRACOLoader`; measure decode/startup as well as transfer size. Not an automatic reduction in GPU-resident decoded geometry.
- **KTX2/Basis (`KHR_texture_basisu`)**: compressed texture delivery; configure `KTX2Loader.detectSupport(renderer)` and attach it to `GLTFLoader`. Device support determines transcoding target. Compare color/normal fidelity and loading cost.
- Compression does not remove the need for geometry/texture choices, and output size does not equal GPU memory or runtime cost. Avoid applying all transforms indiscriminately; each lossy operation needs a visual and metric comparison.

Sources: [Three.js compressed glTF example](https://threejs.org/examples/webgl_loader_gltf_compressed.html), [GLTFLoader docs](https://threejs.org/docs/GLTFLoader.html), [DRACOLoader docs](https://threejs.org/docs/DRACOLoader.html), [KTX2Loader docs](https://threejs.org/docs/KTX2Loader.html), [glTF Transform](https://gltf-transform.dev/). glTF Transform's current documentation describes operations such as deduplication, pruning, quantization, Meshopt/Draco compression, and texture conversion; these are optional transformations. Verify extension ordering and tool versions in any real pipeline.

## Candidate skill: `asset-production`

**Later user direction (2026-10-11):** a reduced runtime crowd is required, not an unresolved question or a default to export the detailed crowd unchanged. Since the crowd is small on screen and numerous, prioritize readable silhouette, pose, and color blocks at actual screen size; detailed crowd triangles are unnecessary where they do not resolve. Keep the editable rig/source, then choose static pose/mesh instancing versus skeletal animation based on the motion requirement. Partial occlusion is allowed, but the crowd must not be completely hidden. This does not authorize a new performer/avatar or any production/export work.

Recommended as a narrow future production-pass skill. Responsibilities and deliverables:

- Preserve approved `.blend` source as immutable authority; create derived geometry/material/texture/export only in a separately scoped output location with reproducible provenance and measurements.
- Define the export contract: intended consumer, object/material/UV/skin/animation expectations, transforms, texture color-space/channel meaning, extensions/loaders if any, and unsupported Blender constructs. State the runtime shader boundary: export does not carry arbitrary node graphs or custom toon appearance; Three.js material/shader work remains separate runtime work.
- Compare source and derived asset at approved composition and representative screen sizes, recording why and what was measured for each reduction, bake, LOD, or compression choice. Baking, LODs and compression are options, not required checklist steps.
- Deliver source and derived paths/hashes (if authorized), tool versions, export settings, validation output, screenshots/metrics, and a concise browser-owner handoff listing caveats and open questions.

## Suggested minimal measurable workflow and approval gates

This is a recommended skill structure, not an export authorization.

1. **Source-preserving baseline (approval: asset scope and target view).** Keep `.blend` editable with procedural construction and composition study intact. Record Blender version, camera/view, object/material/texture inventory, rough polygon/texture counts, and representative screenshots in Audience and Twilight modes. Do not replace source with a flattened export.
2. **Pilot slice (approval: bounded export experiment).** Start with the approved endcap pair as a minimal transfer/material pilot; it cannot establish city/crowd performance. Then choose a city slice with landmark silhouette, one detailed building, and a repeatable section/wall/post element. Include representative color and emissive appearance; use normal/AO only if justified. Keep source unchanged. Create a derived export only with explicit approval.
3. **Export inspection.** Check GLB in a glTF inspector/viewer and Three.js `GLTFLoader`: expected scene hierarchy, mesh/material/texture/UV/skin/animation data, transforms/scale, texture channel interpretation, warnings, and missing unsupported material behavior. Compare screenshots to source composition, not only Blender beauty render.
4. **Browser validation boundary.** A separately authorized disposable validation harness may load the pilot under existing renderer settings for isolated comparison; asset/export authorization does not authorize that harness. Integrating into the game, changing `src/scene.ts`, implementing shader/material logic, or accepting runtime presentation requires separate authorization and later integration approval. Otherwise hand off to the browser owner.
5. **Measure before choosing optimization.** Capture GLB bytes, decoded geometry/texture counts or GPU memory estimates available in app tooling, renderer draw calls, load/decode time, and frame timing on target hardware/browser. Compare uncompressed baseline to one candidate change at a time (e.g., Meshopt or KTX2); preserve screenshots and metrics. No numerical pass/fail budgets are currently established.
6. **Decision gate before scaling.** Decide only choices needed for the next step, using pilot evidence. Open user decisions: target devices/performance expectations; whether/how much background crowd should move; and desired Three.js cel-shading/look treatment versus current material approach. These need not all be settled before documenting a gated skill or an authorized source-preserving study. Do not invent budgets. Browser/runtime implementation remains separate.

## Limitations and version caveats

- Blender manual URL is `/latest/`; it reported Blender 5.1, while local authoring READMEs report installed Blender 5.2.1 LTS. I did not verify 5.2.1-specific exporter behavior against installed docs; confirm exporter options/output against that installation before operational instructions.
- Three.js docs/API and examples are rolling/current. Local `package.json` pins 0.186.1 (r186), but this research did not retrieve version-pinned r186 docs. Extension support, loaders, color management, and renderer behavior are reported from current docs and local code, not asserted as verified against the exact pinned release. Check installed revision and test before operational instructions.
- Khronos glTF core is the authoritative interchange spec; extension support still depends on exporter, loader, extension version, and runtime configuration.
- No export, model edit, install, or browser profiling was performed. Performance choices remain unmeasured. Local evidence is limited to the cited project files and does not establish target-device costs.

## Dated source list (checked 2026-10-11)

1. Blender Manual, **glTF 2.0**: https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html — official exporter material, texture, geometry, animation, and limitations documentation; rolling `/latest/`, not verified against installed 5.2.1.
2. Khronos Registry, **glTF 2.0 Specification**: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html — authoritative core format; extensions are separate specifications.
3. Khronos, **Physically Based Rendering in glTF**: https://www.khronos.org/gltf/pbr — official explanatory guide to base color, metallic, roughness, normal and material semantics.
4. Three.js, **GLTFLoader**: https://threejs.org/docs/GLTFLoader.html — official current loader API and supported extensions.
5. Three.js, **InstancedMesh**: https://threejs.org/docs/InstancedMesh.html — official runtime instancing API and draw-call use case.
6. Three.js, **MeshToonMaterial**: https://threejs.org/docs/MeshToonMaterial.html — official toon rendering material; does not imply Blender custom toon graph exports as glTF.
7. Three.js, **Color management**: https://threejs.org/manual/en/color-management.html — official color space guidance.
8. Three.js, **AnimationMixer**, **SkinnedMesh**, **LOD**: https://threejs.org/docs/AnimationMixer.html ; https://threejs.org/docs/SkinnedMesh.html ; https://threejs.org/docs/LOD.html — official runtime APIs.
9. Three.js, **DRACOLoader**, **KTX2Loader**: https://threejs.org/docs/DRACOLoader.html ; https://threejs.org/docs/KTX2Loader.html — official compressed asset decoder APIs.
10. Three.js, **compressed glTF example**: https://threejs.org/examples/webgl_loader_gltf_compressed.html — official example showing Meshopt decoder and KTX2 loader setup.
11. glTF Transform, **documentation**: https://gltf-transform.dev/ — community open-source tooling docs; useful for post-export transformations, not a substitute for validating exact output/runtime compatibility.
