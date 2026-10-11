---
title: "A practical stylized crowd-character pipeline"
date: 2026-10-11
status: completed
tags: [research, crowd, characters, blender, threejs]
---

# A practical stylized crowd-character pipeline

## Key Findings

- The approved direction is a clean cel-shaded anime crowd in contemporary clothing, with varied player-facing poses; it is not a style or genre decision still waiting on approval. The approved concept image and brief settle this. Exact game-camera distance remains open.
- The user's proposed order—make one deliberate neutral base figure, rig it simply, pose it, then reuse it—is a useful bounded experiment. The neutral base need not be T-pose by doctrine: a T-like arm spread exposes torso/arm construction and makes symmetric limb access convenient, while an A-pose can be closer to a natural shoulder rest and may be easier to adapt to clothing or deformation. Choose the rest pose that best supports the approved design and intended arm movement; record it. Do not confuse the rig's rest pose with the crowd's visible pose variants.
- A rig is a posing/reuse tool, not a fix for poor character design. Silhouette, head/body proportions, hair masses, garment shapes, face readability and intentional topology must be judged before investing in skinning. A 441,496-triangle figure with poor shape is evidence of this distinction, not a reason to optimize blindly.
- A rig may serve both reusable pose authoring and runtime animation. The crowd's animation purpose is not settled: issue `shining-stars-4f4.6` is open and specifically discusses whether anything should move. Do not assume static poses are the final runtime choice, and do not build animation before that decision and the separate asset/runtime approvals.
- For this Three.js game, repeated static forms may benefit from `InstancedMesh`; however, its documented contract is shared geometry/material with per-instance transforms. Different pose meshes are different geometry, so group instances by pose/variant, or use ordinary meshes where variation is more valuable than draw-call reduction. Do not assume a rigged animated crowd is automatically compatible with standard instancing.
- Reusable authored source meshes and an explicit pose library are more reliable than depending on a third-party character add-on of uncertain Blender 5.2 compatibility or a hosted asset service. If an existing base is considered, first inspect its actual license and whether its form/style can be edited into this game's needs; neither a permissive license nor a rig guarantees usable art.
- Cel shading is a separate rendering/export decision. Blender NPR nodes/render settings are not proof of Three.js appearance. Favor a small runtime-material/render test in Three.js after the form reads well; don't use Blender render polish to mask weak construction.

## Recommendation: one deliberately small experiment

The existing description/concept are approved; no new style approval is needed. The next geometry-only prototype is a bounded modeling task, not runtime integration:

1. Use the approved reference [concept-cel-shaded-candidate.webp](../../../assets/authoring/brightvale-crowd/concept-cel-shaded-candidate.webp) and [brief](../../../assets/authoring/brightvale-crowd/brief.md): contemporary-clothed, clean cel-shaded anime audience facing the player, with varied natural poses and two-mode lighting/material treatment. Make one neutral base figure with silhouette-first geometry, economical explicit topology, clear color/material regions and readable face/hair. Choose a T-like or A-pose by practical construction/deformation needs, not as dogma. Keep this editable and reproducible in Blender 5.2.1.
2. Inspect silhouette and stylization in front, side, rear and intended game camera before rigging. If it still looks doll-like or generic, revise shape—not add bones. Use stylized hair as designed, coherent graphic masses and clear garment silhouettes rather than defaulting to many thin strands or detached primitive pieces.
3. If the base passes visual review, add a compact skeleton sufficient for the intended poses. Inspect weights/deformations. Test whether Blender's quick Auto IK or a small IK constraint improves arm/hand posing enough to justify setup; use direct bone posing if it is simpler. IK is an optional posing aid, not an automatically excluded feature. No need to build advanced controls absent a use case.
4. Make a few pose variants for geometry review; preserve the rigged source and optionally bake variants for preview/comparison. This remains geometry work. Any Three.js runtime crowd/material/performance trial or exported integration requires explicit runtime-integration authorization; it is not included in this prototype recommendation.

**Gate:** If the neutral model does not read cleanly, stop before rigging. Pose quality can then be judged without runtime assumptions. Whether the crowd should move is a separate unresolved decision under `shining-stars-4f4.6`; runtime implementation remains separately gated.

## Options and trade-offs

### Local diagnostic findings

Read-only review of `assets/authoring/brightvale-crowd/build.py` found that fine voxel unions and smoothing (lines 99–109; hand/arm voxel size at 349, shirt at 378, trousers at 411) spend geometry on sampling simple forms rather than improving anatomy. Hard-coded joint positions and upper-body shear (444–466) couple construction to a single pose. The analytic face and repeated hair-lock recipes (128–147, 209–241, 265–284) remain visible style bottlenecks despite high density. These line references describe the failed diagnostic generator, not a proposed implementation.

Replace the posed tube-union construction with deliberately placed neutral-pose topology; retain useful material naming, source protection, and generic geometry checks. Rigging will not repair the face, hair, garment silhouette, or hands. The current validator explicitly rejects armatures/modifiers, so a later authorized rig trial requires adapting those checks. Keep the diagnostic source as unapproved evidence, not a reusable accepted character base. Reported mesh counts were not independently remeasured during this read-only diagnosis.

