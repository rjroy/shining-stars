---
name: asset-workflow
description: Coordinate approved game-asset work from brief and concept approval through Blender modeling, render critique, runtime integration, and separate approvals. Use when creating or integrating a visual asset for Shining Stars.
---

# Asset workflow

The user is the **visual director**, not the artist or operator. The agent owns the brief, concept-art request, modeling, iteration, evidence, and integration work. Ask the user for direction and explicit decisions; do not make them operate Blender or produce the asset. These instructions describe how to execute asset work; they do not themselves authorize it. The current skill-authoring request authorizes documentation only, not concept generation, modeling, integration, or asset creation. For future asset work, obtain task authorization and satisfy each approval gate below.

## Approval gates — never collapse or infer them

1. **Description approval.** Write a concise asset brief and obtain explicit approval of its purpose, silhouette, style, gameplay/readability needs, and constraints. A general request to make an asset is not approval of a proposed description.
2. **Concept art.** After the brief is approved, use the `concept-art` skill to request a concept. Keep the actual generated image and record its path. Present it for review; do not proceed to modeling until the user explicitly approves that concept.
3. **Model and critique loop.** Use the available `blender-model` and `blender-visualize` skills/tools. The agent creates and edits the Blender model, renders it, compares the render against the approved concept, critiques discrepancies, and iterates. Bring focused evidence/questions to the user; do not ask the user to model or run the loop. Avoid toy-like primitive substitutes. If the asset cannot be convincingly modeled, explain the limitation and ask for direction rather than silently substituting primitives. Iterate in bounded batches: after repeated iterations with no material improvement, pause, show the evidence and remaining gap, and ask for direction instead of continuing a costly loop. Continue until evidence shows the model matches the approved concept to an acceptable degree, then request explicit **model approval** against that evidence. Approval of concept is not approval of the model.
4. **Runtime integration.** Only after model approval, integrate the approved export into the runtime. Keep the editable source and build/export process reproducible. Present runtime evidence and request separate explicit **integration approval**. Neither prior approval implies this one.

If approval is withheld or requested changes, return to the relevant earlier gate. Reset approvals proportionally: a material change to the brief requires renewed description approval and a new/reviewed concept; a material concept change requires renewed concept approval before modeling resumes. Minor changes that do not alter approved intent need not restart unrelated gates; record the rationale and version. Preserve prior approved versions; never treat silence, a render, or a broad initial request as approval.

## Handoff contract

For every asset, keep a brief and a versioned, discoverable handoff together (choose a project-appropriate asset directory; do not assume a path not established by the task). Include:

- approved brief and concept image path(s), with approval evidence (who/when/what version); distinguish approved from superseded material;
- editable `.blend` authoring source, version identifier, and ownership/provenance: creator/source, license or permission, and any third-party inputs; distinguish it from derived exports and previews;
- build/regeneration script or exact repeatable steps, tool/version requirements, and export settings;
- preview renders used for concept comparison, model approval, and final runtime review;
- runtime export(s), target format, and the scene/object/material names and import/use notes needed by integration;
- relevant performance budget and measurements, coordinate system/units/scale, material and lighting assumptions, collision only if needed, and animation only if selected for this asset;
- approval evidence separately for the description, concept, model, and integration.

Do not invent approved polygon, texture, draw-call, memory, or other performance budgets. If a constraint or value is unknown, label it unknown and request a decision or establish a measured proposal for approval. Keep the source, scripts, previews, and export tied to the same version; explain how to regenerate the export and identify its source version. Before producing or checking in large source/export files, agree a storage and delivery approach with the user; do not silently commit oversized binaries or replace editable source with exports.

## Project visual context

Read [Brightvale asset context](references/brightvale-asset-context.md) before writing a brief for this game. It records project-specific approved direction and supersession; it does not approve an individual asset.
