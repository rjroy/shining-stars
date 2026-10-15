#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
AUTHORING="$ROOT/assets/authoring/brightvale-sky"
OUTPUT="$ROOT/assets/production/brightvale-sky"
mkdir -p "$OUTPUT"

build() {
  local source="$1"
  local destination="$2"
  magick "$AUTHORING/$source" -filter Lanczos -resize 1536x864 \
    -define png:compression-level=9 -define png:exclude-chunk=date,time \
    "$OUTPUT/$destination"
  local properties
  properties="$(magick identify -format '%w %h %[channels]' "$OUTPUT/$destination")"
  local width height channels channel_depth
  read -r width height channels channel_depth <<< "$properties"
  if [[ "$width $height $channels" != "1535 864 srgba" ]]; then
    printf 'Unexpected production image properties for %s: %s\n' "$destination" "$properties" >&2
    exit 1
  fi
}

build audience-radiant-clouds.png audience-radiant-clouds.png
build twilight-cosmic-clouds.png twilight-cosmic-clouds.png

for image in "$OUTPUT"/*.png; do
  alpha_extrema="$(magick "$image" -alpha extract -format '%[fx:minima] %[fx:maxima]' info:)"
  read -r alpha_min alpha_max <<< "$alpha_extrema"
  if [[ "$alpha_min" != "0" || "$alpha_max" == "0" || "$alpha_max" == "0.0" ]]; then
    printf 'Expected genuine transparent and visible pixels in %s, got alpha range %s\n' \
      "$image" "$alpha_extrema" >&2
    exit 1
  fi
done

printf 'Validated production derivatives:\n'
sha256sum "$OUTPUT"/*.png
magick identify -format '%f %wx%h %[channels] %b\n' "$OUTPUT"/*.png
