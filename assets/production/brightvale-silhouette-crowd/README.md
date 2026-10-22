# Brightvale silhouette crowd — approved waist-up source derivative

**Current derivative candidate: independent verification pending; runtime files
are untouched in this phase.** The user approved the recreated waist-up source
and authorized rebuilding the crowd at roughly 120 people. Follow the **vertical
neutral grip** of the new hand. The old 45° CCW direction and cancelled SVG route
are superseded. No staging, fade, fist, rim or anatomy repair was performed.

## Current source / exact derivative identity

- Approved source: `assets/authoring/brightvale-silhouette-crowd/pilot-candidate-waist-up.png`.
  SHA-256 `92cbcf67c40fea19978aaba31cb49ce0600f7bbfe886d7d076c34ce2b2d5c5ed`.
- **`crowd-atlas-waist-up.png`**, 1440 × 1120, lossless 8-bit RGBA,
  **512,733 encoded bytes**, **6,451,200 decoded base-level RGBA bytes**.
  SHA-256 `18622fe47a150ab19c4252ad677e203f23dfc7c798288eaa2aa1e9adc7a03bf5`.
- **`crowd-atlas-waist-up.json`**, source crops, 16 px gutters, UVs, common scale,
  new shoulder/palm anchors, waist-region annotation and vertical shaft endpoints.
  SHA-256 `a6365b70a217f7df7918619c27b7cd9ee9554867b39bdb4c71d856e176d53c0d`.
- **`validation-waist-up.json`** contains exhaustive decoded pixel/gutter checks,
  source landmark coordinates, palm alpha, preservation hashes and tool versions.

Distinct filenames keep the previous atlas/metadata and its review evidence
unchanged until the next phase explicitly switches consumers. This is one new
derivative, not a set of resolution/style variants. The old scripts are retained
byte-for-byte as `produce-chest-up.py` and `review-chest-up.py` for provenance;
the current `produce.py` and `review.py` use only the approved recreated source.

### Reproduction / inspection (project root)

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s assets/production/brightvale-silhouette-crowd -p test_produce.py
PYTHONDONTWRITEBYTECODE=1 python3 assets/production/brightvale-silhouette-crowd/produce.py
PYTHONDONTWRITEBYTECODE=1 python3 assets/production/brightvale-silhouette-crowd/review.py \
  --qa-dir .lore/local/evidence/silhouette-crowd
