# Silhouette crowd pilot candidate

## Current approval

The user explicitly approved the recreated `pilot-candidate-waist-up.png`, SHA-256
`92cbcf67c40fea19978aaba31cb49ce0600f7bbfe886d7d076c34ce2b2d5c5ed`,
and requested rebuilding the crowd at roughly 120 people. The **new hand holds
the stick vertically**; the prior 45-degree counterclockwise instruction is
superseded. This source is the current authority; the cancelled SVG extension
and older candidates are history, not visual anchors for this rebuild.

Derivative-only preparation lives in
[`../../production/brightvale-silhouette-crowd/`](../../production/brightvale-silhouette-crowd/).
The new atlas retains the approved pixels and lower alpha without repairs or
restyling; it awaits independent derivative verification before runtime wiring.
Earlier reviewer concerns below are historical and superseded by the user's
exact-source acceptance, not ongoing requests to alter fists, rims or fade.

Later inspection corrected the initial alpha concern: 86.5% of nonzero pixels
have alpha at least 250, and 94.9% of covered interior neighborhoods meet that
threshold. The interiors are near-opaque; partial-alpha counts alone did not
establish a transparency defect. Assembled previews also confirmed usable grips.

Status: single generated candidate, awaiting exact-artwork review; not approved for derivatives or runtime. Task: shining-stars-evk.2. Generated 2026-10-21 with built-in Codex image_gen (model/version not exposed). Exactly one generation; no reroll, image editing, resizing, keying, or runtime integration.

Native staging path: /home/rjroy/.codex/generated_images/01a16167-0fdd-7c03-8d3b-78b299848ccf/exec-018d1e4e-2bc4-4209-8474-904027185c26.png

Preserved byte-identical native original: pilot-candidate.png

SHA-256: d3ccd17ebda314ba3c686b6fa229749867a4efe4cb8c36611bfb4572fbd57a3d

Actual output: 1254 × 1254 PNG, 8-bit RGBA, not the requested 2048 × 2048. PNG chunks: IHDR, caBX, IDAT, IEND; no explicit ICC/sRGB/gamma declaration. Color space is therefore untagged, not verified.

Alpha verification: decoded PNG scanlines using Python standard library; 1,177,108 fully transparent pixels, 394,493 partial-alpha pixels, 915 fully opaque pixels. Genuine alpha is present, but the unusually extensive partial transparency needs review. No background removal or alpha changes were performed.

Visual findings: four intended body/arm parts are visible; anonymous front-facing heads and empty grips are present. Rim accents are substantially more continuous and brighter than requested; internal torso modeling is more visible than the flat silhouette brief. Body A crosses the intended vertical cell boundary. Nonzero alpha reaches cell edges, so approximately 8% transparent padding and strict one-isolated-part-per-cell requirements are not met. Native artwork is preserved as generated. No assembly or diagnostic resized derivatives were created under the user's no-derivatives constraint. Candidate has material brief deviations; do not treat this record as approval or production readiness.

## Exact generation prompt

