# Brightvale distant city

Description and distant-city concept approved. **Accepted on 2026-10-10 as a PROVISIONAL detailed authoring baseline, not final fidelity or runtime-quality approval. Runtime integration is not authorized.**

The user's “go” authorized Astra to model the distant city under `shining-stars-4f4.22`, with crowd work separate and later. After reviewing neutral/detail evidence, the user said “For now lets keep it,” anticipating a later reduced mesh with textures/overlays simulating detail. This accepts the detailed source provisionally; it does not certify mockup fidelity, final placement, performance, or runtime readiness. Derived runtime reduction/baking is tracked separately in `shining-stars-4f4.23` and needs separate execution permission. No reduction, baking, export, or integration is authorized by this acceptance. The unchanged brief records the earlier gate state.

The approved description is in `brief.md` (“Approve with spire”). The distinctive tall distant spire is part of the skyline, not a stage or replacement foreground focal structure.

## Concept candidates

Initial concept candidate: [`concept-candidate.webp`](concept-candidate.webp), a four-panel sheet with isolated city and rough composite in warm Audience and violet Twilight. The same skyline arrangement and distinctive distant spire appear in all panels. Composite highway/platform, crowd, and outer frame are context placeholders, not newly approved assets. No score/HUD decoration, stage, performer, or replacement focal feature.

**Concept status: approved by the user on 2026-10-10:** “concept is done and works for me”. Approval applies to the generated PNG original identified below; the current WebP is a user-converted derivative accepted for this purpose, not a byte-identical original. It is a generated concept, not a model, runtime capture, or pixel-exact camera/projection specification. Other layers shown as context are not approved by this decision. The later modeling authorization is recorded above; runtime integration remains a separate gate.

## Candidate provenance and visual assessment

- Current review path: [`concept-candidate.webp`](concept-candidate.webp), 1536 × 1024 RGB; SHA-256 `220643485a5a6fe467f6bc7b98ce663d856b80ebd7e9b388d41cfba0622804af`. User-converted lossy WebP derivative, accepted by the user for this purpose; this hash identifies the current derivative only.
- Native generated original path recorded for provenance: `/home/rjroy/.codex/generated_images/01a127a3-0b0b-7482-b8bb-caf68ccb173c/exec-afe0ac59-3eea-4562-9210-bb2d7890f684.png`.
- Original: PNG, RGB, 1536 × 1024, 2,617,976 bytes. Original native/durable PNG SHA-256: `34997a34adbb18d6534fe694dd84d3852239a5d94cb93eb50d0cb1df33f27047` (historical original hash; not the WebP hash).
- Generated via authorized `codex exec --skip-git-repo-check`, Codex CLI 0.162.1, session `01a127a3-0b0b-7482-b8bb-caf68ccb173c`, 2026-10-10. The actual image was opened and visually inspected; the durable copy was reopened and visually inspected. `file` confirmed PNG format and dimensions; matching SHA-256 verifies the copy.
- Review: all four labeled views are legible. The tall spire stays integrated in the skyline; isolated city views show layered towers, warm windows, and depth. Twilight shifts sky, fog, and lighting toward violet while retaining warm city windows, so the shift is present but less complete in architecture/emission than the background change suggests. Waterfalls, bridge/arches, and mountain forms are prominent carried-over reference motifs, not established city requirements. The composite has a low, centered, strongly perspective runway with side crowds and framing; it approximates, but does not reproduce, the approved game camera. Geometry/layout consistency across panels is illustrative only, not proof of shared 3D geometry. No stage, performer, HUD, score, or notes are visible.
- Concept approval is recorded above. No model approval or runtime approval is implied. The former durable PNG candidate was removed; its original source path and hash above are provenance records, not available active assets.

## Provenance

Original-generation records above preserve the native PNG provenance. Current review asset links use the user-converted WebP derivative; do not treat its lossy bytes as identical to the original PNG. Rejected/removed candidates are historical records only, not active references.

## Provisional detailed authoring baseline

- [`city.blend`](city.blend): native editable, provisionally accepted detailed source. Renamed from `city-candidate.blend` without resaving or changing its bytes; no duplicate blend retained.
- `build.py`: deterministic construction, fixed seed 422; refuses an existing output path. No downloads, imports of other assets, manual sculpt edits, external textures, or runtime exports.
- `validate.py`: reopened-file geometry, ownership, silhouette/depth, material, dependency, and reproducibility checks. Optional approved-source checks are read-only and require an explicit repository root.
- `preview.py`: disposable Cycles review setup; never saves the source. Warm/violet use the same asset objects, transforms, and comparison camera. Geometry signatures and source checksums are asserted unchanged during rendering.
- `preview-neutral.webp`, `preview-detail.webp`, `preview-distance.webp`, `preview-audience.webp`, `preview-twilight.webp`, `preview-reverse.webp`: selected actual-model evidence, not concept art or runtime captures.

