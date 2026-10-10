---
name: blender-model
description: Build or revise an editable Blender asset and reproducible Blender Python scripts from an approved project brief or concept. Use only after the asset workflow authorizes modeling.
---

# Blender model craft

Read [the shared asset workflow](../asset-workflow/SKILL.md) first. It owns the brief, approvals, iteration loop, provenance, export, and runtime acceptance. This skill owns construction and revision of the native Blender model. Skill-writing permission is not permission to generate concepts, models, renders, or runtime assets.

## Gate and inputs

- Start only when the shared workflow records explicit modeling authorization and names the approved brief/concept, output location, and scope. A mood image or broad project direction is not authorization.
- Read the approved source and project-specific references. Keep reusable craft guidance here; do not treat Brightvale direction as universal style.
- For Brightvale's perspective-highway work, use the current amendment: no stage, performer, or replacement focal structure; retain city and crowd, subordinate to the highway. Earlier stage/performer text is superseded. Mockups are mood/composition references, not exact geometry or ground truth.
- Make an input manifest: absolute paths to brief, approved concept(s), reference files, existing `.blend` if revising, target output directory, expected consumers, and Blender version. State uncertainties; do not invent unseen reference details. Ask the workflow owner to resolve material ambiguity rather than silently promoting a guess to fact.
- Model only approved scope. Seek approval before adding a new focal feature, changing silhouette/material direction, or broadening asset count. Do not silently change runtime behavior or claim an asset is approved.

## Build for shape, not a pile of primitives

Plan from the asset's read at game distance: dominant silhouette, proportion landmarks, negative spaces, and distinct primary/secondary/tertiary forms. Check front, side, back, top, and intended game camera before detailing. Block out volume, compare to approved evidence, then refine.

- Build coherent forms with deliberate mesh flow and topology where silhouette or deformation warrants it. Use curves for cables, wind ribbons, pipes, and other continuous paths; use bevel profiles, controlled endpoints, and clean joins rather than rows of disconnected cylinders. Use bevels, weighted normals, subdivision, and supporting loops selectively, with applied/non-applied modifier choices documented for the target pipeline.
- Primitive meshes are valid starting stock, not a finished design language. Avoid the “person is two cylinders” and Tonka-toy look: do not assemble a character or designed object from uniform, disconnected, blunt primitives. Shape transitions, taper, joint placement, overlap, contour, and part scale intentionally. Join or intersect forms cleanly where the design calls for a unified mass; preserve separation only where it reads as a real designed component.
- Inspect topology, normals, smoothing boundaries, non-manifold/open edges where inappropriate, self-intersections, thin surfaces, and shading artifacts. Prefer clean, economical geometry; do not add hidden detail that costs runtime without improving the intended view.
- Establish a material hierarchy with restrained, authored roughness/metallic/emission values and legible value contrast. Avoid relying on color alone for gameplay meaning. Use procedural materials only when reproducible and export-compatible requirements are clear; keep node graphs understandable. Do not assume Blender shader nodes map identically to glTF or Three.js.
- Keep names, collections, origins, scale, transforms, and units intentional. Use descriptive object/material names; separate logical parts for future editing, not every incidental face. Set a useful origin and consistent forward/up orientation for the consumer.

## Editable source and reproducibility

- Deliver an editable `.blend` plus the Blender Python script(s) that create or revise it. Scripts are the reproducible source of truth for generated geometry/materials; save them beside the asset in a clearly named `scripts/` subdirectory. Include Blender version, invocation, inputs, outputs, and any manual steps in a short handoff note.
- Prefer deterministic scripts: fixed names, explicit settings, stable object/material creation, no random values unless seeded, no reliance on current selection or UI state, and no external downloads. Do not add dependencies or use third-party 3D generators.
- If manual sculpting/editing is necessary, preserve the script-built base and record exactly which edits are manual and what is not reproducible. Do not claim full reproducibility if manual edits are material to the result.
- Never overwrite the approved/current source during a revision. Save a versioned new `.blend` and script (or a new revision directory), retain the prior version, and record changes against the approved scope. Use absolute paths in commands and handoff.
- Before handing off, reopen the saved file in background mode (or otherwise verify it loads), confirm expected objects/materials and bounds, and record process exit status. Do not fabricate a successful result after exceptions or timeouts.

## Export and consumer handoff

- Keep `.blend` as the editable authority. Export GLB/glTF only when the workflow requests it for runtime evaluation or delivery. For glTF, inspect Blender's installed exporter options rather than guessing flags; use explicit selection, apply-modifier, material, and transform settings suited to the consumer.
- glTF uses a different coordinate convention from Blender; verify orientation, scale, origin, and normals after export in the intended consumer. Check supported material features, textures, transparency, and emissive behavior. An attractive Blender render does not prove equivalent Three.js appearance; Cycles is not Three.js.
- Report absolute paths for source blend, deterministic scripts, requested exports, validation logs, and reference/input files. Include dimensions/bounds, object count at a useful level, Blender version, export settings, unresolved assumptions, known shading/export differences, and whether this is awaiting visual or runtime approval.
- Model approval is an explicit workflow gate. No runtime integration or claim of accepted asset until the user/workflow records that approval.

## Safe execution and recovery

Use Blender background Python for scripted work, with a bounded timeout appropriate to the operation. Capture stdout/stderr and the actual exit code. On timeout or failure, report it, preserve partial outputs for diagnosis, and inspect paths before cleanup. Clean up only the specific temporary files/process you started; never use blanket process-kill commands. Retry only after diagnosing the cause. Do not mistake an existing or partial output file for success.

### Dry walkthrough before execution

Before running a model script, verify the authorization and all absolute input/output paths; explain what it will read/write; confirm it writes a new revision and cannot replace the source; confirm deterministic settings and no unapproved asset generation; identify expected checks and timeout/recovery. If any check fails, stop and request the workflow owner/user decision.
