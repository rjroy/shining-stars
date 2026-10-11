# Brightvale modeled highway — approved description

**Description and concept approved.** The user approved the highway concept; exact camera, platform junction, scale, and lane correspondence remain approximate and must be resolved before modeling. This approval does not authorize modeling or runtime changes.

## Purpose and layer boundary

Give the perspective play highway a more substantial, crafted physical identity than the current flat translucent runway, while keeping four lanes, moving notes, and timing targets unmistakable. Treat this as a static modeled substrate and decorative material structure. Runtime remains responsible for gameplay ownership and semantics: lane mapping, moving note bars, timing bands, hit accents, and their timing/projection. Do not bake timing graphics, note positions, calibration, scoring behavior, HUD, or controls into the model; do not add another hit strip or enclosing note frame. Do not require preservation of the current flat translucent runway as a visual overlay: later integration may retire or replace redundant surface layers while preserving runtime gameplay behavior.

The highway is its own layer between the approved distant city/crowd scene and the already accepted four-lane Neon Twilight platform. Propose a clear, low-profile visual junction at the player-end of the highway so it feels connected to the platform, but do not assume a fixed coordinate, width, scale, lane-center match, or endcap construction. The platform’s authoring dimensions and Blender axes are documented, but no runtime attachment/scale contract exists; lane spacing also differs between the current platform model and procedural Three.js runway. Exact highway/platform scale and lane correspondence must be measured and resolved before modeling; this concept cannot establish those values. The separate endcap task remains out of scope. Show the relationship as a visual proposal, not a measured fit.

## Approved richer treatment

Build depth and richness into large, readable forms rather than surface noise:

- A substantial but restrained dark midnight-blue substrate with visible side thickness, a sculpted/beveled edge profile, and broad modular mineral/enamel panels. Use a repeatable, low-contrast seam rhythm that reinforces forward perspective without looking like a grid or competing with notes.
- Four continuous, slightly inset lane surfaces with clean raised/recessed boundaries and slim, separated edge inlays. Keep the full usable lane width visually quiet and unobstructed; no stars, crests, emblems, symbols, text, or repeated small ornaments on the travel surface.
- Use distinct but compatible material regions—dark blue mineral/enamel, muted metal edging, and restrained embedded luminous accents—so the asset has real modeled structure without turning into a gold cage. Where lane accents are shown, preserve the existing left-to-right lane identity and colors as secondary cues, never color alone. Reconcile exact lane correspondence against the unscaled platform/runtime before modeling.
- Let controlled warm reflections and amber/gold accents connect to Audience and the accepted platform; use the same geometry with darker violet/blue lighting and restrained cool accents in Twilight. This is one perpetual-twilight scene, not day/night or two different highway models.

This is an art-direction proposal, not a polygon budget or validated rendering technique. Make cel/anime-style composites consistent with the approved crowd, but do not make the highway compete with the contemporary player-facing audience or far skyline. The world’s magical-girl power-fantasy/cosmic-horror context is atmosphere only; do not invent symbols, lore, monsters, stage, performer/avatar, replacement focal structure, or costume changes.

## Visual evidence requested after description approval

Show the highway model by itself from a low oblique perspective, plus one close surface/edge view that makes thickness, lane construction, panel seams, and material boundaries judgeable. Show approximate common-camera composites in warm Audience and violet/darker Twilight with the approved city, cel-shaded crowd, and accepted platform kept as distinct context layers. Any notes, timing bands, or target accents in those composites are temporary current-runtime overlays, not modeled highway details. Keep the highway and four lanes dominant and readable. On narrow framing, crop side shoulders/details before narrowing lanes; a narrow composition is illustration, not proof of responsive fit. Label camera/projection and platform junction approximate—no runtime camera or scale fit is established by a concept sheet.

## Observed references vs proposed details

- **Visible in the mockups:** a broad dark four-lane perspective highway, clear lane separation, thin colored edge lights, compact bright note bars, a transverse hit area, and strong depth. The images also show stars, a large judgment flare, HUD, banners, stage-era details, and decorative borders; these are not requirements.
- **Approved runway direction:** low dramatic view, centered highway leading toward the city, stable lane mapping, crisp compact notes with restrained halos, functional nested timing bands, no decorative note enclosure, and crop side scenery before compressing lanes.
- **Accepted platform:** broad midnight-blue four-lane object with gold framing, colored lane materials and hit strips. Its existing geometry is approved for Audience and Twilight; do not rebuild or duplicate its crest, lane frames, or hit bars in this highway asset.
- **Proposed, not established:** visible substrate thickness, broad modular surface panels, inset lane beds, modest profile bevels, and low-contrast seam rhythm. These enrich the plain current runway while keeping gameplay overlays separate.

## References and implementation boundary

- `.lore/work/mockups/Golden City Rhythm Concert.webp` and `.lore/work/mockups/Neon Twilight Rhythm City.webp` — opened and inspected for highway width/depth, lane edge treatment, notes, and perpetual-twilight palettes. Decorative mockup details are not automatically requirements.
- `.lore/work/design/brightvale-perspective-highway.md` — approved low perspective, lane/readability hierarchy, timing-window behavior and later removal of stage/performer/replacement focal structure.
- `.agents/skills/asset-workflow/references/brightvale-asset-context.md` — current project asset precedence and responsive priorities.
- `src/scene.ts` — current procedural world runway: layer 3, four lane centers spaced 4 world units apart, from `z=-13` to the hit line at `z=4.5`, with translucent `MeshBasicMaterial` surface/lanes/dividers/target bands. Current perspective camera is 60° FOV at `(0, 8.5, 13.5)` looking toward `(0, 0, -2.2)`. This is implementation context, not an asset scale contract.
- `src/scene-perspective.test.ts` and `src/timing-window-projection.test.ts` — preserve four-lane order, camera projection, onset alignment, nested difficulty bands, unclipped envelopes, and responsive travel-distance behavior; the modeled surface must not alter these existing gameplay contracts.
- `assets/authoring/neon-twilight-platform/README.md`, `concept.webp`, `mode-audience-preview.webp`, `mode-twilight-preview.webp`, and `mode-assessment.md` — approved unchanged platform and accepted two-mode suitability evidence. Platform bounds are 12 × 5.5 × 1.145 authoring units; Blender is Z-up, front is negative Y, origin at chassis center. This does not define its Three.js transform, runway attachment, or runtime scale.
- `assets/authoring/brightvale-distant-city/concept-candidate.webp` and `README.md` — approved distant skyline; composite highway context is not a highway approval.
- `assets/authoring/brightvale-crowd/concept-cel-shaded-candidate.webp`, `brief.md`, and `README.md` — approved clean cel-shaded anime with contemporary clothing and player-facing crowd poses; preserve as a distinct layer.
- `assets/authoring/brightvale-outer-framing/concept-candidate.webp` and `README.md` — approved sparse edge framing, with separated sections and open gaps; do not duplicate or absorb it into highway shoulders.

Exact highway-to-platform placement, transform/scale, lane-center correspondence, world/runtime material response, and responsive camera fit remain unknown. Resolve placement, scale, and lane correspondence from measured interfaces before modeling; do not silently fix them by eye in a concept. Material response and responsive camera fit remain later integration questions.
