# Brightvale platform end cap

## Current status

The isolated end-cap shape is approved. The user also supplied and intentionally recorded [`endcap-placement-reference.webp`](endcap-placement-reference.webp) as the controlling placement reference: a pair sits directly alongside the platform's outer sides, spanning its depth from tall rear/slopes down toward the front. They are not detached foreground pieces.

On **2026-10-10**, the user selected **“Approve and model”** for the bounded modeling/measurement/render plan (`shining-stars-4f4.19`), then explicitly selected **“Approve model”** after reviewing the fitted [`comparison-audience.webp`](comparison-audience.webp) and isolated [`neutral-endcap.webp`](neutral-endcap.webp) actual-model images. The parent recorded that approval in `.4f4.19`. [`endcaps.blend`](endcaps.blend) is now the **approved editable model**: the exact reviewed candidate was renamed, without resaving or changing geometry/materials. Approval covers this modeled pair and its measured platform fit, **not export or runtime integration**. The approved references and `brief.md` remain unchanged; the brief's earlier “no modeling authorized” text records the state before the later authorization and approval.

## Approved isolated shape

[`endcap-only-candidate.webp`](endcap-only-candidate.webp) is the approved isolated shape reference. It shows one sculpted/sloped midnight-blue form with gold edging in a three-quarter view on neutral ground; it establishes neither placement nor dimensions or fit.

- Current WebP derivative: 1356 × 1159 RGB; SHA-256 `6c6e670c8d9843f8c7058c6dc4abe37bdd3a3f3d8c6c6734ebc9d85762ae0b30`. User-converted lossy derivative accepted by the user for this purpose; this identifies current bytes, not the original PNG.
- Native original: `/home/rjroy/.codex/generated_images/01a12899-226a-77f1-9f4f-8f3590c73be3/exec-268174bc-8907-40d7-a1f4-00a4c78f2cd5.png`, generated 2026-10-10 with `codex exec --skip-git-repo-check`, Codex CLI 0.162.1, session `01a12899-226a-77f1-9f4f-8f3590c73be3`.
- Original native/durable PNG: 1356 × 1159 RGB; SHA-256 `370a7620a05301c5f800aa85aa5675537c1b2b82247a048454d67a23fc922b40` (historical original hash, not the WebP hash). The maintained PNG copy was removed; the native path is a provenance record, not an active project asset.

## Controlling placement reference

[`endcap-placement-reference.webp`](endcap-placement-reference.webp) is the user-supplied reference intentionally preserved to resolve placement. It shows the pair directly seated alongside the platform's outer sides, spanning platform depth: tall at the rear, sloping toward the front. It supersedes the earlier placement-only direction suggesting lower-corner caps partly cropped as detached foreground pieces. Reference dimensions 1200 × 800 RGB; SHA-256 `3f8ae01f505ea12665f5562c5d9134e60e30f5a1c9399f18ad109dc21faa62e8`. Its approval lineage is the user's supplied reference and recorded desired layout; it is not a generated concept, a new generation, or a new reapproval.

The placement reference itself is not measured geometry. The approved measured model and its limitations are recorded below; runtime integration remains unauthorized.

## Approved editable model and measured fit