| Route | Use when | Cost / caveat |
|---|---|---|
| Authored low-complexity base + useful simple rig | Need coherent custom anime-style silhouettes and reusable poses; may later support animation if separately approved | Requires visual modeling and weight inspection. Rigging helps re-pose, not create appealing face/hair/forms. IK may be worth a small trial for raised/reaching arm poses. |
| Static authored figures with no rig | Only a few figures/poses, or planned body parts are rigid and poses can be built directly | Lowest technical complexity; each pose edit is manual. Could be preferable if rigging takes longer than producing the needed variants. |
| Existing character/character creator output | A specific candidate already meets style, silhouette and license requirements | May be realistic, generic, over-detailed or difficult to edit. Inspect each model's license and geometry; tooling/export compatibility must be tested. No asset download or tool install is authorized by this research. |
| Runtime skinned animation | Only after deciding the crowd should move and obtaining runtime integration authorization | More authoring/export/runtime work and deformation/instance complexity. Blender 5.2 glTF supports skinning and bone animation, but that does not itself solve Three.js crowd instancing or performance. |
| Distant 2D/billboard silhouettes | Only for optional far-background layers where 3D detail is unreadable | Efficient depth layer, not a substitute for the approved player-facing 3D crowd. Avoid silently changing the visual brief. |

## Implementation evidence and distinctions

**Blender 5.2.** The official manual describes armature deform parenting and vertex groups, and says automatic weights are distance/bone-heat based but “can often lead to armatures which do not deform child objects in ways you would want”; manual weight adjustment may be needed. This supports a minimal rig with explicit weight inspection rather than assuming automatic weights solve it. The posing manual separates rest pose from pose transforms. `Pose as Rest Pose` permanently changes rig structure and can require re-binding or adjusting skinning/animations, so it is not the normal operation for generating static pose copies. Blender's pose library allows reusable poses; for assets, saved named actions or reproducible pose data are safer than relying on the session-only copy/paste pose buffer.

Official references: [Armature Deform Parent (5.2)](https://docs.blender.org/manual/en/5.2/animation/armatures/skinning/parenting.html), [Posing introduction](https://docs.blender.org/manual/en/5.2/animation/armatures/posing/introduction.html), [Apply pose / rest pose](https://docs.blender.org/manual/en/5.2/animation/armatures/posing/editing/apply.html), [Pose Library](https://docs.blender.org/manual/en/5.2/animation/armatures/posing/editing/pose_library.html).

The Blender manual describes Auto IK as quick posing with a more limited feature set than IK constraints. This supports evaluating it on actual raised/reaching poses rather than requiring a full IK rig or forbidding IK categorically. [Auto IK tool settings](https://docs.blender.org/manual/en/5.2/animation/armatures/posing/tool_settings.html), [IK introduction](https://docs.blender.org/manual/en/5.2/animation/armatures/posing/bone_constraints/inverse_kinematics/introduction.html).

**glTF/export.** Blender's official glTF exporter lists meshes, materials, and animation including skinning. It exports supported animation forms (including pose bones), but the project should not accept an export merely because a Blender viewport/render looks right: the target is the Three.js renderer and its materials. Source: [Blender 5.2 glTF 2.0 exporter](https://docs.blender.org/manual/en/5.2/addons/scene_gltf2.html).

**Three.js rendering.** `InstancedMesh` is explicitly for many objects sharing geometry and material with different world transforms; per-instance matrices/colors are supported. Thus it is suitable for static copies of each baked pose geometry, grouped by geometry/material, not a blanket promise of animating distinct skeletons as one normal instanced batch. [Three.js InstancedMesh API](https://threejs.org/docs/pages/InstancedMesh.html). Three.js's advanced WebGPU examples demonstrate skinned instancing, but use custom compute skinning/TSL and are not a simple default Three.js crowd recipe; do not adopt this as the prototype's starting point. [official example](https://threejs.org/examples/webgpu_skinning_individual.html).

**Cel-shading.** Blender's Shader-to-RGB manual says the node is used for NPR/toon effects, but “breaks the PBR pipeline” and can make effects unpredictable. This is a useful warning against treating a Blender toon render as runtime fidelity; test the actual target renderer/material route. [Blender 5.2 Shader to RGB](https://docs.blender.org/manual/en/5.2/render/shader_nodes/color/shader_to_rgb.html).

**Existing tool/asset caveat.** VRoid Studio's official guidelines permit commercial use of many user-created/exported models and allow editing, but say items with special license clauses have their own conditions; each specific model's terms still matter. It may be a candidate only if a visual sample proves it fits, and the software's output does not automatically meet this game's art direction. [VRoid Studio Guidelines](https://vroid.com/en/studio/guidelines). Ready Player Me's prior developer licensing docs say commercial use required registered-developer/partner status, but the sources checked here do not establish its current service availability or a shutdown date. Treat availability as unverified; do not base a pipeline decision on it without current first-party confirmation. [historical developer licensing documentation](https://docs.readyplayer.me/ready-player-me/support/terms-of-use).

## Unknowns / decisions still open

1. Exact camera/read distance and crowd scale remain open; the approved composition is side margins receding along the highway, gameplay-first, player-facing. Concept composites are approximate, not camera specifications.
2. Whether the crowd moves and why remains open under `shining-stars-4f4.6`; do not assume either static-only or continuously animated.
3. Whether a specific existing base with known provenance is available is unknown. No asset download or tool install is authorized.
4. Runtime crowd/material/performance evaluation is future work requiring explicit integration authorization. No polygon, texture or performance budget is established.

## Sources

- Blender Manual 5.2 LTS: skinning, armature parenting, posing, pose assets, glTF export, Shader to RGB (linked above).
- Three.js API and official example (linked above).
- VRoid Studio official guidelines and historical Ready Player Me developer licensing documentation (linked above; present-day availability not verified).

Research date: 2026-10-11. External pages are current to retrieval date; verify candidate tool versions and individual asset licenses at selection time.
