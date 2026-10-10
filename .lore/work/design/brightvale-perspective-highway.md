---
title: "Brightvale perspective highway design proposal"
date: 2026-10-10
status: approved
tags: [design, brightvale, rhythm-game, perspective, threejs]
related: [.lore/work/design/brightvale-mvp-experience.md, .lore/work/mockups/Golden City Rhythm Concert.webp, .lore/work/mockups/Neon Twilight Rhythm City.webp]
---

# Brightvale perspective highway design proposal

This document consolidates the visual direction discussed for the perspective highway. The user approved this design as a whole on 2026-10-10. Approval is not implementation authorization, asset approval, or a claim that responsive fit has been tested. The mockups are mood and composition references; their score, stars, combo, lane decorations, and other pictured details are not requirements.

## Approved direction

The following visual directions were explicitly selected by the user. Approval is for design only; exact camera and object parameters remain for the prototype to tune.

- Use a low, dramatic viewpoint, a centered highway that dominates the foreground, and pronounced depth closer to the mockups than to a balanced elevated view.
- **Superseded by the later amendment below:** place the lead performer on a raised stage beyond the far end of the highway, slightly off-center. The city and crowd join the performance, while the highway remains the primary foreground element.
- Notes are compact glowing bars with crisp edges and restrained halos.
- Use lane-separated hit targets with distinct nested Good and Perfect timing bands in each lane. The functional bands must not become an enclosing decorative frame or restore the removed large note container.
- On narrow screens, protect readable lanes first and crop side scenery before shrinking the playfield. (The former far-end-stage priority is superseded below.)

## Later user amendment: remove stage and performer

After approving the original direction above, the user explicitly amended the prototype scope: remove the performer, then remove the stage as well; the whole elevated stage/performer feature is unwanted. This later instruction **supersedes** the earlier stage and performer direction in this document. The prototype must not retain, reposition, or improve either element, and must not introduce a replacement focal structure. Keep the city and crowd. The original approval remains recorded here as historical context, not current implementation direction.

## Proposed composition

Keep the camera fixed during play. Frame the highway as a broad, low foreground plane that narrows toward a visible vanishing region; use perspective for depth, not lane distortion that makes the four play lanes difficult to tell apart. Avoid camera motion that follows notes or changes the target position. Tune camera height, pitch, field of view, runway width, and far-end scale in the playable prototype rather than treating any reference-image proportions as exact values.

The city frames the runway, with the crowd visible along the near edges and receding into the distance. Do not add a stage, performer, or substitute focal structure; keep scenery subordinate to the runway and approaching notes.

Both modes remain in perpetual twilight. Audience uses warm light and welcoming city/crowd response; Twilight uses violet and darker values. Treat these as two expressions of the same twilight scene, not day versus night. Keep lane and note contrast dependable in both palettes; do not rely on mode color alone to communicate gameplay.

## Runway, notes, and target hierarchy

Use a visually quiet runway: clear lane boundaries and restrained surface lighting, with no decorative stars, extra lane emblems, or enclosing note panel. Keep the note bars compact, with an unmistakable bright edge and a small halo that does not wash into neighboring bars or lane edges. Lane identity should remain discernible by stable position and distinguishable visual treatment as well as color.

In each lane, show a precise target accent at the onset location and subdued, visibly nested Perfect and Good timing bands around it. The onset accent identifies the exact center; the bands explain the existing timing tolerance. Keep them legible against the runway, but subordinate to the note bars. Their size and placement must convey the active difficulty’s timing windows under perspective, not use fixed screen-pixel sizing. They remain functional timing guides, not a background panel.

The existing controls and HUD keep their current role and are not redesigned here. Preserve their required clear areas when framing the scene; do not place the runway or brightest scenery behind essential labels or controls. Do not add score, stars, combo, or new mechanics from the mockups. Keep existing Renown/strength mechanics intact.

## Responsive framing proposal

For constrained width, crop side city and crowd details first. Keep the playable lanes wide and distinct, retain the low viewpoint and foreground emphasis, and reduce nonessential scenery rather than compressing lane spacing. For constrained height, preserve enough runway depth to read approaching notes and the target bands; trim upper sky or distant skyline before sacrificing the playable area. There is no stage or performer to preserve.

