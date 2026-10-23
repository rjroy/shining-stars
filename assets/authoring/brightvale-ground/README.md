# Brightvale ground texture authoring

## Artwork approval

The user approved the plaza image with “works for me” on 2026-10-15 after
reviewing the combined 3×3 repeat sheet. The city candidate was subsequently
replaced on 2026-10-22 with the exact user-approved `/home/rjroy/Downloads/canopy-tileable.png` input. Approval hashes:

- City Ground: `d47a99fe8eb8e78465bd68399b5e27f71f184057c2578691e2dcc96315e5d09f`
- Audience Plaza: `08cad37f87a9a9204d63b7faba174d9d0959cbb4cd7922fac19513a3a3b244ed`

Approval authorizes the textures at their canonical runtime paths and the
runtime scale/integration check for these surfaces only. Actual-app runtime
acceptance remains pending.

- Full brief: [brief.md](brief.md)
- Original combined 3×3 repeat review (the previous city texture): [WebP presentation](ground-textures-repeat-review.webp).
- Earlier per-texture 2×2 review images: [City Ground](city-ground-2x2.webp) · [Audience Plaza](audience-plaza-2x2.webp).
- Reproducible source correction/review tool: [seamless-tile.py](seamless-tile.py).
- Reproducible city normal-map recipe: [build-city-normal.py](build-city-normal.py).

The canonical runtime textures are `../../production/brightvale-ground/city-ground.png`
and `../../production/brightvale-ground/audience-plaza.png`; these are the only
maintained final PNGs. The original generated city source is retained as
`city-ground-source.png`, and the plaza source as `audience-plaza-source.png`.
The city texture was later replaced by the exact approved input recorded below.
The user approved `/home/rjroy/Downloads/canopy-normal.png` for a runtime
experiment on 2026-10-22; it is installed as the single canonical
`../../production/brightvale-ground/city-ground-normal.png` runtime map.
The current runtime textures are opaque 8-bit RGB PNGs, 1254×1254, intended for
sRGB sampling. The requested 1024×1024 was not emitted; no resizing or lossy
conversion was applied. File and GPU-memory budgets remain unknown.

## Provenance and hashes

The plaza source was generated with the built-in Codex image route on
2026-10-15. The City Ground source row records the later user-approved direct
replacement input. Source paths and canonical runtime SHA-256 hashes:

| Surface        | Source/provenance                                                                                                        | Source SHA-256                                                     | Canonical runtime SHA-256                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| City Ground    | `/home/rjroy/Downloads/canopy-tileable.png` (user-approved exact replacement, 2026-10-22)                                | `d47a99fe8eb8e78465bd68399b5e27f71f184057c2578691e2dcc96315e5d09f` | `d47a99fe8eb8e78465bd68399b5e27f71f184057c2578691e2dcc96315e5d09f` |
| Audience Plaza | `/home/rjroy/.codex/generated_images/01a1405c-b408-74e1-b6b2-b643766a792d/exec-b4419dd0-46a7-4bd2-a194-ef176043cac1.png` | `bb1df477b9ffa795df019b308e099aefbda58904484737e2d6fc66915ab5854b` | `08cad37f87a9a9204d63b7faba174d9d0959cbb4cd7922fac19513a3a3b244ed` |

The approved normal candidate SHA-256 is
`f0009dc49e74439b8d8b735f6605272a9342db7e5029b781c02028d1cae8fe2`. The
recipe derives Rec.709 luminance, combines periodic Gaussian scales (9.0 px
base and 1.4 px detail) at 0.78/0.22, computes periodic centered gradients
with 0.035 slope scaling, flips image-row direction into texture +V, normalizes
and encodes tangent-space RGB. `python3 build-city-normal.py` reproduces the
runtime PNG pixels from the canonical city diffuse texture using Python NumPy
and ImageMagick; `--preview <path>` optionally writes a separate flat-versus-
normal preview. No preview is part of runtime output.

The retained City Ground generated source was the second generated grass image
after a first candidate showed obvious joins; it is historical and is not the
current runtime texture. The plaza source was the first, more detailed
blue-violet stone generation; a targeted Gaussian softening reduced its noisy
mineral detail. A later nearly uniform plaza attempt was not retained.

## Seam correction and validation

`seamless-tile.py` uses Python standard library and ImageMagick **7.1.2-31**.
It blends a 64-pixel band at opposing edges, wraps horizontally and vertically,
then asserts exact RGB equality of the first/last pixel on every row and column
(including corners). Plaza detail uses a 42-pixel Gaussian blur before edge
correction; the earlier City Ground review used no blur. This preserves each
source and makes that correction reproducible. Repeat previews are built from
the corrected temporary images without added image changes. This tool is for
authorized source processing/review; it is not a production-copy step.

