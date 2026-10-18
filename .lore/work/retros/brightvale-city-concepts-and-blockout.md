---
title: Brightvale city concepts and blockout experiment
date: 2026-10-17
status: completed
tags: [brightvale, blender, blockout, visual-fidelity, iterative-refinement, asset-workflow, scope-communication, image-generation]
related: [.lore/work/retros/iterative-mage-tower-experiment.md]
---

# Brightvale city concepts and blockout experiment

## Result and user assessment

After reviewing the actual current blockout comparison, the user said: **“I'm happy with this. It's a vast improvement from the blockout of the previous ... and the real step we missed ... detailing is up next. Can you add some notes of our process so far here before we move on to detailing. It's working well, it is expensive (lots of Astra) but the quality is undeniable.”** This is acceptance of the current blockout as a strong improvement and a starting point for the next detailing step. It is the user's visual judgment, not an independently measured score or a claim that every reference detail is matched.

The approved artifact is [the current blockout scene](../../../assets/experiments/brightvale-city/blockout/candidate.blend), SHA-256 `2fdd01e2dda3be91a8651269f5a62a920a27ec1c8b087189c95d60978684b5ad`. Compare the [original-pixel layout comparison](../../../assets/experiments/brightvale-city/blockout/previews/layout-reference-comparison.png), [50/50 overlay](../../../assets/experiments/brightvale-city/blockout/previews/reference-overlay.png), [Audience](../../../assets/experiments/brightvale-city/blockout/previews/reference-audience.png), and [Twilight](../../../assets/experiments/brightvale-city/blockout/previews/reference-twilight.png). The [blockout record](../../../assets/experiments/brightvale-city/blockout/README.md) and [city package README](../../../assets/experiments/brightvale-city/README.md) preserve its construction and approval context. User acceptance does not assert runtime suitability, production approval, or authorization beyond the requested next detailing step.

## Scope and concept decisions

The prior city baseline silently excluded water and foliage despite both being visible in the source. That was a scope reduction, not a user decision. The user subsequently approved a complete eight-component decomposition: (1) spired citadel, (2) paired flanking districts, (3) receding skyline, (4) terraced cliffs and retaining walls, (5) arched bridges, (6) waterfalls and watercourses, (7) vegetation, and (8) shared lighting/atmosphere. The [composition map](../../../assets/experiments/brightvale-city/composition-map.png) records observed placement; the [brief](../../../assets/experiments/brightvale-city/brief.md) defines the connected packages and their interfaces. The breakdown clarifies a connected whole rather than licensing omissions.

Concepts were generated and approved as distinct references: citadel; ravine crossing; paired districts; corrected skyline strips; supplemental water/vegetation; and a lighting-only pair. Their authority is not interchangeable. The whole-city reference and composition map govern composition; the large-left citadel panel, upper ravine panel, paired district concept, corrected skyline strips, and water/vegetation sheet govern their respective content as described in the blockout's [approval hierarchy](../../../assets/experiments/brightvale-city/blockout/README.md#approvalprovenance-hierarchy). The lighting comparison governs lighting direction only, not architecture or foliage. Generator drift occurred: contextual imagery could introduce design changes, and the first skyline sheet missed the intended subordinate connected vocabulary. That first skyline miss was rejected and corrected; it was not accepted as the authority. Earlier landmark authority and original composition placement prevailed over generated contextual drift.

The separately approved concepts reduced ambiguity but did not by themselves constitute the assembled city. The composition map was an intermediate anchor; subsequent component concepts and the complete blockout provided later, distinct review points.

## Modeling and review process

The editable `.blend` was the primary artifact. A full-scene generator was waived; the workflow used incremental Blender background-script edits, saved checkpoints, renders, and review. There was no live GUI modeling session. The work was not constrained by runtime budgets, a game camera, export requirements, or other runtime acceptance conditions. Those were outside this blockout task, not demonstrated as satisfied.

The full-city blockout established all eight packages, then went through designer critique and focused massing corrections. A later camera/layout pass addressed the cleft that remained after the massing pass. Initial generated skyline placement was inadequate and subsequently corrected. The review loop returned to actual renders and the reference rather than treating a successful geometry checklist as proof of a visual match.

Frozen-camera and frozen-bridge constraints in the earlier massing pass were implementation choices for that bounded pass, not user requirements for fidelity. They were relaxed when the separately authorized layout/camera correction needed to match the reference composition; the bridge layout moved with the city. The README's earlier checklist and review observations remain useful history, but do not override the user's present acceptance of the exact final candidate.

Construction validation checked saved-file reopening, package presence, finite/closed stock, retained lighting worlds, bridge interfaces, water direction, framing, and other structural properties. Such tests answer whether the scene is structurally coherent under those checks; they do not establish visual similarity. Conversely, a reviewer noting a visual gap is not automatically a failed structural check. The designer had recorded residual hero-arch background occlusion, skyline density, and shallow foundations. These were findings, not vetoes: the user now accepts this candidate as a vast improvement and a sound starting point for detail. The blockout remains a blockout; detailed modeling has **not** yet been performed.

The user reports that this process is expensive, involving “lots of Astra,” and that its quality is undeniable. No token count, dollar cost, elapsed time, causal attribution, or controlled comparison with an alternative workflow was measured here. There was no controlled baseline comparison; “vast improvement” is the user's direct comparative assessment.

## Boundaries and next step

The user's request is to record this process before moving on to detailing. This retrospective records that acceptance and identifies detailing as the next step; it does not authorize broad execution beyond that next step, or runtime work. No runtime approval is recorded. Shared skills have not been changed. No production derivatives, installs, commits, or pushes are part of this record.

The approved references, comparison, model, and package record are linked above. The previous [mage tower retrospective](iterative-mage-tower-experiment.md) records the earlier asset-workflow experiment. These two experiments are observations, not controlled proof that one workflow is universally superior.
