# Approved neutral crowd-character base

**Base model approved 2026-10-11. Rigging, additional poses, animation, additional characters, export and runtime integration are not yet authorized.**

## Direction and revision record

- The 2026-10-11 “begin the redo” instruction authorized one neutral clothed anime character, reviewed before rigging. Approved references: [`../brief.md`](../brief.md), [`../concept-cel-shaded-candidate.webp`](../concept-cel-shaded-candidate.webp); provenance/approval history: [`../README.md`](../README.md). The brief's older modeling prohibition is superseded only by these bounded instructions.
- The user then called the neutral base “much more usable,” but identified its non-T pose and “2 shoulders.” This is feedback, **not model approval**. The authorized correction was the shoulder/sleeve transition and a true T-pose, retaining the rest. No face/hair refinement decision was received or inferred.
- This revision replaces the flared sleeve ledge and exposed second deltoid with one gently descending clavicle/shoulder crown, a rounded sleeve root, and an upper arm whose maximum volume lies **under** the sleeve. The axilla rises with the horizontal arm; the exposed upper arm tapers toward the elbow. A small forearm-section adjustment removes a newly conspicuous angular bump in the horizontal pose.
- All 14 other meshes, including head/neck, facial parts, hair, trousers and shoes, match the preceding candidate exactly in stored coordinates, polygon data, materials and transforms. Hand shape/connectivity is retained under its new pose frame (maximum comparison error `1.69e-7` m); palms-forward/thumbs-up corrects the old hand-frame handedness, with outward winding recalculated.
- Before editing, the entire prior candidate package was copied to `/tmp/opencode/neutral-t-shoulder/before/`. Fresh scratch construction, reopen tests, render inspection and independent regeneration preceded replacement of the then-unapproved candidate. Scratch history is not a runtime or reproduction dependency. Original concept/brief, parent failed diagnostic and other assets remain untouched.
- On 2026-10-11 the user said “if the question was do i approve then yes,” approving the corrected T-pose **base model only**. The interrupted combined approval/rigging option was not selected; no rigging or pose-work authorization is inferred. `character-candidate.blend` was renamed to `character.blend` with identical bytes, without resaving or changing geometry, materials or pose. Existing approval previews remain unchanged.

## Source, pose and construction

[`character.blend`](character.blend) is the approved editable authority; [`build.py`](build.py) deterministically reconstructs its geometry. Internal historical candidate-status metadata and generator labels are deliberately retained to preserve approved source bytes; this README records the approval. Blender **5.2.1 LTS**. Z up, −Y forward, nominal meters, origin at ground center. True symmetric T-pose: shoulders, elbows and wrists share `Y=-0.012`, `Z=1.409`; absolute X positions are `0.200`, `0.478`, `0.687`. **Palms face −Y, thumbs +Z**, fingers separated. Game scale/camera distance remain unknown.

Explicit shared-edge panels join torso to sleeves, each upper arm to its hand/digits, pelvis to legs, and jaw to neck. Head/neck, shirt and trousers are individually connected surfaces; each arm/hand is a connected closed surface. They are not a single continuous hidden nude body or a tested deformation system. No remesh, voxel union, subdivision, rig, animation, sculpt pass, UVs, textures, export, runtime changes or installations. Restrained Principled material regions remain editable; these are not validated runtime toon shaders.

## Actual-model evidence and limits

Current views: [front](preview-front.webp), [three-quarter](preview-threequarter.webp), [shoulder close-up](preview-shoulder.webp), [side](preview-side.webp), [back](preview-back.webp), [hand](preview-hand.webp), [topology](preview-topology.webp). Head-only evidence is retained unchanged: [front](preview-head.webp), [profile](preview-head-side.webp).

Front/three-quarter/shoulder images now show a single shoulder-to-upper-arm contour rather than a shirt shelf followed by an exposed shoulder bulge. These views were compared with the prior candidate and approved concept. The contemporary teal/dark-clothing identity remains; this neutral study does not reproduce the concept's expressive poses or finished cloth treatment. No lighting/material changes were used to conceal geometry.

**Remaining limits:** sleeves are simple and somewhat tubular, with an angular underarm and open, unlined cuff edges visible in side view. No doubled shoulder is apparent in the revised front/three-quarter/close-up, but this is not refined cloth drape. The sharp chin/profile, projecting facial layers, faceted hair/helmet-like rear mass, slab-like ears, simplified hands, angular back collar, small hip contour step and blocky shoes are unchanged limitations—not newly authorized redesign work. Side view looks directly along the horizontal arm and is foreshortened; the three-quarter and close-up expose its length. No bent-joint, skin-weight or exhaustive self-intersection test is claimed. **Topology checks do not establish rig readiness or artistic approval.**

