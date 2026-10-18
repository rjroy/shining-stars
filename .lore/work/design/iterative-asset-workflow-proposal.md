---
title: Iterative asset workflow proposal
date: 2026-10-17
status: draft
tags: [asset-workflow, blender, reproducibility, visual-review, scope-management, iteration]
related: [.lore/work/retros/iterative-mage-tower-experiment.md, .lore/work/retros/brightvale-city-concepts-and-blockout.md, .lore/work/retros/brightvale-city-detailing-experiment.md]
---

# Iterative asset workflow proposal

## Purpose and evidence boundary

This is an analytical proposal based on two different experiments, not a report of policy already changed. The mage tower and Brightvale city both used an editable `.blend` as the product, iterative saved-scene edits, renders, and checkpoints. The tower received an A− user rating versus C+ for an earlier attempt; the user called the city blockout a vast improvement and described the quality as undeniable while noting high Astra use. Those judgments are not controlled comparisons. No costs, token totals, elapsed time, or isolated causal factors were measured. The city is far larger and structurally different from the tower.

## Proposed changes to shared asset skills

Apply these changes only through a separate authorized skill-maintenance task; this proposal itself changes no shared configuration.

### 1. Make the native source the explicit product choice

In `asset-workflow` §3 and `blender-model` “Editable source and reproducibility,” allow an authorized task to designate the editable `.blend` as the primary deliverable without requiring a complete deterministic generator. Keep source identity, provenance, operation history/checkpoints, reopen validation, and genuinely reusable inspection/validation utilities. Describe scripts as optional construction aids when regeneration is not the task's contract. Do not call an incremental operation record a generator or claim reproducibility that was not tested. The current skills' source integrity, saved-file verification, and honest reproducibility reporting remain useful and should stay.

### 2. Add scope coverage and explicit change control

In `asset-workflow` context/approval and handoff clauses, require coverage of the complete approved brief—including visible secondary or contextual families—and record excluded scope as an explicit user decision, not an agent convenience. For multi-part scenes, identify connected assemblies, owners, interfaces, and reference authority. Distinguish accepted source/version from a later candidate; approval of a stage does not imply approval of future scope. Retain the existing separate description, concept, model, derivative, integration, and runtime gates.

### 3. Add composition/blockout gates for large scenes

In `blender-model` “Build for shape,” recommend a composition map and full-scene blockout review before detail when the task contains multiple connected assemblies. Use component concepts to clarify owned assemblies and interfaces, not to replace the complete composition. Record which source view/panel governs which property; a lighting-only study grants no architectural authority. The existing multi-view/intended-camera-before-detail clause and ambiguity escalation remain appropriate.

### 4. Define bounded iterative work on accepted scene state

In `asset-workflow` §3 and `blender-model` source protection, describe refinement as a bounded sequence based on the latest accepted aggregate, with named ownership and protected areas. Permit small, explicit interface exceptions where a visible defect crosses an ownership boundary; record affected objects, evidence, and resulting caveats. Protection is a guardrail, not a reason to leave a visible conflict unreported. Keep the current requirements to preserve prior approved sources and avoid unapproved scope changes.

### 5. Bound review and use judgment at the right stopping point

In `asset-workflow` §3 and `blender-visualize` critique/handoff, make independent critique useful but bounded: consolidate concrete issues by view and severity, separate visual direction from structural checks, and stop when the authorized target is accepted or remaining changes are subjective/perfection-seeking without material benefit. Present remaining caveats for the user's judgment rather than treating every designer observation as an automatic veto or entering repeated generic review loops. Keep actual native renders, neutral/diagnostic views, source-hash checks, and the rule that renders/checks are evidence rather than approval.

### 6. Clarify visual evidence and downstream gates

In `blender-visualize`, explicitly distinguish a true render of the saved geometry from generated/reference imagery and neutral diagnostics from audience presentation. The current skill already requires actual-geometry previews, read-only source protection, decode/inspection, and no approval inference; retain these. In `asset-production`, preserve the existing separation of source, derivative, consumer validation, and runtime acceptance. Defer performance optimization until visual/model acceptance and then authorize it as a separate, measured task; do not invent budgets or imply that native-scene checks establish runtime readiness.

## Cost and unresolved process questions

### Acceptance-time consolidation

The user agreed that cleanup should be an explicit completion step. Keep the approved editable master and required dependencies, approved concepts, a small set of final renders, a concise README, genuinely reusable tools, and selected process evidence. Duplicate full-scene checkpoints, superseded renders/comparisons, temporary logs, one-off operation scripts and repetitive validation reports are deletion candidates, not automatic deletions. Present a keep/delete inventory, check dependencies and document links, and verify that the consolidated package independently opens and renders before removing working history. Manage bounded scratch during work as well as at acceptance. Preserve the result and useful evidence, not every execution artifact.

For this city, the user intends to replace the current distant city with the approved experiment result. `assets/experiments/brightvale-city/finishing/model/candidate.blend` is a protected master, not cleanup material. Consolidation must preserve it and its dependencies. Production preparation and actual-consumer acceptance remain separate from cleanup; neither cleanup nor runtime replacement has been performed.

### Cost evidence

The user reported high Astra use. Proposed cost controls are bounded review batches, concise consolidated critique, reusing a live work context where practical, and avoiding repeated open-ended review cycles. Do not equate cheaper with better, invent token/dollar targets, or impose a budget absent user direction. These experiments did not measure cost, compare live GUI work against background scripting, test a generator-vs-incremental workflow under matched conditions, or validate the city in a runtime. Future process evaluation should capture actual usage/cost if available and compare clearly scoped alternatives before claiming a general efficiency result.

## Decisions still needed before adoption

This document proposes direction, not final skill wording. A skill-maintenance task should decide exact clause edits and compatibility with other asset classes. Until then, current shared skills remain unchanged and their normal requirements continue to apply unless a task receives a specific authorized exception.
