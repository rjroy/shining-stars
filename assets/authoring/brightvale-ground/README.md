# Brightvale ground texture candidates

## Artwork approval

The user approved both exact images with “works for me” on 2026-10-15 after
reviewing the combined 3×3 repeat sheet. Approval hashes:

- City Ground: `304cebfa818ff58a5eae21c7e0f644db07e5d735f77535ab9b6cfd4847a29007`
- Audience Plaza: `08cad37f87a9a9204d63b7faba174d9d0959cbb4cd7922fac19513a3a3b244ed`

Approval authorizes production copies and the runtime scale/integration check
for these surfaces only. Actual-app runtime acceptance remains pending.

- Full brief: [brief.md](brief.md)
- **Combined 3×3 repeat review:** [WebP presentation](ground-textures-repeat-review.webp). The duplicate PNG review sheet is not retained.
  Left is green City Ground; right is blue-violet Audience Plaza.
- City Ground: [candidate](city-ground-candidate.png) · [2×2 WebP](city-ground-2x2.webp)
- Audience Plaza: [candidate](audience-plaza-candidate.png) · [2×2 WebP](audience-plaza-2x2.webp)
- Reproducible correction: [seamless-tile.py](seamless-tile.py)

The generated originals are preserved as `city-ground-source.png` and
`audience-plaza-source.png`. All four texture images are opaque 8-bit RGB PNGs,
1254×1254, intended for sRGB sampling. The requested 1024×1024 was not emitted;
no resizing or lossy conversion was applied. File and GPU-memory budgets remain
unknown.

## Provenance and hashes

Generated with the built-in Codex image route on 2026-10-15. Native staging paths
and SHA-256 hashes:

| Surface | Native source | Source SHA-256 | Candidate SHA-256 |
|---|---|---|---|
| City Ground | `/home/rjroy/.codex/generated_images/01a14059-e5cf-7bc2-a27d-0350b1e44c6d/exec-ff0b3552-584b-4c5e-928f-07a4ba8f80a3.png` | `addafea9824127c39b3e075f070af2961c4fcb5ebc70f7d11971d8af61faebe7` | `304cebfa818ff58a5eae21c7e0f644db07e5d735f77535ab9b6cfd4847a29007` |
| Audience Plaza | `/home/rjroy/.codex/generated_images/01a1405c-b408-74e1-b6b2-b643766a792d/exec-b4419dd0-46a7-4bd2-a194-ef176043cac1.png` | `bb1df477b9ffa795df019b308e099aefbda58904484737e2d6fc66915ab5854b` | `08cad37f87a9a9204d63b7faba174d9d0959cbb4cd7922fac19513a3a3b244ed` |

The City Ground source was the second generated grass image after a first
candidate showed obvious joins. The plaza source was the first, more detailed
blue-violet stone generation; a targeted Gaussian softening reduced its noisy
mineral detail. A later nearly uniform plaza attempt was not retained.

## Seam correction and validation

`seamless-tile.py` uses Python standard library and ImageMagick **7.1.2-31**.
It blends a 64-pixel band at opposing edges, wraps horizontally and vertically,
then asserts exact RGB equality of the first/last pixel on every row and column
(including corners). Plaza detail uses a 42-pixel Gaussian blur before edge
correction; City Ground uses no blur. This preserves the generated source and
makes the correction reproducible. A repeat preview is built directly from the
candidate without added image changes.

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
python seamless-tile.py city-ground-source.png "$scratch/city-ground-candidate.png" --band 64
python seamless-tile.py audience-plaza-source.png "$scratch/audience-plaza-candidate.png" --band 64 --blur-sigma 42
magick "$scratch/city-ground-candidate.png" "$scratch/city-ground-candidate.png" +append "$scratch/city-row.png"
magick "$scratch/city-row.png" "$scratch/city-row.png" -append "$scratch/city-ground-2x2.png"
magick "$scratch/audience-plaza-candidate.png" "$scratch/audience-plaza-candidate.png" +append "$scratch/plaza-row.png"
magick "$scratch/plaza-row.png" "$scratch/plaza-row.png" -append "$scratch/audience-plaza-2x2.png"
cwebp -quiet -q 80 -m 6 -alpha_q 100 "$scratch/city-ground-2x2.png" -o "$scratch/city-ground-2x2.webp"
mv -f -- "$scratch/city-ground-2x2.webp" "$destination/city-ground-2x2.webp"
cwebp -quiet -q 80 -m 6 -alpha_q 100 "$scratch/audience-plaza-2x2.png" -o "$scratch/audience-plaza-2x2.webp"
mv -f -- "$scratch/audience-plaza-2x2.webp" "$destination/audience-plaza-2x2.webp"
magick "$scratch/city-ground-candidate.png" "$scratch/city-ground-candidate.png" "$scratch/city-ground-candidate.png" +append "$scratch/city-3x1.png"
magick "$scratch/audience-plaza-candidate.png" "$scratch/audience-plaza-candidate.png" "$scratch/audience-plaza-candidate.png" +append "$scratch/plaza-3x1.png"
magick "$scratch/city-3x1.png" "$scratch/city-3x1.png" "$scratch/city-3x1.png" -append "$scratch/city-3x3.png"
magick "$scratch/plaza-3x1.png" "$scratch/plaza-3x1.png" "$scratch/plaza-3x1.png" -append "$scratch/plaza-3x3.png"
magick "$scratch/city-3x3.png" "$scratch/plaza-3x3.png" +append "$scratch/ground-textures-repeat-review.png"
cwebp -quiet -q 80 -m 6 -alpha_q 100 "$scratch/ground-textures-repeat-review.png" -o "$scratch/ground-textures-repeat-review.webp"
mv -f -- "$scratch/ground-textures-repeat-review.webp" "$destination/ground-textures-repeat-review.webp"
printf 'Generated WebP reviews in %s (PNG scratch is removed on exit)\n' "$destination"
```

The 2×2 PNGs and combined review-sheet PNG are temporary intermediates. The command accepts an optional new output directory; preserve approved candidate/source textures and existing WebPs.

The script was rerun from each preserved source; ImageMagick pixel comparison
reported RMSE **0** against each candidate. Both 2×2 and 3×3 repeats were
visually inspected. There are no hard edge seams after correction. At 3×3, the
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