```text
Use case: stylized-concept
Asset type: production 2D game crowd silhouette part sheet, exactly ONE candidate for exact-artwork review.
Create a 2048 x 2048 square RGBA PNG with GENUINE ALPHA TRANSPARENCY. No painted checkerboard or background. Four equal invisible cells in a 2 by 2 grid, one isolated part per cell. Top left body A; top right matching detached arm A; bottom left body B; bottom right matching detached arm B. No grid lines, text or labels. About 8% completely transparent padding inside every cell; no part touches cell edges.
Subjects: two distinct anonymous human head/shoulder/upper-torso silhouettes, natural adult anatomical proportions, audience members FACING THE PLAYER / VIEWER / PERFORMER, front-facing heads and shoulders, never rear views. Anonymous solid near-black faces with NO readable facial features. Two slightly different natural head shapes and shoulder builds. No readable clothes, fabric, logos, costume or ornamental hair detail. Lower torsos broad and organically tapered/rounded for overlap behind nearer people, no rectangular straight cutoff.
Each body OMITS its raised right arm (viewer's left shoulder), leaving a natural shoulder attachment region; other arm quiet and merged into torso. Each matching separate right arm is ONE connected shoulder-to-upper-arm-to-softly-bent-elbow-to-forearm-to-hand silhouette, raised upward, anatomically sized to its matching body. Keep shared pixel anatomical scale between bodies and arms: do not enlarge the arms to fill their cells. Shoulder end broad enough to overlap invisibly under matching body. Hands visibly form an EMPTY stick grip with a small transparent opening between curled fingers and thumb, clearly readable as grasping an absent narrow upright stick. Absolutely no stick or object in either hand. Single connected silhouette per cell.
Style: crisp high-quality clean 2D near-black interiors; extremely restrained discontinuous thin warm-neutral rim accents on a few selected edges only. Flat anonymous shapes, no internal clothing shading. Consistent style and front-view framing across all four parts. No complete luminous outlines, baked shadows, glow sticks, halos, bloom, scenery, extra parts, extra limbs, animation, lettering or watermarks.
Transparent background is mandatory; preserve actual alpha pixels and soft antialiased edges.
```

## Recreated waist-up sheet (approved source; generation record)

The user authorized a fresh recreation; earlier candidates were experiments, not visual anchors. This new source is not required to preserve earlier head, hair, body, or arm shapes. The exact file/hash was subsequently approved and the crowd rebuild authorized, with independent derivative verification before runtime work. Generated 2026-10-22 with configured built-in Codex imagegen via codex-cli 0.163.0; image model/version not exposed. Exactly one generation, no reroll or image edits.

Native staging: `/home/rjroy/.codex/generated_images/01a161f7-438f-77d3-91ff-1a1cb70ead2a/exec-5c844c23-a932-4aa4-b0e8-f0be3c610789.png`. Byte-identical candidate: `pilot-candidate-waist-up.png`. SHA-256: `92cbcf67c40fea19978aaba31cb49ce0600f7bbfe886d7d076c34ce2b2d5c5ed`. First experiment and corrected experiment remain preserved unchanged at `pilot-candidate.png` and `pilot-candidate-revised.png` with hashes above.

Actual output: 1254 × 1254 PNG, sRGBA, sRGB colorspace as identified by ImageMagick, no embedded profile reported. Requested 2048 × 2048 was not supplied. Alpha extracted and counted by ImageMagick: 1,171,027 fully transparent pixels, 82,932 with alpha 1–252, 256,920 with alpha 253–254, and 794 fully opaque pixels. The 253/254 pixels are nearly opaque, not transparency failures; the opacity distribution is still a concern because opaque interiors are nearly absent and the opaque-pixel count alone does not establish solid interior coverage. Alpha is present, but the background shows substantial scattered partial-alpha speckling, visible as noisy matte artifacts on both dark and light composites.

Historical pre-approval visual review: two front-facing audience figures and corresponding detached arms are present, with waist continuation and a soft lower fade. The reviewer raised concerns about hands for the then-requested diagonal stick, rims/details, padding and alpha speckles. The user accepted this exact artwork, liked the concert-participant look, and superseded the diagonal instruction with a vertical grip. These historical concerns are not current quality failures or authority for source repair. No retry was made.

QA-only evidence, not source art or production derivatives: `inspection-waist-up-dark-light.png` contains dark and light composites of the untouched source; `inspection-waist-up-overlap.png` shows a small repeated-bank context. Composite inspection confirms noisy alpha/matte artifacts. The still-generated arms are not attached to bodies in these source-sheet QA views; final attachment and 45° stick pivot are runtime concerns, not tested here.

### Exact prompt sent to the authorized Codex route