```

`produce.py --output <fresh directory>` reproduced the new PNG, metadata and
validation report byte-for-byte in a separate temporary directory. Existing
Python 3.14.8, zlib 1.3.2 and ImageMagick 7.1.2-34 Q16-HDRI were used; no installs.
Four existing converter unit tests passed unchanged, using test-owned pixels,
rectangles and scale. No runtime tests or full suite ran.

### Retained pixels, alpha and attachment contract

All four tiles retain original **1:1 source RGBA**, including the approved lower
fade. No opacity normalization, background cleanup, mirroring, recoloring,
resampling, diagonal rotation or source edit. All source pixels of alpha ≥2 are
retained; rectangular part crops omit 14,804 background specks of alpha 1/255
only. The 16 px RGBA edge extrusion is checked at every gutter texel. UV bounds,
packing nonoverlap and PNG decode roundtrip are checked too.

The body crops now cover the waist continuation. Each body includes
`lower_torso_source_rect_px` and `lower_torso_tile_rect_px`, explicitly marking
approved lower-chest/waist pixels for the consumer; these fields do not apply a
new fade. Use original straight alpha with sRGB interpretation, linear sampling,
`flipY=true`, clamp-to-edge and no mipmaps initially. Budgets and actual hardware
performance are unknown; decoded bytes are not a measured GPU-memory estimate.

All parts use 560 original pixels per provisional local unit, **not meters**.
Body origin is crop bottom-center, arm origin its new source shoulder pivot.
`card_bounds_local`, `shoulder_body_local`, `grip_arm_local` and shaft endpoints
already encode those origins: do not separately normalize sizes or apply offsets
twice. Body is in front of the arm; original palm occludes the shaft and halo.
The approved arm rises across/above the head; its original pose is retained,
not silently mirrored or rotated into an older pose.

Neutral stick endpoints have identical X through the opaque palm center
(alpha 253/255 for both figures). Stick/core/halo follow the arm's normal wave.
**Do not add the old 45° correction.** Image-space wave θ still maps to Three.js
`rotation.z = -θ*pi/180`; +Y source pixels map to −Y local coordinates.

### Exact inspected QA evidence

Opened the saved atlas and these new local inspection outputs:

- `.lore/local/evidence/silhouette-crowd/waist-up-atlas-packed-inspection.png`
- `.lore/local/evidence/silhouette-crowd/waist-up-atlas-assembled-inspection.png`
- `.lore/local/evidence/silhouette-crowd/waist-up-atlas-inspection-report.json`
- `.lore/local/evidence/silhouette-crowd/waist-up-atlas-production-review.md`

Both figures are reconstructed from actual atlas pixels at a common scale,
with new pivots/grips, neutral vertical sticks and ±15° wave endpoints. The
shoulder detail is shown on lighter ground; source cap/rim pixels and fades are
retained as approved, with no preview-only repair. This validates packing and
assembly, not GPU sampling, runtime acceptance or a 120-person composition.

### Next runtime phase (after independent verification)

1. Switch the PNG/JSON imports in `src/rendering/brightvale/silhouette-crowd-assets.ts`
   to the distinct waist-up files; retain bundle ownership and abort cleanup.
2. In `silhouette-crowd.ts`, use the new metadata/anchors and configure the
   authorized approximately-120 population; tests continue to own their small
   configurations rather than asserting production count/tuning constants.
3. Preserve source vertical shaft endpoints and current shared grip/wave chain.
   Handle existing lower alpha reasonably in the consumer; do not repaint or
   improve the user-approved source or stage the city/rails in this work.
4. Recheck updated sweep bounds and show the actual muted rebuilt app promptly.
   Independent tests/technical review follow; no new source-art approval gate.

---

# Historical chest-up pilot atlas record (superseded)

**Candidate for independent derivative verification; not runtime acceptance.**
The user approved the exact shoulder-cleaned source and explicitly authorized
reproducible derivatives plus a later bounded game pilot after derivative
validation. This package implements the derivative phase only. No runtime,
tracker, tuning, original artwork or existing crowd assets changed.

## Source and exact derivative identity

- Approved master: `assets/authoring/brightvale-silhouette-crowd/pilot-candidate-shoulder-cleaned.png`.
  SHA-256 `9f5785def1d7bec9339b908a6e926b370a1715196af26bf2d9524f87624598ba`.
  Its authoring README preserves generation, cleanup and approval provenance.
- [`crowd-atlas.png`](crowd-atlas.png): **1424 × 896**, lossless 8-bit straight RGBA,
  **435,322 encoded bytes**, **5,103,616 decoded base-level RGBA bytes**.
  SHA-256 `729055f44eb4c15879053b8230162565385e9d43dd4824aca4d06a466f03c2a1`.
- [`crowd-atlas.json`](crowd-atlas.json): versioned tile/attachment contract.
  SHA-256 `5e46f1b3ad04370787e8887089dcc49d6d4a07e239affdeabd62e6b8f4459a35`.
- [`validation.json`](validation.json): original hashes, pixel/gutter checks,
  measured sizes, tool versions and limits. Measurements are not budgets or GPU
  memory/performance claims.

No lossy conversion, scaling, rotation, RGB cleanup, alpha normalization or
premultiplication occurred. Each of the four packed tile contents is byte-for-byte
identical to the same approved-source crop used by the successful assembled
preview. All crops retain their existing transparent margins and receive an
additional **16-pixel nearest-edge RGBA extrusion** on all sides. Padded regions
do not overlap. Those crop boundaries exclude 4,522 source background specks of
alpha **1/255 only**; no original pixel with alpha ≥2 is excluded. This is the
same crop scope as the accepted assembly, not a hidden new silhouette edit.

The atlas is intentionally NPOT: Three.js 0.186.1/WebGL2 supports it. Source
resolution is retained until actual gameplay projection is measured. No final
texture, population, frame-time or mobile-memory budget has been agreed.

## Reproduction and checks

Existing tools only: Python **3.14.8**, zlib **1.3.2**, ImageMagick **7.1.2-34
Q16-HDRI** (decode/QA only). PNG output uses deterministic Python/zlib encoding;
reproduction was verified byte-for-byte with these versions. A different zlib
version may encode different PNG bytes despite identical decoded pixels.

Run from project root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s assets/production/brightvale-silhouette-crowd -p test_produce.py
PYTHONDONTWRITEBYTECODE=1 python3 assets/production/brightvale-silhouette-crowd/produce.py
PYTHONDONTWRITEBYTECODE=1 python3 assets/production/brightvale-silhouette-crowd/review.py \
  --qa-dir .lore/local/evidence/silhouette-crowd \
  --reference-report .lore/local/evidence/silhouette-crowd/assembled-preview-shoulder-cleaned-report.json
```

