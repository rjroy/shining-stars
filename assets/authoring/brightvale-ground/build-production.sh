#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../../.." && pwd)
DEST="$ROOT/assets/production/brightvale-ground"
mkdir -p "$DEST"
verify_and_copy() {
  source=$1
  target=$2
  expected=$3
  actual=$(sha256sum "$HERE/$source" | cut -d ' ' -f 1)
  [ "$actual" = "$expected" ] || { echo "Refusing unapproved texture $source ($actual)" >&2; exit 1; }
  cp -f "$HERE/$source" "$DEST/$target"
  copied=$(sha256sum "$DEST/$target" | cut -d ' ' -f 1)
  [ "$copied" = "$expected" ] || { echo "Copy verification failed: $target" >&2; exit 1; }
}
verify_and_copy city-ground-candidate.png city-ground.png 304cebfa818ff58a5eae21c7e0f644db07e5d735f77535ab9b6cfd4847a29007
verify_and_copy audience-plaza-candidate.png audience-plaza.png 08cad37f87a9a9204d63b7faba174d9d0959cbb4cd7922fac19513a3a3b244ed