## Saved measurements and checks

- **17 meshes; 3,043 vertices; 5,530 triangles; 2,486 quads; 14 used material regions.** Shirt: 238 vertices / 428 triangles. Each arm/hand: 459 / 914. Other part counts are unchanged. The shirt needs two fewer local n-gon interior vertices than before; density did not increase.
- Bounds: `(-0.837, -0.132, 0)` to `(0.837, 0.1306594, 1.7958543)` m; height `1.7958543` m. No approved runtime polygon/material/draw-call budget exists.
- `validate.py` checks ownership, finite data, no rig/modifiers/animation, face/edge/tessellated-triangle degeneracy, manifold interiors, winding, positive closed-component volumes, connected main surfaces, intentional unbranched boundaries, facing, ground/height/head ratio, neck extent, symmetry, actual horizontal arm sections, joint metadata, material assignment and garment overlaps.
- New **triangle-surface** shoulder checks sample 24 radial directions at five covered-arm stations per side: minimum measured cloth clearance **4.292 mm**. Crown silhouette decreases continuously over X=0.16–0.34 m; cuff top sits **9.439 mm** above the nearby exposed arm. Six exposed-arm samples taper without a second maximum. These are local regression checks, not universal anatomy rules or full clearance certification.
- Five negative tests reject reversed facing, a deleted thumb-tip face, a lowered wrist, a reintroduced sleeve ledge and a second exposed deltoid bulge. Mesh mutations preserve counts where appropriate. Original fingerprint is restored in memory; source stays unchanged.
- Intentional boundary count remains **454 edges**: eye apertures/inserts/overlays, hair cap opening, shirt collar/hem/cuffs, trouser waist/cuffs, waistband and lace strips. Separate hair locks/ears and shoe/trouser overlaps remain intentional.
- Fresh relocated-script regeneration (path containing a space, 8 build threads) exactly matched the 1-thread candidate's full coordinate/topology/material/transform fingerprint and per-part report. Promoted candidate reopened successfully; approved reference hashes passed. All final build/check/render commands exited 0; no owned process remains running.
- Approval promotion reopened stable `character.blend` with the unchanged validator: all five negative tests and reference hashes passed, exit 0. Its fingerprint and per-part report match the prior relocated regeneration; all three scripts are byte-identical to that tested copy. Syntax, README links and seven explicit-output/no-overwrite guard tests passed. Source bytes, all previews and the parent failed diagnostic were preserved. No regeneration or rerender was needed for this rename-only promotion.

Fingerprint: `5e4989c252252a58d0228ab55fd4103ac7f5c8f7fe9553dcf0e5c786075fc860`.
Approved `character.blend`: **163,550 bytes**, SHA-256 `05d18729cd9c163cca5476049a10491639c36465b0fcd2494c9f70e656309735`.
Parent failed diagnostic remains `c0961ed502852159343e51c7e52062cc2a9c366e34498282d7277fe4a5e1b002`.

## Reproduction

Preserve the parent package's sibling brief/concept references. Set absolute `PACKAGE` and a new existing scratch `WORK` directory; outputs refuse overwrite:

```bash
blender --background --threads 1 --python-exit-code 1 \
  --python "$PACKAGE/build.py" -- --output "$WORK/character.blend"
blender --background "$WORK/character.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/validate.py" -- \
  --negative-test --check-references --report "$WORK/validation.json"
blender --background "$WORK/character.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/preview.py" -- \
  --output-dir "$WORK" --views front side threequarter shoulder back hand topology
```

Optional `build.py --study` builds only head/neck/shirt and is deliberately rejected by full validation. Builds/checks used 120-second bounds; render batches 240 seconds. The first scratch revision failed radial clearance and visibly intersected the sleeve; it was corrected, not accepted by relaxing that check. Prior overwrite guards remain in the reusable scripts.

Previews are read-only orthographic geometry diagnostics: Cycles 32 samples, denoising, AgX Medium High Contrast, gray world/three broad area lights, unchanged from the earlier candidate. Front/back/three-quarter/topology 1200²; side 1000×1200; shoulder 1200×1000; hand/head 1000². Front/back cameras are now level and framing widened only to fit the T-pose. Source checksums stayed unchanged; selected WebPs use installed `cwebp -q 92`. Intermediate PNGs, logs, reports and before/after comparison remain in task scratch, outside this maintained package.