### Architectural interpretation and ownership

Opened the approved isolated concept and **both** original mockups before construction; also read the approved perspective-highway design/amendment, shared asset context, and current scene cameras. The concept's narrow masonry shafts, articulated roof crowns, pointed bays, blue-slate roofs, broad overlapping quarters, lower central roofline, and left-of-center slender landmark guide this baseline. The detailed spire is an interpretation of the visible silhouette, not a newly named lore landmark.

`CITY_ASSET` contains only city geometry and editable ownership empties. `CITY.ProvisionalLayout` owns 21 district roots, two local arcaded-street connectors, and a separate retaining-infrastructure root. District roots independently move complete local buildings and terrace walls. Front, middle, and rear layers are explicit in `build.py`; the landmark belongs to a middle district. Connected palace wings, open tower lanterns, an octagonal tapered spire, flying masonry webs, intermediate pinnacles, and swept/gabled roofs break up the secondary-building families. Repeated buildings use linked mesh data, with fixed-seed variation in proportion, orientation, and placement. There are no linked external libraries or imported reference/studio objects in the saved file.

Z up, viewer from −Y, X lateral; nominal meter units are **provisional authoring scale**, not agreed gameplay scale. District positions, spacing, lower central basin, and ground cutoffs are editable proposals, not a locked framing corridor. `Infrastructure.SteppedRetainingFabric` owns connecting streets and the common architectural foundation. It is city support geometry, not a stage, separate gameplay platform, or terrain asset. Its cut-away underside and simplified backs are visible in the diagnostics. Final positions cannot settle until city and crowd exist; crowd is absent here.

No waterfall, mountain, foliage, sky vortex, monster, symbol, banner, HUD, stage, performer, or placeholder people were added. Those image embellishments are not automatically architectural requirements. Atmospheric depth is represented here by real overlapping depth layers, not obscuring fog. Atmosphere and final scene composition remain separate work.

### Construction and limitations

Six shared regions: `Limestone`, `Recess`, `Slate`, `Cornice`, `Gilt`, `Window`. Base saved materials are Audience; `build.palette()` supports the restrained violet alternative used in previews. Windows have separate emission, recess, and projecting stone-reveal geometry. No textures/UV maps, animation, collision, or glTF export. Linked Blender mesh reuse is **not** a claim of automatic runtime GPU instancing or an approved performance budget.

Meshes are closed, consistently oriented component shells. Masonry joints, roof/wall junctions, trim, and applied window reveals intentionally intersect; this is not a boolean-unioned watertight city or an interior model. Lancets are applied shallow facade details, not holes through the walls; lantern crowns and arcaded streets have actual open space. Hidden geometry is conservative. Backs and lower retaining foundations are intentionally simpler than the front architecture. No claim is made of exhaustive geometric self-intersection detection; intentional shell overlaps are part of construction.

The first neutral inspection exposed separated tile-like quarters and partly buried tower windows; these were corrected with connected retaining fabric and taper-aligned reveals. A subsequent close inspection found floating chimney ends; their roots now extend into the roofs. Intermediate spire pinnacles strengthen the transition into the surrounding wings. Architecture remains visibly more repetitive, less dense, and less organically irregular than the illustration; hidden foundations are much simpler than the concept's ravines. These are unresolved geometry/art limitations, not lighting issues. Provisional retention does not resolve them, and runtime reduction/baking would not by itself correct repetitive architecture.

### Reproduce into a new scratch output, never over the baseline

Requires the existing **Blender 5.2.1 LTS** and installed `cwebp`; no software was installed. Set `PACKAGE` to this directory and `WORK` to a new, existing scratch directory. Use absolute paths. Each Blender process is bounded externally; this task used 120 seconds for builds/checks and 240 seconds for six-view rendering, with `--python-exit-code` before `--python`.

```bash
blender --background --threads 8 --python-exit-code 1 \
  --python "$PACKAGE/build.py" -- --output "$WORK/city-rebuild.blend"
blender --background "$WORK/city-rebuild.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/validate.py" -- \
  --negative-test --report "$WORK/validation.json"
blender --background "$WORK/city-rebuild.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/preview.py" -- --output-dir "$WORK"
```