```text
Task-specific authorization: User explicitly authorizes RECREATE production artwork through this configured Codex image route. Generate exactly ONE new coherent production sheet for review. Earlier candidates were experiments, not immutable visual anchors; do not preserve their heads/arms as visual references. Do not overwrite or delete any existing source/evidence. Destination will be copied after generation to assets/authoring/brightvale-silhouette-crowd/pilot-candidate-waist-up.png. Report native absolute output path. No rerolls, no derivatives, no runtime integration, no unrelated file changes.

Current planning file .lore/local/plans/silhouette-crowd.md has obsolete controlled-SVG extension instructions: disregard that authoring route. Use this approved revised brief instead:

Purpose: source parts for a large layered audience crowd, eventually roughly 120 simple figures. Judge anonymous crowd readability, not standalone character realism. Two varied anonymous near-black natural human silhouettes FACING PLAYER/viewer, genuine waist-up anatomy. Show head, neck, shoulders, chest and torso continuing through waist. The torso should softly fade in alpha below the chest toward the lower waist edge, not stop at a hard chest crop. Flat simple shapes, no detailed facial features, clothing/fabric/folds/logos, muscles/chest modeling, elaborate hairstyles/hair ornaments. Preserve natural human proportions without individual character portrait detail.

Sheet: request square 2048 × 2048 RGBA with four equal cells, one part each: body A, matching detached raised arm A, body B, matching detached arm B. Use ample transparent padding, no parts touching/crossing cell edges. Match anatomical scale across each body's shoulder and its arm. Bodies omit the raised arm at one shoulder. Each corresponding detached arm is a single connected shoulder-to-hand shape, softly bent, anatomically scaled and visibly attachable at that shoulder. Hands should plausibly grip a stick whose visible direction is ~45 degrees counterclockwise from a near-upright orientation in the camera plane; make the palm/finger shape read as holding a stick oriented on that diagonal, without drawing the stick. Runtime stick later pivots at palm. Do not include any baked stick, halo, glow, shadow, scenery, labels, grid lines, text, animation, or extra parts.

Material: genuine transparent background and real alpha. Silhouette interiors should be near-black and effectively opaque; partial alpha belongs at antialiased edges and intentional softly faded lower torso only. Distinguish torso fade from unintended translucent head/arm/body interiors. Sparse subdued discontinuous warm-neutral rim accents only; no bright/full outline. Set remains cohesive and simple, suitable for repeated overlapping crowd use.

Generate actual artwork with normal image output. Report native absolute path and actual dimensions. If alpha is not real or output materially misses the brief, report that; do not try again.
```

## Corrected candidate (single authorized correction)

Status: separate revised candidate, awaiting exact-artwork review; neither version is approved. User authorized one corrected generation after the first review. Generated 2026-10-22 with the configured built-in Codex image_gen route, codex-cli 0.163.0; image model/version not exposed. No additional reroll, edits, alpha keying, atlas conversion, or runtime integration.

Native staging path: `/home/rjroy/.codex/generated_images/01a1617c-1a36-7180-830e-e52010d1e704/exec-6dc8c167-e712-4b3e-8ecb-56c81a0b5632.png`.

Durable byte-identical copy: `pilot-candidate-revised.png`. SHA-256: `da92baf81297a97b5e529095b942aac7dd3d60d1ad854d9608e554eadad34545`. First candidate `pilot-candidate.png` remains unchanged, SHA-256 `d3ccd17ebda314ba3c686b6fa229749867a4efe4cb8c36611bfb4572fbd57a3d`.

Actual revised output: 1254 × 1254, 8-bit RGBA PNG (not requested 2048 × 2048). PNG has no explicit ICC/sRGB/gamma declaration; color space is untagged and not verified. Decoded alpha counts: 1,169,312 fully transparent; 402,307 partial-alpha; 897 fully opaque. Thus genuine transparency exists, but the requirement for substantially opaque interiors with partial alpha limited to edge antialiasing is not established by the few opaque pixels and is not met reliably: most visible subject pixels are partially transparent. Do not treat mere opaque-pixel presence as opaque interiors.

