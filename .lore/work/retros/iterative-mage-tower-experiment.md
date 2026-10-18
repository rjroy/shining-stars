---
title: Iterative mage tower modeling experiment
date: 2026-10-17
status: completed
tags: [blender, modeling, visual-fidelity, iterative-refinement, asset-workflow, reproducibility, scope-communication]
related: [.lore/work/research/ai-blender-workflows.md]
---

# Iterative mage tower modeling experiment

## Result and user assessment

The user described the earlier models as **C+** and this tower as **A−**: “its not perfect but damn its close.” The user subsequently asked to record the first experiment's success before continuing with the distant-city experiment, so that both results are available when revising the asset process. This records acceptance of the experiment's outcome, not authorization for production derivatives or game integration.

The delivered model is [`candidate.blend`](../../../assets/experiments/weathered-mage-tower/candidate.blend), SHA-256 `66d21e827bc8790198565569749576918db0414ad6899c268f408e787750de70`. The [final actual Blender render](../../../assets/experiments/weathered-mage-tower/previews/reference-beauty.png), [approved concept](../../../assets/experiments/weathered-mage-tower/concept-candidate.png), and [package record](../../../assets/experiments/weathered-mage-tower/README.md) preserve the visual comparison and construction history.

## Authorized change to the process

The subject was one weathered, inhabited, 30-foot mage's tower, with a projecting timber observatory, irregular slate roof, chimney, damaged plaster, exposed rafters, and repaired supports. The concept was explicitly approved before modeling.

For this experiment the user authorized the editable Blender scene as the primary artifact. A full-scene regeneration script was not required. Local scripts and incremental edits were permitted, with visual inspection and checkpoints. Browser optimization and runtime integration were excluded. The user authorized continued work and refinement without intermediate approvals while away overnight.

The shared asset skills still contained generator/reproducibility requirements. The modeler received an explicit task-specific exception rather than a silent change to those skills.

## What actually happened

No live Blender interaction tool was exposed. The modeler used Blender 5.2.1 background Python operations that opened and edited saved scenes. This was not mouse-driven modeling, nor a single generated script inspected only after completion. Form study, construction, material refinement, and defect correction were separated by actual rendered-image inspection. Saved checkpoints and operation scripts remain in the package; no clean end-to-end regeneration guarantee was made.

A designer independently compared the model renders with the concept. The review identified the roof transition, regular stone/timber construction, uniform surface noise, heavy finial, and cloudy glazing. A bounded refinement improved plaster, wear, finial, and glazing but introduced pinched/fanned slates around a more continuous canopy transition. A second visual review identified that regression. The final bounded correction restored the earlier canopy while retaining the other improvements. Construction then stopped with the roof junction, wall rippling, and residual regularity explicitly reported.

The final file was reopened and measured at **9.144 m total height**, including the finial. The package records 1,130,936 evaluated triangles, six inspected final views, and checks for finite geometry, structural expectations, and external dependencies. It also records the limits of those checks: overlapping construction components are deliberate, and passing geometry checks is not proof of reference fidelity or runtime suitability.

The user rated the result after seeing the final render and its stated limitations. No production export, runtime integration, or commit was performed as part of the modeling experiment.

## Scope discussion that followed

The user attributed the earlier shortfall to treating scripts as the product and failing to divide a larger scene into parts the agents would actually implement. The user also objected to undisclosed decisions about what not to build. Inspection of the earlier distant-city README subsequently found explicit exclusions of waterfalls and foliage, both visible in the city concept.

The user approved a new city breakdown preserving the complete visual target: citadel; left/right districts; receding skyline; terraced cliffs and retaining walls; connected bridges; watercourses and waterfalls; vegetation; and shared Audience/Twilight lighting and atmosphere. Smaller concept pieces are to clarify connected assemblies, not replace the full target with a simpler design. The next proposed artifact is a composition map, followed by contextual component concepts.

## Boundaries of this record

There was no matched comparison between this tower and an alternative mandatory-regeneration implementation. The tower and the earlier city differ in scale and complexity. The user's quality assessment and stated diagnosis are recorded as such; this experiment does not isolate a single causal variable or establish that live GUI interaction outperforms scripting.

The editable model remained the primary artifact despite continued use of Python. The current shared skills have not yet been revised. The user intends to revisit the process after the city experiment, using this record alongside that outcome.