- Blender **5.2.1 LTS**. Approved `endcaps.blend`: **188,006 bytes**, SHA-256 `c49ae80c34350ddb7281c3192c4ed90921852f0386fa047a9196087cc13b4207`. Pre-promotion candidate and post-promotion approved bytes match exactly; no duplicate candidate `.blend` is retained in this package.
- The actual saved approved `../neon-twilight-platform/platform.blend` was opened and measured—not rebuilt. Its actual SHA-256 before construction, after every build/validation/render batch and at final handoff is unchanged: `ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af`.
- Platform geometry bounds, excluding studio: min **(−6, −2.8, −0.45)**, max **(6, 2.7, 0.695)**; dimensions **12 × 5.5 × 1.145**. Chassis alone spans Y **−2.7…2.7**, Z **−0.3…0.3**. The crest adds the −2.8 front extent.
- X is left/right, front is **−Y**, rear **+Y**, up **+Z**. Scale is provisional authoring units, not meters. Each cap measures **0.98 × 5.5 × 1.8**. Left X **−6.98…−6**, right X **6…6.98**; both Y **−2.8…2.7**, Z **−0.65…1.15**. Pair bounds **13.96 × 5.5 × 1.8** include the empty center, not a new platform.
- Inner planar cheek faces touch X **±6.0**, with **zero nominal gap** and no positive-volume platform overlap. Silhouette bevels create small edge seams. No concealed mounting hardware/support is claimed. The foot sits **0.20** below the platform keel, **0.35** below chassis bottom, and **0.075** above the existing studio ground; that ground is not a gameplay attachment surface.
- Measured lane panels: X **±5.875**, Y **−1.95…2.45**, Z **0.24…0.44**. Lane borders/inlays group: X **±5.98**, Y **−2.59…2.57**. Hit-strip group: X **±5.34**, Y **1.17…1.73**, Z **0.32…0.43**. Crest including shoulders: X **±2.88**, Y **−2.8…−1.202205**, top Z **0.695**. Minimum lateral clearances to those groups are respectively **0.125 / 0.02 / 0.66 / 3.12**; caps never intrude into the platform's gameplay surface in 3D.
- One closed shaped mesh per side, with named **midnight-blue body** and **warm brushed-gold edging** material regions. Continuous profiled gold bands have **0.022** relief above the center; cross-bands wrap the leading crown and front foot. Integrated side cheeks are not separate floating plates. Editable silhouette bevel **0.023**, 3 segments, and weighted-normal modifiers remain unapplied. Origins sit at **(±6.49, 0, −0.65)**; unit scale, no negative-scale mirror. Normals were recalculated for each side.
- Collections explicitly separate the pair (historically named `CANDIDATE | endcap pair | UNAPPROVED`), `REFERENCE | approved platform v8.3 | read-only context`, and `STUDIO | accepted comparison rig`. Historical candidate collection/property status strings remain frozen inside the approved binary to preserve its exact bytes; **the user's recorded approval and this README govern current approval status**. The imported local reference has **53** original geometry objects and no external dependencies. It is review context, **not a second platform authority**; the sibling approved source remains authoritative. Never export the whole scene as an endcap asset.

## Actual render evidence and critique

All six selected WebPs were rendered from the exact saved model bytes now approved, converted losslessly using existing local `cwebp`, decoded/opened and visually inspected. Promotion reused this still-valid evidence without rerendering. Cycles **24 samples**, denoising, **1200 × 800**, AgX, exposure **0**. Previews are model-review evidence only.

- [`neutral-fit.webp`](neutral-fit.webp): **primary full-pair fit evidence**, neutral clay, no compositor/bloom; full-width orthographic diagnostic, **not a game camera**.
- [`neutral-endcap.webp`](neutral-endcap.webp): neutral-lit isolated right cap, actual named materials; shows sculpted slopes, cheek and gold-band joins.
- [`neutral-profile.webp`](neutral-profile.webp): orthographic side silhouette in clay, no floor/bloom. Front at image left; verifies the high rear, two sloping drops, shallow middle and low foot.
- [`neutral-pair.webp`](neutral-pair.webp): isolated pair at measured positions, neutral lights and actual material regions. The platform is hidden for this diagnostic only; empty center does not imply detached placement.
- [`comparison-audience.webp`](comparison-audience.webp) / [`comparison-twilight.webp`](comparison-twilight.webp): actual pair with actual approved platform, **same geometry and the exact saved accepted comparison camera**: perspective, **50 mm**, sensor **36 mm**, position **(0, −16, 12.5)**, unchanged rotation. World/floor/light values match the platform's accepted `mode-preview.py`; its restrained compositor is retained only in these mode comparisons. The wider pair's **outer edges are cropped by this unchanged camera**. The complete asset is visible in neutral diagnostics; no game-camera-fit claim is made.

One bounded visual refinement shortened/lowered the initial rear crown and added the reference's leading gold cross-band/front-foot band. The final evidence shows a coherent stepped profile and direct outer-side placement without a new focal feature. Remaining reference differences: the form is fitted to this actual platform rather than copied at an unmeasured concept scale; enamel is intentionally plain, without the concept's marbling or bright gold highlights, and small bevel/trim proportions differ. No visible detached components or broken profile seams were found in the inspected views. The user subsequently approved this model after reviewing the actual fitted Audience and neutral isolated-cap images; these are not runtime acceptance evidence.

## Regenerate and verify

