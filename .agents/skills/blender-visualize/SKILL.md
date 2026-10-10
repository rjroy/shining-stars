---
name: blender-visualize
description: Render and inspect an authorized, saved Blender project for an agent's visual critique without modifying the source model.
---

# Blender visualization and inspection

Read [the shared asset workflow](../asset-workflow/SKILL.md) first. It owns the brief, approvals, iteration loop, provenance, export, and runtime acceptance. This skill renders an existing saved `.blend` for inspection; it does not build or revise the model, silently change its source, or approve it. Skill-writing permission is not permission to generate images or renders.

## Gate and inputs

- Render only when the asset workflow authorizes visualization and identifies the saved `.blend`, approved brief/concept, intended game view, required diagnostic angles, output directory, and review purpose.
- Use an absolute path to the exact saved `.blend`; record its modification time or checksum before rendering. Read-only source handling is mandatory. Do not save, pack, relink, alter materials/geometry/cameras, or resave the source as a side effect.
- Ask the workflow owner to resolve missing camera, lens, scale, or composition requirements. References are evidence with ambiguity, not imaginary ground truth. Keep project art direction separate from reusable visualization practice.
- Brightvale perspective-highway context, when applicable: low fixed dramatic view, highway dominant, city and crowd subordinate; no stage, performer, or replacement focal structure. Preserve the perpetual-twilight warm Audience / violet-dark Twilight distinction. Earlier stage/performer directions are superseded; do not add them to a render setup.

## Render set: game view plus diagnostics

Produce the requested game-view render using the approved camera/composition and the saved scene's intended game lighting. Do not “beautify” by changing the asset or concealing failures. Record renderer, engine, resolution, frame, color management, camera, and lighting. If no intended game camera or lighting exists, report that blocker or ask before creating a temporary render setup; never save such setup into the source blend.

When authorized, render diagnostic views as separate images, clearly labeled and not presented as gameplay truth:

1. Front/three-quarter silhouette view and side/back as useful for proportion and construction.
2. Neutral material/shape view with simple, even lighting to expose silhouette, intersections, normals, and roughness without dramatic light hiding defects.
3. Wireframe/topology or orthographic views only where needed to diagnose a specific issue.

Use a temporary copy or a separate script-generated scene state for diagnostics, leaving the source untouched. Do not overwrite the game-view image with a diagnostic render. Game and diagnostic lighting answer different questions; label them distinctly. Blender viewport/rendered lighting and Cycles/Eevee output do not promise the same appearance as the Three.js runtime renderer.

Camera and render checks:

- Verify the intended asset is in frame, not clipped or obscured; confirm projection (perspective/orthographic), lens, aspect ratio, framing, and visible side match the approved view. Camera changes are render setup, not model approval.
- Check whether emission, transparency, shadows, tone mapping, color management, and reflections exaggerate or hide shape. State renderer differences; do not infer runtime material fidelity from a Blender image.
- Use the smallest resolution and sample count that make the requested inspection meaningful; do not add render dependencies or change system settings. Render only the authorized views.

## Safe, read-only execution

- Inspect installed Blender version/help before relying on command syntax. Blender arguments are order-sensitive: put render options after the file they apply to, e.g. `blender --background /absolute/source.blend --render-output /absolute/output/game-#### --render-format PNG --use-extension 1 --render-frame 1`. This writes `game-0001.png`; Blender appends frame numbers even when the output path has no `#`. For a temporary, read-only render script, use `blender --background /absolute/source.blend --python-exit-code 1 --python /absolute/script.py`, placing the exception exit-code setting before script execution. Confirm exact invocation for the installed version and the script's output behavior before running.
- Give each process a bounded timeout. Capture stdout/stderr, exit code, and expected output paths. A nonzero exit, timeout, missing image, or empty/partial output is a failure, not a successful render. Check file existence and size, then decode/open the image with available local means and visually inspect it; do not assume a file extension proves valid image data. If the agent cannot view/decode it, report that limitation rather than claiming inspection.
- Check the source file's checksum/modification time before and after. If it changed, stop and report the unexpected mutation; do not silently restore or overwrite it.
- On failure, preserve logs and partial output for diagnosis; inspect exact temporary paths before cleanup. Stop only the specific process started by this task when necessary; never blanket-kill Blender or other processes. Retry only after identifying a safe correction.

## Critique and handoff

The agent owns inspection and critique; the user is the visual director, not expected to perform artist labor. Compare against the approved brief/concept and distinguish observed evidence from uncertain inference. Report concrete issues by view, such as silhouette read, proportion, overlap, topology/shading artifact, material hierarchy, visibility, or framing. Propose the smallest revision within approved scope; ask before expanding scope or making a direction-changing judgment. A render is evidence for review, not approval.

Return absolute paths to source blend, scripts used (if any), game-view and diagnostic images, logs, and brief/concept. Record Blender version, command, renderer/engine, camera, lighting, resolution, exit code, decode/view verification, source before/after check, and any limitations. Never claim source-model approval or runtime acceptance; the workflow requires explicit approval before runtime integration.

### Dry walkthrough before execution

Verify authorization, source path and unchanged-source plan, approved camera/views, output paths, Blender syntax, timeout, expected image files, decode/view check, source integrity check, and cleanup scope. State exactly which images will be produced and what they will assess. If a required camera/view or approval is missing, stop and ask; do not render a substitute or create assets.
