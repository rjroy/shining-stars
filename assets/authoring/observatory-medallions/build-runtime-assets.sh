#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"

if (( $# < 1 || $# > 2 )); then
  printf 'Usage: %s APPROVED_SOURCE.png [OUTPUT_DIR]\n' "$0" >&2
  exit 1
fi

SOURCE="$1"
if [[ "$SOURCE" != *.png || ! -s "$SOURCE" ]]; then
  printf 'Expected a nonempty approved source PNG: %s\n' "$SOURCE" >&2
  exit 1
fi

OUTPUT_DIR="${2:-$PROJECT_ROOT/assets/production/observatory-medallions}"
SOURCE_NAME="${SOURCE##*/}"
OUTPUT="$OUTPUT_DIR/${SOURCE_NAME%.png}.webp"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/observatory-medallions.XXXXXX")"
PADDED="$WORK_DIR/padded.png"
trap 'rm -f -- "$PADDED"; rmdir -- "$WORK_DIR"' EXIT

mkdir -p -- "$OUTPUT_DIR"

magick "$SOURCE" \
  -colorspace sRGB \
  -filter Lanczos \
  -resize 840x840 \
  -gravity center \
  -background none \
  -extent 1024x1024 \
  "PNG32:$PADDED"
cwebp -quiet -lossless -exact -m 6 -q 100 -metadata all \
  "$PADDED" -o "$OUTPUT"