`produce.py --output <directory>` supports a separate reproduction directory.
An independently created `/tmp/opencode/` temporary output was compared with the
maintained PNG, JSON and validation report: all three reproduced byte-for-byte.
Build logs mark source read and successful validation. The generator checks
approved source identity, complete tile pixel identity, every gutter pixel,
packing bounds/nonoverlap, excluded-alpha scope and preservation of all three
source images. Four pure unit tests use tiny test-owned RGBA fixtures for crop,
extrusion, rectangle and coordinate math; they do not depend on mutable artwork.

QA outputs are local, not runtime assets or duplicate production derivatives:

- `.lore/local/evidence/silhouette-crowd/atlas-packed-inspection.png`
- `.lore/local/evidence/silhouette-crowd/atlas-assembled-inspection.png`
- `.lore/local/evidence/silhouette-crowd/atlas-inspection-report.json`
- `.lore/local/evidence/silhouette-crowd/atlas-production-review.md`

`review.py` extracts **the actual saved atlas pixels**, uses the JSON pivots and
grips, and reassembles both figures at −15° / 0° / +15°. Reference landmark,
affine-transform and stick/grip coordinate error was **0 original pixels**.
All six main-figure comparison regions and lighter shoulder insets also matched
the approved source-preview RGBA pixels exactly (different labels excluded).
The native atlas, lighter-ground packed view and exact six-pose image were
opened and reviewed: no visible crop, color, alpha or attachment regression.
Accepted small rigid-shoulder contour notches remain visible in the lighter
insets; no new repair or preview-only masking conceals them.

## Consumer contract (for the next authorized phase)

- `parts[].tile_rect_px` is the content, **not** the padded rectangle. Rectangle
  origin is top-left; shape is `[x,y,width,height]`, half-open. Use its normalized
  `uv_rect_bottom_left` with ordinary bottom-left plane UVs and texture `flipY=true`.
  Do not add a second atlas flip or inset by the gutter size.
- All four parts share **560 original pixels per provisional local unit**.
  There is no approved world-meter mapping. Do not independently normalize arm
  and torso heights. `card_bounds_local` is `[left,bottom,right,top]` in an XY
  card plane, +X right, +Y up, +Z toward viewer, relative to `origin_px`.
- Body origin is the crop's bottom-center (including its source margin); arm
  origin is its shoulder pivot. Position arm origin at
  `figures[].shoulder_body_local`, then rotate the arm/stick together. Image
  inspection angle θ corresponds to Three.js `rotation.z = -θ * π / 180`.
  Grip/stick points are already arm-local; do not apply the shoulder translation
  twice. Body sway wraps the complete chain.
- Body lies just in front of its arm; the original fist lies in front of stick
  core/halo. Small consumer depth offsets remain to be chosen and tested. Each
  torso omits one arm: attach its matching arm even without a glow stick, or
  deliberately occlude the omission with another figure. The torso alone is
  not a complete neutral-person sprite.
- Treat original untagged RGB as **sRGB color**, exactly as the approved QA did;
  this is an interpretation, not verified source calibration. Preserve straight
  alpha (`premultiplyAlpha=false`). Use `ClampToEdgeWrapping`, linear min/mag
  filtering and **`generateMipmaps=false`** for this pilot contract. Sixteen-pixel
  gutters are not proof of arbitrary mip-level isolation. Far-card shimmer,
  alpha-test threshold and actual Three.js color/UV behavior need app review.
- Sticks/halos are not baked into this atlas. `inspection_color` and stick
  endpoints reproduce the accepted QA, not new user tuning or final colors.

## Independent review and next behavior checks

`.lore/lore-agents.md` is absent; no project-specific reviewer is specified
there. Recommended next review is an independent technical reviewer (Oracle)
to recheck source hash, all pixel/gutter identities, UV conventions, scales and
attachment math before integration. Designer's present review establishes only
this CPU visual derivative comparison, not acceptance of the game scene.

Next runtime tests should use test-owned atlas metadata fixtures for UV corner
orientation, card bounds, common scale, arm/grip transforms, reduced-motion/time
determinism, animation bounds and disposal. Use this real package in a separate
integration-contract check. Then inspect the actual game in both twilight
palettes, victory, narrow layouts and on available mobile hardware; do not claim
CPU assembly validates GPU filtering or device performance. Existing runtime
asset/composition tests must be updated only after test-first implementation is
authorized for that phase. No runtime/full-repository suite was run here.