`build.py` deterministically reads the sibling approved platform and writes only a **new** output directory, with required explicit `--output-dir` and generated filename `endcaps-candidate.blend`. It never overwrites approved `endcaps.blend` or saves/rebuilds the platform. New rebuilds retain historical candidate labels; generation alone does not approve a future revision. The approved `.blend` is self-contained; regeneration requires the sibling source in the same relative authoring layout. Scripts permit output only inside this package or `/tmp/opencode`, refuse existing outputs and have no session-specific input dependencies. `validate.py` defaults its geometry/material comparison to the stable approved `endcaps.blend`; `--compare` can explicitly select another preserved rebuild.

```bash
ASSET="$PWD/assets/authoring/brightvale-platform-endcaps"
WORK="$(mktemp -d /tmp/opencode/endcaps-check.XXXXXX)"
timeout 120s blender --background --python-exit-code 1 --python "$ASSET/build.py" \
  -- --output-dir "$WORK/rebuild"
timeout 120s blender --background "$WORK/rebuild/endcaps-candidate.blend" \
  --python-exit-code 1 --python "$ASSET/validate.py" \
  -- --compare "$ASSET/endcaps.blend" --report "$WORK/validation.json"
timeout 600s blender --background "$ASSET/endcaps.blend" \
  --python-exit-code 1 --python "$ASSET/preview.py" -- --output-dir "$WORK/previews"
```

Verified: saved candidate reopening; regeneration from packaged scripts in a **relocated scratch sibling layout**; exact evaluated mesh/transforms/material nodes against the selected candidate; exact imported reference geometry/materials and accepted camera against the approved source; source checksums unchanged. All build/validation/render processes exited **0**. A negative test displaced one cap **0.1** in memory: validation rejected it, wrote no report, and did not save the source.

Promotion verification: approved `endcaps.blend` reopened and passed the existing topology/fit/reference/material checks and comparison with the already-verified relocated scratch rebuild (exit **0**). Script syntax and maintained Markdown links passed. Missing explicit build output and an existing output directory were both rejected without writing. Approved model and platform checksums remained unchanged; no regeneration or render was needed for promotion.

Each cap has **80 editable vertices / 86 faces**, evaluating to **644 vertices / 656 faces / 1,284 triangles** with bevels. Total pair **2,568 evaluated triangles**, **2 materials / 2 objects**. Whole review scene has **47 meshes, 9 curves, 1 camera, 4 lights**; studio/reference counts are not endcap runtime costs. Both base and evaluated meshes have **0 non-manifold edges, 0 zero-area faces, 0 inconsistent winding edges**, positive signed volumes (~**6.6037** each). Profile surface rays, full-depth bounds, side adjacency, material count and key clearances pass. Validation does **not** exhaustively prove self-intersection absence or physical attachment.

No animation, collision, gameplay decorations, export, runtime/code/config changes, commit or integration. Runtime/Three.js material parity, game-camera visibility, physical scale and performance budgets are **not validated / unknown**. **User model approval is recorded; export/runtime integration still needs separate authorization and later integration approval.**

## Removed candidates and crop provenance (history only)

- The earlier full-sheet candidate (`concept-candidate.png`, original SHA-256 `c678754097c7cd1d8eb685eb90e900a18e7790f180ec70adec4a5550d5e84e44`) had rejected composition/placement; the user later accepted its isolated sculpted shape as a separate direction, not its composite. The file was removed. Its isolated-form reference crop was `(x=770, y=85, w=310, h=265)` from that 1536 × 1024 image. Neither removed parent nor scratch crop is an active reference.
- The intervening long-rail sheet (`concept-candidate-corrected.png`, original SHA-256 `e7bce4d10107099650aa55d0ac95edadca4a911d5c26dc031074c652af113088`) was superseded by the shape/placement clarification and removed; do not use it as a reference.
- Mockup crop coordinates were recorded for reproducibility, not as required assets: Golden City Rhythm Concert.webp (1672 × 941, SHA-256 `852751ea354e62f65a2f2554fd153959d6aa43746d8315320d84e6a3ac9d7114`), lower-left `(0,561,520,380)` and lower-right `(1152,561,520,380)`; Neon Twilight Rhythm City.webp (1536 × 1024, SHA-256 `1c1dbd8d887551e544daadea7305034f602049ede759400dce1783df790921a2`), lower-left `(0,644,520,380)` and lower-right `(1016,644,520,380)`. Scratch crops are not maintained assets.
