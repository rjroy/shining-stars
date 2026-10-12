---
title: Brightvale runtime asset integration
date: 2026-10-12
status: approved
tags: [brightvale, threejs, assets, architecture]
related: [.lore/work/design/brightvale-perspective-highway.md, .lore/work/design/threejs-gameplay-renderer.md, .lore/work/research/blender-threejs-production-sources.md]
---

# Brightvale runtime asset integration

## Decision

Use a **Brightvale-specific asset bundle loader and scene-owned composition**, with a canonical playfield projection. Replace the incompatible procedural composition rather than inserting GLBs into its existing independent camera layers. These are ordinary modules, not independently scheduled systems or a general asset-management framework.

This design under `shining-stars-4f4.5` was approved for implementation planning when the user selected “Desktop first” on 2026-10-12. It is not implementation authorization. The user accepted the combined production browser appearance at `0a38b74`. That establishes a visual baseline, not gameplay alignment or target-device performance. Sources and their generators remain immutable; derived asset ownership follows `asset-production`.

| Option | Decision |
| --- | --- |
| Insert GLBs into the existing procedural scene | Reject: retains duplicate scenery and incompatible camera/coordinate authorities. |
| Feature-owned loader, composition, appearance and projection | Choose: explicit resource and gameplay boundaries with a small scope. |
| Global asset registry/cache/reference-counting system | Defer: no demonstrated multi-scene sharing requirement. |

## Existing evidence and invariants

- `src/scene.ts` owns one WebGL renderer, tracked resources, four render passes and `createBrightvaleScene(...): BrightvaleScene | null`. Its world city camera is 36 degrees, runway camera 60 degrees, with separate orthographic stage/overlay cameras.
- `src/main.ts` owns scene generations, playback/input gating, renderer recovery, audio lifecycle and the application RAF. Today a returning `updateFrame` call can unlock readiness; a future loading no-op must not count as a rendered frame.
- `src/gameplay-frame.ts`, `src/note-projection.ts` and `src/scene-state.ts` expose pure gameplay/visual frames. The controller owns the clock and scoring. Approach duration is 2.4 seconds; keyboard input is lane-index input.
- `assets/production/brightvale-structure-layout.json` and the combined review contain the authoritative model transforms/camera/ground surfaces. The reviewed camera is 39.76070473 degrees vertical FOV at 1600×900, with a shared 14-degree playfield tilt.
- Existing scene, renderer-lifecycle, note-projection, timing-window, perspective and aspect tests supply regression seams. Tests asserting the old four-pass mechanism will change; their semantic guarantees must survive.

Preserve **one renderer, context, application RAF and controller-owned clock**. No second animation loop, DOM gameplay fallback, visible performer/avatar or new stage. Mode changes continue the same song without loading. Renderer recovery never automatically resumes playback. The later perspective direction supersedes the historical orthographic restriction.

## Module boundaries

Names below are proposed responsibilities, not a demand for a new framework or one class per row.

| Boundary | Owns |
| --- | --- |
| `scene.ts` facade | Renderer/context, scene lifecycle, resize, rendering, failure notification. |
| Brightvale asset loader | Fetch/decode seven GLBs, semantic validation, imported resources and cancellation cleanup. |
| Brightvale composition | Asset placement, exact ground geometry, static crowd placement, repeated-geometry batches. |
| Brightvale appearance | Shared toon material mapping, emission, Audience/Twilight lighting and state-driven updates. |
| Playfield projection | Lane/path contract, surface clearance, camera framing and projected anchors. |
| Gameplay visuals | Pooled notes/timing envelopes/hit feedback and screen-space labels. |

Representative contracts: `loadBrightvaleAssets(signal): Promise<BrightvaleAssets>` returns named asset roots and idempotent disposal; `createBrightvaleComposition(assets, layout)` borrows imported geometry and owns generated resources; `createPlayfieldProjection(contract, camera, viewport)` supplies lane-progress points and projected label/hit anchors.

## Loading and readiness

Keep a **synchronous scene shell** so `main.ts` can immediately destroy it even before loading resolves. Retain the factory's null/failure behavior and injected renderer seam. Add an injected loader seam for deterministic lifecycle tests, not a general dependency container.

Change `updateFrame({ city, gameplay })` to return `'loading' | 'rendered' | 'suspended' | 'unavailable'`. No additional public readiness promise is required. The existing application RAF remains the render driver. `suspended` means a temporarily unusable viewport, not a failed renderer or bundle.