Add `--sources-root /absolute/repository` to validation to check the four separately approved `.blend` files and the approved city WebP against pinned hashes. A standalone relocated package needs none of them to build or validate its own model. Compare the reported `fingerprint` from separate builds; it covers mesh coordinates, topology/material indices, object ownership/world transforms, and authored material values, not nondeterministic `.blend` container bytes.

### Review cameras and presentation boundary

All cameras are temporary in `preview.py`. Cycles, 24 samples with denoising, AgX Medium High Contrast, three broad area lights, no compositor, bloom, fog, ground plane, or other assets. Neutral/detail/distance/reverse suppress emission and retain subdued material-region contrast. Detail is 1100 × 1300; other views 1600 × 900. Camera coordinates are authoring-space tuples:

| View | Position → target | Projection |
| --- | --- | --- |
| Neutral | `(30,-270,130)` → `(0,40,43)` | orthographic, scale 287 |
| Landmark detail | `(-100,-140,88)` → `(-61,39,68)` | orthographic, scale 118 |
| Distance | `(0,-355,60)` → `(0,35,43)` | perspective, 43 mm |
| Audience / Twilight | `(0,-300,62)` → `(0,38,46)` | identical perspective, 40 mm |
| Reverse | `(155,220,155)` → `(0,42,39)` | orthographic, scale 365 |

These diagnose geometry and approximate the concept's city-facing read; **none is the exact game camera**. Current `src/rendering/scene.ts` uses distinct scenery and runway perspectives (36° and 60°). No claim of exact gameplay projection, highway occlusion, responsive fit, final lighting, material fidelity in Three.js, or city/crowd composition is made. Warm and violet previews are both restrained twilight treatments, not daytime and nighttime.

### Verified baseline measurements — 2026-10-10

Blender 5.2.1 LTS saved/reopened successfully; build, validation, and render processes exited 0. Independent regeneration from copied scripts in a relocated directory (including a space in its path) matched the full geometry/topology/ownership/transform/material fingerprint:
`fcadd669651e3e97e452ce2aac2ae2df58c0a98734caa102409309156e9183cb`.
The maintained copy was reopened and validated again. The relocated preview also rendered successfully. Attempting to build over the maintained file correctly exited 1 with `FileExistsError`; its checksum stayed unchanged.

| Measurement | Actual |
| --- | ---: |
| All objects / mesh objects | 221 / 196 |
| Unique meshes / additional linked placements | 64 / 132 |
| Unique vertices | 87,554 |
| Unique triangles / triangles across placements | 149,012 / 500,928 |
| Materials / external textures | 6 / 0 |
| Bounds minimum | `(-133, -12, -13)` |
| Bounds maximum | `(133, 99, 118)` |
| Dimensions | `266 × 111 × 131` provisional units |
| Degenerate faces / nonmanifold edges / inconsistent-winding edges | 0 / 0 / 0 |
| Saved baseline file size | 1,018,264 bytes |

Every connected shell has positive signed volume. Ownership/isolation, material slots, finite geometry/transforms, distinct landmark height, lower central roofline, and three depth layers pass. The negative test renames the landmark in memory and confirms the missing-landmark invariant rejects it; it restores the name and never saves. These checks protect this baseline's composition, not a permanent runtime placement contract. Four approved source `.blend` checksums, approved city concept, and unchanged brief were verified. **`city.blend` SHA-256:** `4beb993e9b580bb0b6dd47e5523a0ad9aecc8c26804a4b4cbdc42cc5488caa2c` — identical before/after previews and byte-preserving promotion. All preview states shared geometry/transform signature `5ba1ed6a2eb5b06fa0d6c69fcf64775e1506269badee1058a76d2229e8906e83`.

Promotion reuses the existing renders and independent regeneration evidence; no model generation, rerender, optimization, baking, or export was performed. The promoted file was reopened and checked against the prior fingerprint/counts. Scripts have no hardcoded candidate-source path and remain unchanged, including the explicit-new-output guard. Embedded candidate-status properties remain historical to preserve exact source bytes; this README records the later provisional acceptance.

No performance budget has been approved; the placed triangle count is a measurement, not a runtime recommendation. Logs, intermediate PNGs, first-pass models, and relocated regeneration stay in task scratch, not this maintained package. No other source package or game file was changed. The modeling worker ran no issue/git operations, exports, or installations.
