#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
OUTPUT_DIR="${1:-$PROJECT_ROOT/assets/production/observatory-medallions}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/observatory-medallions.XXXXXX")"
trap 'rm -rf -- "$WORK_DIR"' EXIT

mkdir -p -- "$OUTPUT_DIR"

for name in lyra-of-brightvale christmas-star outside-worlds; do
  source="$SCRIPT_DIR/$name.png"
  padded="$WORK_DIR/$name.png"
  output="$OUTPUT_DIR/$name.webp"

  if [[ ! -s "$source" ]]; then
    printf 'Missing approved source artwork: %s\n' "$source" >&2
    exit 1
  fi

  magick "$source" \
    -colorspace sRGB \
    -filter Lanczos \
    -resize 840x840 \
    -gravity center \
    -background none \
    -extent 1024x1024 \
    "PNG32:$padded"
  cwebp -quiet -lossless -exact -m 6 -q 100 -metadata all \
    "$padded" -o "$output"
done