Lifecycle: `loading → assembled → rendered/ready`; viewport loss can suspend a live scene and restoration returns it to loading or rendering according to bundle state. Failure leads to `unavailable`; any live state can become `destroyed`.

- Loading displays a distinct “Loading Brightvale…” state and blocks play/resume/restart/gameplay input. Audio status remains separate.
- Assembled means all required assets and semantic roles validated, composition attached and gameplay visual pools ready.
- Rendered requires successful rendering of the complete gameplay-capable scene into a nonzero viewport. Idle need not show fake notes; real-playback note visibility is a required integration acceptance check.
- `main.ts` unlocks only on `rendered` for the current scene generation. Stale readiness and failure callbacks cannot affect the replacement scene.
- Failure cleans up before notifying once. Context loss follows the same existing unavailable/pause path.
- Retry destroys the previous shell, creates a fresh generation and does not resume playback. Disable duplicate retries during loading.
- Destroy aborts work, makes future updates inert/unavailable, and disposes resources idempotently.

Load the complete required bundle before readiness, not progressively assembled gameplay. Preserve existing audio/playback epoch guards, including pending start/resume/restart settlements.

### Temporary viewport suspension

The UI layout producer measures actual host content dimensions, without `Math.max(1, ...)` disguising a collapsed element, plus persistent in-play HUD exclusions described below. Scene projection declares the underlying viewport usable only when those dimensions are positive and the playable corridor/labels satisfy the geometry-proof minimum. Ready, Pause, Results and error overlays intentionally cover the scene: they are not viewport exclusions, do not trigger suspension or camera refitting merely by appearing, and do not prevent readiness behind them. Readiness evaluates the geometry available when gameplay is exposed; the existing game-state/input rules govern intentional modal occlusion. Any renderer backing-buffer clamp remains an implementation detail, never visibility evidence. Existing document-visibility/blur pausing remains independent.

When the viewport is unusable, `updateFrame` returns `suspended`, even if assets are still loading. Keep the scene shell, loaded resources and in-flight bundle; skip gameplay rendering, continue accepting layout/frame updates and do not invoke the terminal failure callback. Show a distinct resize-to-play status, not an asset error or reload button.

On entry into suspension, `main.ts` revokes availability immediately, invalidates pending playback action epochs and pauses through the existing safe pause path. It does not advance the renderer generation or destroy the scene. Process this transition once, not on every RAF; a later terminal failure still follows the normal failure path. No input/start/resume/restart is permitted while suspended.

Restoring a usable viewport returns `loading` if the bundle is incomplete, otherwise attempts rendering. Only a successful `rendered` result restores availability. The song remains paused until explicit user action; stale completion of an action started before suspension cannot restart audio. Cover ready → collapsed/too-small → restored, suspension during a pending start/resume, restored-before-load, and terminal failure during suspension in lifecycle tests. Also prove initial readiness behind the Ready dialog and restored readiness behind Pause, without those overlays changing the camera or blocking Start/Resume once ready. The numeric minimum is an output of the geometry proof, not a new arbitrary budget.

## URLs, data and ownership

Use explicit Vite `?url` imports for production GLBs, giving deployment-base-aware, content-hashed URLs. Do not copy the review's root-absolute `/assets/production/` paths or `cache: no-store`. Use installed Three.js `GLTFLoader`, without an additional loader package.

Create compact, versioned runtime composition data derived reproducibly from the production layout: matrices, camera, exact ground inputs, crowd placements and required semantic roles/gameplay anchors. Test correspondence to authoritative inputs. Do not ship detailed validation reports or maintain a second hand-entered transform set. The fifteen additional review crowd placements currently live in the combined harness; retain them only through explicit extraction into this data. Twenty-five static figures are an initial comparison baseline, not a permanent population mandate.

Fetch with an `AbortSignal`, check HTTP status, then decode bytes using `GLTFLoader.parseAsync`. The current assets are self-contained GLBs; unexpected external dependencies require explicit handling, not implicit untracked requests. Validate required roots, materials and finite transforms before attachment.

Abort does not cancel an in-progress decoder. After decode, check cancellation and dispose stale results. On any required asset failure, abort sibling fetches, dispose completed assets and dispose later successful decodes. `Promise.all` rejection alone is not cleanup. Bundle-local cancellation and application generation guards solve different problems and both are required.

Resource ownership is explicit:

- Bundle owns imported geometries/materials/textures, including detached prototypes and replaced imported materials.
- Composition borrows geometry and owns instancing resources, ground geometry, replacement materials and toon-ramp textures.
- Gameplay visuals own pools/text textures; the facade owns the renderer.
- Dispose shared resources by identity, once. Remove/dispose composition before disposing borrowed bundle resources. Track instance-specific GPU resources too.

No global decoded cache initially: pause/restart/mode changes reuse the existing scene; HTTP caching handles retry transfers. Log attempt/outcome for loading, assembly, first render, failures, retry, cancellation and disposal with generation/asset context, not per-frame noise.

## Canonical playfield and camera proof

This is the first implementation risk to resolve, before migrating the complete scenery.

Current procedural lanes use spacing 4 and an untilted path Z −13…4.5. Production lanes are centered at X **−4.5, −1.5, 1.5, 4.5**, with 2.75-wide travel surfaces. The architectural inspection measured luminous platform targets at local glTF Y≈0.365, Z≈−1.45, with top surfaces reaching Y≈0.410. Their top centers project near `(458,581), (686,581), (914,581), (1142,581)` in the reference 1600×900 view. Revalidate these measurements against semantic objects in the proof, rather than hard-coding approximate values as a substitute for geometry evidence.

The target is therefore near 64.6% of the full reference canvas height, not independently dictated by the old board's 82% hit-line constant. The old board uses a different coordinate space. Preserve timing semantics, not obsolete screen percentages.

### Frame and layout ownership migration

`projectGameplayFrame` remains the pure adapter of a frozen controller snapshot. Preserve its transport time, active-run difficulty, playing/reduced-motion flags, unresolved note IDs/lane indices/progress, chart-derived pool capacity, feedback event/run IDs and transport onset, and text-label contents. The controller remains authoritative for difficulty and judgment; the adapter does not rejudge notes.

Move timing geometry to dimensionless progress at this boundary: a pure helper in `note-projection.ts` computes good/perfect **half-progress = profile half-window seconds / visible approach seconds**, and the adapter includes those values in the frame. The scene consumes them rather than independently re-reading difficulty to derive another window. The adapter uses the same profile to format the legend. Note centers keep their existing clamp; envelope endpoints are center progress plus/minus these half-progress values, without endpoint clamping.

The new rendering contract removes `bottomPercent`, pixel `TimingWindowGeometry`, lane `x/width`, the `containPlayfield` 2:1 fit and old `layout.board/stage` as geometry authorities. Keep indexed lane identity if useful, but no scene consumer may use legacy board-relative coordinates. Temporary legacy adapters are permitted only during the migration and must have an explicit removal point at the gameplay/HUD cutover; no permanent dual projection paths. Update old pixel/board tests into equivalent timing, finite-projection, containment and aspect-readability tests rather than deleting their intent.

`ui.ts` remains the only DOM layout measurement producer. Its cached layout, in CSS pixels relative to the canvas host content origin, provides: raw host width/height; the available scene viewport; measured rectangles occupied by persistent in-play meters/controls that constrain gameplay; and fixed overlay slots for time/countdown, timing legend and feedback text. Exclude Ready/Pause/Results/error overlays from this playable-space contract: their intentional temporary occlusion is handled by game state, not camera fitting or viewport suspension. Resize/layout changes refresh the contract. Derive measurements from the actual elements after removing the old stage/board slots, not hand-authored second copies of their positions. The UI sends no camera or lane geometry.

The scene's playfield projection consumes viewport/exclusions, chooses the camera fit and publishes projected lane/hit anchors to gameplay visuals. D/F/J/K labels and hit feedback use those projected anchors; fixed time/countdown/legend/general feedback labels use the UI's fixed overlay slots. The overlay uses the same host-relative CSS coordinate system and handles device-pixel scaling only at rendering. `projectGameplayFrame` passes cached layout through without fitting a board. `main.ts` coordinates this frame delivery but does not compute note positions or DOM geometry. This assigns each measurement, projection and label position to one owner.

One playfield contract supplies the common parent transform, lane centers/widths, measured approach start and hit anchors, a surface-following clearance profile, and supported progress extent. Use it for notes, timing envelopes, hit effects and labels. The raised highway nose/platform ridge requires a measured clearance profile, possibly piecewise; arbitrary constant-height notes are not assumed safe.