Visual inspection: four parts are separated within their intended quadrants and none crosses the center cell boundaries. They still approach outer cell boundaries, so ample safe padding is not achieved. Bodies face the player, but torso anatomy/shading remains modeled rather than flat anonymous silhouettes; hair ornament remains visible on body B. Rims are still conspicuously continuous, contrary to the sparse subdued target. Raised arms terminate in closed fists, not clearly readable empty stick grips. At diagnostic body heights 64/128/192 px the reduced parts remain visible, but the hand/grip is not legible as the intended grip. These are material remaining deviations; exact artwork approval is pending.

Inspection evidence (QA composites/views only, not production derivatives): `inspection-revised-dark-light.png` displays the untouched source composited on dark and light backgrounds; `inspection-revised-size-64.png`, `inspection-revised-size-128.png`, and `inspection-revised-size-192.png` are diagnostic assembly previews. No image was edited or promoted. Candidate hash is the identity required for any later approval.

## Corrected candidate generation prompt

```text
Task-specific authorization: User explicitly authorized exactly ONE corrected production candidate for task shining-stars-evk.2 via this configured Codex image route, review only. This is a single bounded correction; do not reroll, generate alternatives, or create derivatives. Preserve the prior candidate unchanged. Report absolute native output path(s). Do not modify unrelated project files.

Approved brief: .lore/local/plans/silhouette-crowd.md, with user correction: figures FACE PLAYER/PERFORMER. Produce one square source sheet with four equal cells and one isolated part per cell: body A, matching detached arm A, body B, matching detached arm B. Request 2048 × 2048; actual output may differ, report actual. Maintain generous transparent padding (at least roughly 10% within each cell), no part touching/crossing cell boundaries. Match natural human anatomical scale across body and arm. Each body omits the raised limb. Each corresponding arm is one anatomically connected, softly bent shoulder-to-hand shape with a clear empty stick grip, sized to attach naturally under that body's shoulder.

Visual direction: front-facing audience heads/shoulders toward player/viewer; anonymous, natural human silhouettes; flat near-black bodies with NO breast/chest modeling, clothing folds, fabric, costume, hair ornament, or internal anatomical modeling. Very sparse, subdued, discontinuous warm-neutral rim accents only on selected edges, never a complete outline. Actual RGBA transparency in background; interiors should be genuinely near-black and substantially opaque, with partial alpha limited to antialiased edges. No checkerboard, scenery, text, labels, sticks, halos, glow, shadows, animation, or extra parts. No readable facial features.

Generate actual production art with the normal image-output mechanism. Do not modify unrelated project files. No resizing, editing, alpha keying, derivatives, runtime integration, or second attempt. Report native absolute path.
```

## Localized shoulder-cleanup candidate (explicitly authorized non-generative edit)

**Approved authoring source:** `pilot-candidate-shoulder-cleaned.png`, SHA-256
`9f5785def1d7bec9339b908a6e926b370a1715196af26bf2d9524f87624598ba`.
Exact-artwork approval was granted by the user. This is an approved authoring source,
not a production atlas, runtime asset, or authorization to integrate.

The user explicitly authorized removing the highlighted shoulder seams at both
torso/arm interfaces while preserving everything else and the originals. Input
is the revised generated original above, SHA-256
`da92baf81297a97b5e529095b942aac7dd3d60d1ad854d9608e554eadad34545`.
No image generation, new anatomy, silhouette reshaping, resizing, global rim
restyling, alpha normalization, or grip edits were performed.

Reproduce from project root:

```sh
python3 assets/authoring/brightvale-silhouette-crowd/cleanup-shoulders.py
python3 .lore/local/evidence/silhouette-crowd/assembled-preview.py \
  --source assets/authoring/brightvale-silhouette-crowd/pilot-candidate-shoulder-cleaned.png \
  --expected-sha256 9f5785def1d7bec9339b908a6e926b370a1715196af26bf2d9524f87624598ba \
  --output-name assembled-preview-shoulder-cleaned --shoulder-cleanup
```

