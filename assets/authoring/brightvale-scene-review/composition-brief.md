# Brightvale assembled-scene review — bounded composition handoff

**Current handoff to Sol: one framing-only revision of `candidate/initial/scene-review.blend`.** The user explicitly corrected and approved the framing direction: a continuous **SECTION → complete POST → SECTION → complete POST semicircular arch**, opening toward the player/foreground. The earlier long-short/no-post interpretation was our error and is superseded. Preserve the initial blend/previews and all approved source files. Keep highway length/tilt, platform/endcaps, camera, city, ground, lighting, and all crowd data/world placement **exactly unchanged**. City/ground appearance and ramp correction are explicitly tabled. This authorizes scene-only framing placement, not source mesh/material edits, export, runtime integration, or final acceptance.

## Retained composition intent — initial nonframing layout is now fixed

The gameplay area must dominate the screen. The four-lane highway is the broad, clear foreground-to-distance spine; the platform and fitted endcaps remain a coherent near-end assembly. It is appropriate to rotate and resize the highway/platform/endcap assembly together, including tilting it upward around its foreground edge, to get the strong low, receding view of the original mockups. The current road reads too short: test a meaningfully longer highway. Its length is generator-supported (`brightvale-highway/build.py --length`, 6–60 authoring units); the maintained assembly is 18 units. If a longer road is needed, build it as a separate candidate from the approved generator, never by stretching or editing the approved highway mesh. The approved lane axes, colors/order, continuous surfaces, measured platform junction, and fitted endcaps remain the source design; preserve a clean joined interface while transforming them as one assembly.

The city may be much larger and cropped by the camera. It need not be fully visible, and its foundation need not be exposed. Let the visible skyline sit behind the far road and support depth, without requiring the whole cutaway city to fit in frame. Existing city geometry is a provisional detailed baseline and may be repositioned and uniformly scaled as a scene assembly; do not alter its buildings or foundation mesh in this pass.

Outer framing must form **one genuine semicircle in plan**, not two almost-straight side runs. Alternate existing wall SECTION geometry with complete POST assemblies, continuously connected with no open gaps. Every post retains its stone pier, warm metal bezel and inset amber lens together. Select suitable existing section length/count and place rigid sections along arc chords between posts. Modest overlapping joints behind posts are allowed; no bending, stretching, new geometry or source material edits. Terminal posts may finish the open ends. If the semicircle creates meaningful gameplay obstruction or requires source edits, report the concrete limitation rather than changing other assets.

The original `Golden City Rhythm Concert` and `Neon Twilight Rhythm City` mockups are composition references: low viewpoint, expansive foreground highway, deep city, and crowd at the sides. Their HUD, score, stars, notes, ornaments, cosmic elements, and other mockup-only details do not become requirements here. Do not add a stage, performer, replacement focal structure, monsters, or new environmental dressing. Crowd geometry, placement, density, poses, and revisions are explicitly deferred; retain the current sample untouched for context only.

## One bounded next Blender pass

Create a new framing review under `candidate/framing-review`, starting from the exact saved `candidate/initial` scene. Replace only its mistaken long-short side runs with the approved section-post semicircle. Preserve all nonframing scene state and original sources. The initial gameplay-dominant composition described above remains fixed for this pass; it is not authorization for another layout search.

Render matched neutral/Audience/Twilight landscape views using the unchanged initial camera, plus a simple **top-down geometry diagnostic** proving the semicircular plan (not a replacement gameplay camera). Report section/post/component counts, radius/center/180-degree arc, continuous joints, lane clearance, nonframing semantic identity, preserved source/initial hashes, saved reopen/regeneration and visible limitations. Parent reviews, then the user separately accepts the revised scene. No narrow-crop, population, runtime-fit or city-visibility optimization.

## What may change, and what needs a decision

- **Current scene-level scope:** framing placement/duplication only. Earlier whole-playfield/city/camera/light freedoms applied to the initial composition pass and do not apply to this revision. Do not interpret authoring units as meters or runtime scale.
- **Highway extent:** generator supports a longer candidate; source mesh remains immutable. A truly longer road requires a generator-built candidate, not scene scaling alone. The approved generator guardrail is 6–60 authoring units, not a gameplay/performance budget. Do not promote that candidate as approved without later review.
- **Source geometry/material edits:** not authorized. If fitting a continuous curved run requires bending, reshaping, new wall-piece types, altered city foundation, changed road/platform geometry, or material/concept changes, stop and describe the concrete proposal for approval. Existing framing-piece appearance/materials, highway lane design, and city architecture remain as approved/provisional sources.
- **No invented fit constraints:** do not require the full city in frame, an exposed city foundation, or an entirely visible framing run. Crop is acceptable, especially for the city. No runtime camera equivalence or responsive-fit claim.

## Grounded reuse notes

- Highway authoring axes: X lateral, −Y foreground, +Y travel, Z up. Current chassis is 18 units from Y=2.7; its generator accepts `--length` 6…60. The platform/endcap junction is measured and documented in `../brightvale-highway/README.md`; generator changes preserve it.
- Framing source has two wall lengths and a complete post module: `Framing | long masonry section`, `Framing | short masonry section`, and the three components `Framing | post stone pier`, `Framing | post warm metal bezel`, `Framing | post inset amber lens`. The complete post **is required in the repeated section-post sequence**. The source has ten mesh objects overall because each post has three components and there are two instances per type. Existing source placements/gaps are disposable, not the approved module geometry.
- The city source has a `CITY.ProvisionalLayout` root whose uniform scale/placement can be changed without editing descendant meshes. The foundation belongs to that source and need not be hidden or exposed by this direction.
- The existing assembler currently hardcodes the 18-unit highway source and separated framing roots. A new scene pass can reassemble from source packages; do not overwrite this assembler/candidate as part of art direction unless separately asked.

## Read-first references

- `README.md` in this package — current candidate and the three unpromoted camera/layout diagnostics.
- `../brightvale-highway/README.md` and `build.py` — approved junction, authoring axes, and configurable length generator.
- `../brightvale-platform-endcaps/README.md` — fitted pair and controlling placement reference.
- `../brightvale-outer-framing/README.md` and `build.py` — approved piece identity, exact reusable names, and distinction between approved modules and disposable placements.
- `../brightvale-distant-city/README.md` — provisional city baseline, editable root, and foundation ownership.
- `.lore/work/mockups/Golden City Rhythm Concert.webp` and `Neon Twilight Rhythm City.webp` — original composition references; see also `.lore/work/design/brightvale-perspective-highway.md` for approved highway hierarchy and excluded mockup details.