These are priorities, not a validated layout guarantee. Prototype review must include narrow width and constrained height, with controls/HUD visible, to confirm lane and timing-band readability while cropping side scenery first.

## Timing and prototype validation boundary

Preserve the current chart/audio transport, onset, input calibration, hit eligibility, scoring thresholds, and difficulty semantics. Perspective changes visual projection only. Note centers continue to follow the existing transport/onset contract; clamp center motion at onset as today, rather than clamping timing-band endpoints. The Good and Perfect bands must show both sides of the applicable time windows projected along the runway; perspective may make their screen-space extents asymmetric. They communicate existing tolerance and do not define a new scoring rule. Do not change the game model, thresholds, offsets, or calibration to make the visuals fit.

### Proposed projection contract

Let `n` be chart onset, `t` audio transport time, and `T = 2.4 seconds` the existing approach duration. Note-center progress is `p = clamp(1 - (n - t) / T, 0, 1)`. Let `f(u)` project a position along a lane's runway through the perspective camera. Draw the center at `f(p)`; onset is exactly `f(1)`. Unresolved late notes stay there until the game resolves them.

For each timing half-window `W`, project the moving tolerance-envelope edges at **`f(p - W/T)` and `f(p + W/T)`**. Project fixed target edges at **`f(1 - W/T)` and `f(1 + W/T)`**. Clamp the center only, never these endpoints. This preserves the existing envelope's attachment to the center during late grace and makes note envelopes coincide with target bands at onset. The compact bar body is distinct from its timing envelope; its halo must not imply a different scoring boundary.

Use the active run's frozen difficulty: Easy Perfect/Good are ±250/500 ms, Normal ±75/150 ms, and Hard ±50/100 ms. For example, Easy Good target endpoints are at runway progress `0.791667` and `1.208333`; Perfect endpoints are `0.895833` and `1.104167`. Perspective projects those positions, not a constant pixel thickness. Reserve runway and camera visibility beyond the hit line and before the approach start for these extents; the largest envelope requires progress from approximately `-0.208333` to `1.208333`. Projection must stay finite and monotone throughout that range.

Scoring still accepts transport times inclusively in `n ± W + inputOffset`; positive input offset shifts acceptance later. Neither input calibration nor the stored visual offset is newly applied to note geometry. The current gameplay projection uses transport time directly. These bands express a tolerance scale, not geometric hit eligibility: clamped late notes can remain centered while eligibility continues to depend on time.

Evidence: `src/note-projection.ts:30–79` (existing linear envelopes and clamped centers), `src/gameplay-frame.ts:111–129` (active profile and projection inputs), `src/scene.ts:1213–1255,1333–1354` (fixed bands and attached envelopes), `src/game.ts:126–138` (inclusive calibrated windows), and `data/charts/difficulty-profiles.json` (thresholds). This is a proposed perspective construction checked against the existing contract, not implemented or visually validated geometry.

The future playable prototype should be reviewed at desktop and representative narrow/constrained-height layouts for:

1. Stable, readable four-lane mapping and a fixed, visually clear onset location.
2. Distinct nested Good/Perfect bands whose projected extents accurately represent the active difficulty windows on both sides of the onset, including any perspective asymmetry.
3. Notes that remain trackable against both warm Audience and violet/dark Twilight scenes without their halos merging into lane boundaries or target accents.
4. A readable city and crowd composition without obscuring play, existing controls, or HUD; no stage, performer, or replacement focal structure.
5. Narrow framing that preserves lane readability before side scenery.
6. Automated projection checks for all active difficulties: exact onset alignment, unclipped time-derived endpoints, nesting, attached envelopes during late grace, and unchanged inclusive scoring/calibration behavior. Check time/world-space ratios rather than requiring old linear pixel ratios under perspective; changing the next-run difficulty must not resize the active run's windows.

These are review criteria for a later prototype, not test results. Exact camera values, final responsive fit, and the proposed projection's implementation remain to be validated in that review. The original stage/performer visibility review item is superseded by the later user amendment: verify instead that the city and crowd remain legible without adding a replacement focal structure. Approval of this design proposal would not by itself authorize prototype implementation, concept art, modeling, or runtime integration.