The approved replacement city input is transferred byte-for-byte rather than
passed through `seamless-tile.py`; that correction would alter the exact
approved artwork. Consequently, the prior edge-equality/seamless validation is
not claimed for this replacement. Any seam concern requires separate user
authorization to alter the input.

From this directory (repeat PNG intermediates stay in a new temporary
directory; WebPs go to a new output directory, never over existing evidence):

```sh
set -euo pipefail
scratch=$(mktemp -d "${TMPDIR:-/tmp/opencode}/ground-review.XXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
destination="${1:-$PWD/ground-review-webp}"
if [[ -e "$destination" ]]; then
  printf 'Refusing to overwrite existing output directory: %s\n' "$destination" >&2
  exit 1
fi
mkdir -p -- "$destination"
python seamless-tile.py city-ground-source.png "$scratch/city-ground-review.png" --band 64
python seamless-tile.py audience-plaza-source.png "$scratch/plaza-review.png" --band 64 --blur-sigma 42
magick "$scratch/city-ground-review.png" "$scratch/city-ground-review.png" +append "$scratch/city-row.png"
magick "$scratch/city-row.png" "$scratch/city-row.png" -append "$scratch/city-ground-2x2.png"
magick "$scratch/plaza-review.png" "$scratch/plaza-review.png" +append "$scratch/plaza-row.png"
magick "$scratch/plaza-row.png" "$scratch/plaza-row.png" -append "$scratch/audience-plaza-2x2.png"
cwebp -quiet -q 80 -m 6 -alpha_q 100 "$scratch/city-ground-2x2.png" -o "$scratch/city-ground-2x2.webp"
mv -f -- "$scratch/city-ground-2x2.webp" "$destination/city-ground-2x2.webp"
cwebp -quiet -q 80 -m 6 -alpha_q 100 "$scratch/audience-plaza-2x2.png" -o "$scratch/audience-plaza-2x2.webp"
mv -f -- "$scratch/audience-plaza-2x2.webp" "$destination/audience-plaza-2x2.webp"
magick "$scratch/city-ground-review.png" "$scratch/city-ground-review.png" "$scratch/city-ground-review.png" +append "$scratch/city-3x1.png"
magick "$scratch/plaza-review.png" "$scratch/plaza-review.png" "$scratch/plaza-review.png" +append "$scratch/plaza-3x1.png"
magick "$scratch/city-3x1.png" "$scratch/city-3x1.png" "$scratch/city-3x1.png" -append "$scratch/city-3x3.png"
magick "$scratch/plaza-3x1.png" "$scratch/plaza-3x1.png" "$scratch/plaza-3x1.png" -append "$scratch/plaza-3x3.png"
magick "$scratch/city-3x3.png" "$scratch/plaza-3x3.png" +append "$scratch/ground-textures-repeat-review.png"
cwebp -quiet -q 80 -m 6 -alpha_q 100 "$scratch/ground-textures-repeat-review.png" -o "$scratch/ground-textures-repeat-review.webp"
mv -f -- "$scratch/ground-textures-repeat-review.webp" "$destination/ground-textures-repeat-review.webp"
printf 'Generated WebP reviews in %s (PNG scratch is removed on exit)\n' "$destination"
```

The 2×2 PNGs and combined review-sheet PNG are temporary intermediates. This
recreates historical reviews from the retained original sources, not the
current approved city image. The command accepts an optional new output
directory; existing WebPs are preserved.

The earlier source corrections were rerun from each preserved source;
ImageMagick pixel comparison reported RMSE **0** against the then-current
candidate images. Both 2×2 and 3×3 repeats were visually inspected. There were
no hard edge seams after correction. At 3×3, the
exact broad pattern repeats are visible; the grass forms are irregular rather
than recognizable symbols, and the plaza remains very quiet. The final repeat
frequency cannot be judged without runtime world-space mapping. Integration
should use a low repeat count across the ground planes and inspect that scale in
the actual app before asking for runtime acceptance.

## Scope and approval gates

These images only treat the existing flat outer City Ground and existing flat
circular Audience Plaza. No geometry or baked lighting/shadows/glow are included.
The plaza is a seamless tile for
planar/world-space mapping—not a radial, center-composed image. Runtime must
preserve green under all mode tints, keep the plaza blue-violet, and retain the
existing shadows. Production/runtime validation and actual-app acceptance remain
separate and pending.
