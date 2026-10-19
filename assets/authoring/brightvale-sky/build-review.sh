#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
output="${1:-$root/sky-art-review.webp}"
if [[ -e "$output" ]]; then
  printf 'Refusing to overwrite existing review output: %s\n' "$output" >&2
  exit 1
fi
scratch_root="${TMPDIR:-/tmp/opencode}"
mkdir -p "$scratch_root"
scratch="$(mktemp -d "$scratch_root/brightvale-sky-review.XXXXXX")"
staged_output=''
trap 'rm -f -- "$staged_output"; rm -rf -- "$scratch"' EXIT
staged_output="$(mktemp "${output}.partial.XXXXXX")"

magick -size 960x540 gradient:'#142342-#e7a66f' "$scratch/warm-gradient.png"
magick -size 960x540 gradient:'#080d25-#49346e' "$scratch/twilight-gradient.png"
magick -size 960x540 xc:'#f2eadc' "$scratch/light.png"
magick -size 960x540 xc:'#111626' "$scratch/dark.png"

composite_art() {
  local background="$1"
  local artwork="$2"
  local output="$3"
  magick "$background" \( "$artwork" -resize 960x540 \) \
    -gravity center -compose over -composite "$output"
}

labelled_panel() {
  local image="$1"
  local label="$2"
  local output="$3"
  magick "$image" -gravity south -background '#0d1020' -splice 0x42 \
    -font Adwaita-Sans -pointsize 21 -fill white -gravity south \
    -annotate +18+11 "$label" "$output"
}

composite_art "$scratch/warm-gradient.png" "$root/audience-radiant-clouds.png" "$scratch/warm.png"
composite_art "$scratch/twilight-gradient.png" "$root/twilight-cosmic-clouds.png" "$scratch/twilight.png"
composite_art "$scratch/light.png" "$root/audience-radiant-clouds.png" "$scratch/warm-light.png"
composite_art "$scratch/light.png" "$root/twilight-cosmic-clouds.png" "$scratch/twilight-light.png"
composite_art "$scratch/dark.png" "$root/audience-radiant-clouds.png" "$scratch/warm-dark.png"
composite_art "$scratch/dark.png" "$root/twilight-cosmic-clouds.png" "$scratch/twilight-dark.png"

labelled_panel "$scratch/warm.png" 'Audience / Radiant — representative twilight gradient' "$scratch/panel-1.png"
labelled_panel "$scratch/twilight.png" 'Twilight — representative indigo horizon' "$scratch/panel-2.png"
labelled_panel "$scratch/warm-light.png" 'Warm art — light-edge check' "$scratch/panel-3.png"
labelled_panel "$scratch/twilight-light.png" 'Violet art — light-edge check' "$scratch/panel-4.png"
labelled_panel "$scratch/warm-dark.png" 'Warm art — dark-edge check' "$scratch/panel-5.png"
labelled_panel "$scratch/twilight-dark.png" 'Violet art — dark-edge check' "$scratch/panel-6.png"

magick -size 1920x1746 xc:'#0d1020' \
  "$scratch/panel-1.png" -gravity northwest -geometry +0+0 -composite \
  "$scratch/panel-2.png" -gravity northwest -geometry +960+0 -composite \
  "$scratch/panel-3.png" -gravity northwest -geometry +0+582 -composite \
  "$scratch/panel-4.png" -gravity northwest -geometry +960+582 -composite \
  "$scratch/panel-5.png" -gravity northwest -geometry +0+1164 -composite \
  "$scratch/panel-6.png" -gravity northwest -geometry +960+1164 -composite \
  "$scratch/sky-art-review.png"

cwebp -quiet -q 80 -m 6 -alpha_q 100 \
  "$scratch/sky-art-review.png" -o "$staged_output"
mv -f -- "$staged_output" "$output"
printf 'Wrote %s\n' "$output"