- Progress 1 remains the judged hit time at the corresponding luminous target.
- Overdue unresolved note centers clamp to progress 1.
- **Timing-envelope endpoints do not clamp.** Support the full difficulty-derived range (approximately −0.2083…1.2083 in the historical cited case), finite and monotonic in projection, including outside the nominal approach interval.
- Extend the clearance/projection proof to these endpoints and the camera near/far planes. Perspective envelopes need not be pixel-symmetric.
- Judgment stays time-based; difficulty, calibration, scoring and transport remain unchanged.

Render a single perspective world pass for scenery/playfield/notes/world feedback, then a screen-space overlay pass for crisp labels/GPU text. Remove the obsolete procedural scenery/runway/stage cameras rather than retain them as competing geometry authorities. Keep DOM controls, meters, dialogs and accessibility surfaces.

At the reference viewport, use the approved composition. Responsive framing fits the playable corridor and label space within the actual scene viewport and HUD exclusions; crop scenery before compromising gameplay. Derive all anchors from the final camera/viewport and never independently stretch the highway into the old DOM board slot. If a minimum viewport cannot retain readability, constrain the scene region or declare a minimum, rather than silently overlap controls or promise mobile support. Exact responsive camera parameters are an output of the geometry proof, not an invented completed design here.

## Appearance, modes and performance scope

Extract the reviewed shared three-step nearest-filtered toon ramp and role mapping. Preserve linear source colors, emissive colors/strengths and black bases for pure emitters. This is consumer material treatment, not Blender shader portability. No new shader engine, bloom pipeline, baking or appearance redesign in this integration.

Continue consuming `SceneStateProjection`: mode/transition progress selects and interpolates warm Audience and violet Twilight endpoints; intensity/brightness preserve meaningful participation cues. Reduced motion suppresses optional motion and uses the existing reduced-motion transition semantics. Time-based feedback uses transported frame time, not a new clock. Do not restore removed procedural effects solely to satisfy stale flags.

Static repeated city/framing/crowd geometry uses the reviewed batching approach, preserving all instance matrices/material roles and recomputing bounds. Keep scene totals distinct from visible-frame counts, decoded geometry and draw calls. No streaming, global registry, crowd animation, LOD or extra compression system without evidence of need. The review's 401,177 rendered triangles / 485 draw calls on SwiftShader are not a real-device performance budget.

## Implementation sequence after authorization

1. **Geometry/camera proof:** actual highway/platform/endcaps, diagnostic real notes and anchors; four-lane hit alignment, junction clearance, extended envelopes, responsive label/readability evidence. Settle the canonical contract before full composition migration.
2. **Loader/lifecycle:** scene-owned bundle, readiness result and loading/suspension UI. Can proceed alongside the proof once interfaces settle. Test delayed/failed/corrupt/missing-role loads, partial success, late decode, cancellation, destroy, context loss, stale callbacks and repeated retry, plus viewport suspension/restoration with pending playback. No early input/playback or automatic recovery resume.
3. **Composition/appearance:** derive runtime layout, assemble approved assets/ground/static crowd, batch geometry and apply shared mode treatment. Depends on loader; final framing depends on proof. Compare both modes with accepted reference and test roots/roles/transforms/bounds.
4. **Gameplay/HUD migration:** replace old passes and route notes/envelopes/feedback/labels through canonical projection. Preserve controller/audio/keyboard/resources/pause/restart/reduced-motion behavior. Write semantic regression tests as each boundary changes.
5. **Deployment/device acceptance:** production build under a non-root base URL; real gameplay in both modes and through transition; resize/minimum viewport; repeated lifecycle cleanup; actual agreed browser/device loading/frame evidence. Agent playback tests set `VITE_SONG_VOLUME=0`, and every temporary server/browser has owned cleanup.

Stages are dependencies, not permission to implement. No detailed implementation beads or final numeric performance budgets are implied before design agreement.

## Open decision

The user selected **desktop first**: the current keyboard game with responsive desktop windows, no mobile performance/input promise. Identify the actual target device/browser and smallest supported viewport before performance/compatibility acceptance; this need not block a bounded geometry proof. Static crowd is the initial scope; motion and final density remain separate follow-up work.

## Review status

Synthesized from current-code reconnaissance, historical constraint review and architectural advice. Independent verification closed BV-DR-01 (frame/layout ownership migration), BV-DR-02 (viewport-loss readiness) and BV-DR-03 (modal exclusions can deadlock readiness/recovery). Terminal broad design review accepted the complete proposal with no remaining material findings on 2026-10-12. The user then requested implementation planning with desktop-first scope. Actual target device and minimum viewport remain open; exact geometry/camera tuning belongs to the proposed proof. No game implementation has begun.
