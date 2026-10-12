---
name: asset-production
description: Produce and validate reproducible runtime-ready derivatives from explicitly authorized, approved Blender assets. Use for post-model asset production before game integration; this skill does not authorize asset work.
---

# Asset production

Read [the shared asset workflow](../asset-workflow/SKILL.md) and its approval history first. This skill covers the bounded production step between model acceptance and runtime integration: inspect the approved source, make a separate reproducible derivative, and hand it off. It does not authorize production, exports, validation harnesses, game/runtime edits, or integration. Get explicit production scope, output location, expected consumer/view, and validation authority before starting. A bounded pilot authorization may include its disposable validation checks; do not require redundant permission for each mechanical check. Runtime integration and game changes remain separately authorized and approved.

## Preserve and inventory

- Keep the approved `.blend` and its original authoring/generator scripts immutable. Load the detailed model and use Blender operations on a derived copy for reduction, UV work, or baking as appropriate. A separate production script may automate those operations; do not regenerate simpler architecture or characters by changing or rerunning a lower-detail variant of the original generator. Write derived files only to the approved output location. Never silently replace source or substitute a different asset.
- Record source identity/revision, provenance, Blender and tool versions, consumer/library version, reproducible steps, assumptions, and output status in the maintained package's short README or handoff. Pin versions when executing; inspect installed exporter options rather than guessing version-sensitive commands.
- Inventory objects and transforms, material roles, UVs/textures and color/channel meaning, and any skins, joints, or animation relevant to the consumer. Record expected camera, actual screen sizes, population/repetition, Audience and Twilight appearance, and unknown device/performance targets. Ask only for decisions that block the authorized scope; mark other unknowns for the handoff.
- Judge detail at intended screen size and preserve landmark/city skyline silhouette and modular joins. Geometry reduction, normal/AO/base/emissive textures, LOD, and compression are optional: use only when a measured screen-space or delivery benefit justifies them. Do not invent budgets. Normal maps add shading detail, not silhouette; AO can double-darken or become stale; avoid baking fixed lighting into shared base maps. Keep neutral/shared appearance useful under warm Audience and violet Twilight modes; reserve emissive maps for intended self-lit accents.

## Crowd and visual boundary

The production goal is a reduced runtime crowd, not exporting the detailed source crowd unchanged or postponing reduction. At actual on-screen size and intended density, build readable silhouette, pose, and color blocks; detailed faces/anatomy are unnecessary when they do not resolve. Preserve the editable rig and approved character source. Decide from required motion whether the derivative is static posed clusters/mesh instances or retains skeletal animation; verify the chosen path in the actual consumer. Partial occlusion is acceptable, complete hiding is not. Do not create a performer/avatar or silently substitute a different crowd design.

glTF does not carry arbitrary Blender node graphs or make a custom toon look automatic. Verify what the actual consumer loader imports for materials, textures, transforms, skins, and animation. Any custom Three.js shader/material behavior is runtime work outside this skill. Compare source and derived output in the consumer's real camera and render configuration when authorized; disclose camera, color-management, and tone-mapping differences (the project research notes Blender AgX versus Three.js ACES Filmic). A Blender beauty render alone is not runtime proof.

## Bounded production and handoff

1. Start with the approved endcap pair as a minimal transfer/material proof. It does not establish city or crowd performance. Next test a representative city slice with landmark silhouette, material regions, and a repeatable modular element. Optimize and validate a representative reduced crowd as its own population/motion case.
2. Change one optional production choice at a time. Compare against the unchanged source in the intended view; record what changed, why, and measured evidence. Inspect the exported artifact and actual consumer-loader behavior, including warnings and missing/unsupported material behavior.
3. Report browser evidence truthfully: transfer bytes, decoded geometry/texture data, load/decode and frame timing, and renderer counters such as draw calls. Renderer counts are not GPU-memory measurements; do not claim GPU bytes unless directly measured with a stated method. Compare on target devices when known; otherwise identify the limitation, and do not invent pass/fail thresholds.
4. Deliver a lean maintained package: current derived artifact, reproducible process, concise report, and selected evidence. Keep historical candidates, hash dumps, duplicate logs, and scratch directories out of the package; retain only useful approval evidence and provenance. State open decisions and consumer caveats.

## Approval and routing

Preserve the workflow's description, concept, model, and runtime-acceptance gates. After model acceptance, production derivation needs its own review before promotion; do not infer approval from the production authorization or a successful check. Route visual direction to the designer; routine structured production geometry to Sol; complex character/city work to Astra or escalate from Sol. Fixer may do mechanical packaging or runtime work only under the correct authorization, not visual/anatomical production. If an authorized change would redesign geometry/material direction, route it through the existing asset approval gates rather than treating it as routine optimization. Never silently substitute an agent or broaden scope.

See the [production research memo](../../../.lore/work/research/blender-threejs-production-sources.md) for source citations and deeper technical findings; verify rolling documentation and installed versions before relying on version-specific behavior.