The maintained `cleanup-shoulders.py` decodes the original with ImageMagick
7.1.2-34 Q16-HDRI, changes RGB only, and encodes a fresh 1254 × 1254, 8-bit RGBA PNG
using Python standard-library PNG/zlib code. The candidate has IHDR/IDAT/IEND
chunks only: no copied generation credentials or claimed calibrated color
profile. Original untagged RGB and alpha are otherwise preserved; inspection
assumes sRGB without changing the source values.

### Exact pixel-edit scope

Coordinates refer to the original 1254 × 1254 sheet; boxes are half-open
`[x0,y0,x1,y1]`. Existing nontransparent pixels inside a capsule around each
listed line segment blend toward RGB `(11,11,12)`. Blend is full inside the inner
radius and cosine-feathered to zero at the outer radius. The four boxes bound
every change; these are cut-face/adjacent-rim fills, not rectangular patches.

| Attachment | Bounding box | Segment start → end | Inner / outer radius | Changed pixels |
| --- | --- | --- | --- | ---: |
| A torso | `[566,309,648,454]` | `(589,329)` → `(627,417)` | 17 / 28 px | 3,660 |
| A arm root | `[821,352,905,503]` | `(846,374)` → `(855,478)` | 19 / 39 px | 5,603 |
| B torso | `[533,925,619,1062]` | `(560,947)` → `(598,1027)` | 17 / 28 px | 4,028 |
| B arm root | `[819,949,907,1110]` | `(848,979)` → `(850,1080)` | 19 / 39 px | 5,362 |

All-pixel verification found **18,653 changed RGB pixels, zero changed alpha
pixels, and zero changed pixels outside these shoulder boxes**. The saved PNG
decodes exactly to the intended edited buffer. Both generated originals retain
their hashes recorded above. Previous assembled comparison PNG, report and
review remain unchanged; the reusable inspection script now accepts an explicit
candidate/hash and separate output name.

### Repeated inspection and recommendation

Opened the exact cleaned source and
`.lore/local/evidence/silhouette-crowd/assembled-preview-shoulder-cleaned.png`.
Both figures use the same original landmarks, grips, stick geometry, scale,
layering and −15° / 0° / +15° poses as the preserved comparison. Larger shoulder
crops remain on lighter gray; no extra preview-only masking hides the joins.
Transform/grip checks passed for all six poses.

The bright oval cut-face seams are removed and the figures read much more like
connected silhouettes. Grips still work. Small angle-dependent contour notches
and subtle tonal changes remain at the rigid shoulder joins, most apparent in
the enlarged lighter-background insets and at +15°. These are not claimed to be
perfect anatomical deformation. The existing continuous outer rims, body/hair
details and source packing are unchanged by design.

**Historical designer recommendation before user approval:** present this bounded improvement for exact-artwork
approval; do not launch another reroll or broaden the cleanup. Residual rigid
join artifacts are modest compared with the original highlighted seams. Actual
animated crowd overlap, smaller projected assemblies, runtime color/depth and
mobile performance remain unvalidated and require later authorization.

Inspection records: `.lore/local/evidence/silhouette-crowd/shoulder-cleanup-report.json`,
`assembled-preview-shoulder-cleaned-report.json`, and
`assembled-preview-shoulder-cleaned-review.md`. These are local QA evidence,
not promoted production derivatives.

Alpha clarification from the earlier read-only review: the revised original's
large partial-alpha count does **not** establish translucent interiors. 86.463%
of its nonzero-alpha pixels were at least 250/255; 253–254 dominated. This cleanup
preserves all original alpha values exactly.

## Authorized pilot derivative handoff

The user approved the exact shoulder-cleaned hash above and explicitly
authorized reproducible production derivatives plus a later bounded runtime
pilot after derivative validation. Derivative preparation is recorded in
[`assets/production/brightvale-silhouette-crowd/README.md`](../../production/brightvale-silhouette-crowd/README.md).
The atlas and attachment metadata preserve the approved source pixels and the
successful six-pose attachment coordinates; source/original hashes were checked
unchanged. This handoff awaits independent derivative verification and does not
claim runtime integration or runtime acceptance.
