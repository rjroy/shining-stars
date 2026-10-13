#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/../../../.." && pwd)"
SCRATCH="$HERE/.scratch"
VITE="$ROOT/node_modules/vite/bin/vite.js"
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf -- "$SCRATCH"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ -f "$VITE" ]] || { echo "Existing Vite executable not found: $VITE" >&2; exit 2; }
[[ -n "$CHROMIUM" ]] || { echo "Chromium is unavailable; no browser validation performed." >&2; exit 2; }
mkdir -p -- "$SCRATCH"
node --check "$HERE/main.js"

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
node "$VITE" "$ROOT" --host 127.0.0.1 --port "$PORT" --strictPort >"$SCRATCH/vite.log" 2>&1 &
SERVER_PID=$!
URL="http://127.0.0.1:$PORT/assets/production/brightvale-platform-endcaps/validation/"
for _ in $(seq 1 50); do
  if curl --silent --fail "$URL" >/dev/null; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Vite server exited before becoming ready:" >&2
    python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text())' "$SCRATCH/vite.log" >&2
    exit 1
  fi
  sleep 0.1
done
curl --silent --fail "$URL" >/dev/null || { echo "Vite server did not become ready." >&2; exit 1; }

CHROMIUM_FLAGS=(--headless --no-sandbox --disable-dev-shm-usage --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=5000 --dump-dom)
"$CHROMIUM" "${CHROMIUM_FLAGS[@]}" "$URL?case=negative&asset=../missing-endcaps.glb" >"$SCRATCH/negative.html" 2>"$SCRATCH/chromium.log"
python3 - "$SCRATCH/negative.html" <<'PY'
from pathlib import Path
import sys

html = Path(sys.argv[1]).read_text()
assert 'data-state="failed"' in html, 'missing-file route did not report a failed state'
assert 'Invalid GLB payload: missing glTF magic header (HTTP 200' in html, 'missing-file SPA fallback was not rejected as a non-GLB payload'
print('Browser negative checks: invalid GLB rejected; missing asset route rejected as an SPA HTML fallback.')
PY

if [[ -f "$HERE/../endcaps.glb" ]]; then
  for mode in audience twilight; do
    "$CHROMIUM" "${CHROMIUM_FLAGS[@]}" "$URL?mode=$mode" >"$SCRATCH/$mode.html" 2>"$SCRATCH/chromium-$mode.log"
    "$ROOT/node_modules/.bin/prettier" --check "$HERE/main.js" >/dev/null
    python3 - "$SCRATCH/$mode.html" "$HERE/$mode.webp" "$HERE/report.json" "$mode" <<'PY'
from pathlib import Path
import base64, json, re, sys

html_path, image_path, report_path, mode = map(str, sys.argv[1:])
html = Path(html_path).read_text()
assert 'data-state="passed"' in html, f'{mode} structural load/assertions failed'
match = re.search(r'<pre id="report"[^>]*>(.*?)</pre>', html, re.S)
assert match, f'{mode} report missing'
report = json.loads(match.group(1))
assert report['mode'] == mode and report['materialCount'] == 2
assert 'MeshToonMaterial' in report['materialTreatment']
contract = report['gltfStructure']
assert (contract['nodeCount'], contract['meshCount'], contract['primitiveCount'], contract['triangleCount']) == (2, 2, 4, 2568)
assert report['threeMeshObjectCount'] == 4 and report['geometryTriangles'] == 2568
assert report['sourceInheritedNearZeroAreaTriangles'] == 14
assert report['glbResponseBodyBytes'] == 138388
assert all(abs(a - b) < 1e-4 for a, b in zip(report['framing']['min'], [-6.98, -0.65, -2.7]))
assert all(abs(a - b) < 1e-4 for a, b in zip(report['framing']['max'], [6.98, 1.15, 2.8]))
roles = {item['name']: item for item in report['materials']}
assert set(roles) == {'Endcap body | midnight-blue enamel', 'Endcap edging | warm brushed gold'}
for name, rgb, metalness, roughness in [
    ('Endcap body | midnight-blue enamel', [0.015, 0.028, 0.065], 0.45, 0.32),
    ('Endcap edging | warm brushed gold', [0.72, 0.36, 0.075], 0.82, 0.25),
]:
    actual = roles[name]
    assert actual['type'] == 'MeshStandardMaterial'
    assert all(abs(a - b) < 1e-5 for a, b in zip(actual['baseColorLinear'], rgb))
    assert abs(actual['metalness'] - metalness) < 1e-5 and abs(actual['roughness'] - roughness) < 1e-5
assignments = [name for mesh in report['meshes'] for name in mesh['materialNames']]
assert assignments.count('Endcap body | midnight-blue enamel') >= 2, assignments
assert assignments.count('Endcap edging | warm brushed gold') >= 2, assignments
assert report['loaderWarnings'] == [], f"{mode} loader warnings: {report['loaderWarnings']}"
assert report['renderer']['calls'] > 0 and report['renderer']['triangles'] > 0
assert len(report['toonMaterialMapping']) == 2 and all('validation toon' in m['name'] for m in report['toonMaterialMapping']), report['toonMaterialMapping']
evidence = re.search(r'<pre id="evidence"[^>]*>(.*?)</pre>', html, re.S)
assert evidence, f'{mode} WebP evidence missing'
data = json.loads(evidence.group(1))
assert data['mimeType'] == 'image/webp'
image = base64.b64decode(data['dataUrl'].split(',', 1)[1])
assert image[:4] == b'RIFF' and image[8:12] == b'WEBP', f'{mode} evidence is not WebP'
Path(image_path).write_bytes(image)
report_file = Path(report_path)
previous = json.loads(report_file.read_text()) if report_file.exists() else {'views': {}}
previous.setdefault('views', {})[mode] = report
report_file.write_text(json.dumps(previous, indent=2) + '\n')
print(f'{mode}: verified structural contract; wrote WebP evidence and report.')
PY
  done
  python3 - "$HERE/report.json" <<'PY'
import json, sys
from pathlib import Path
report = json.loads(Path(sys.argv[1]).read_text())
audience, twilight = report['views']['audience'], report['views']['twilight']
for key in ('camera', 'geometry'):
    assert audience['renderInvariants'][key] == twilight['renderInvariants'][key], f'{key} differs across modes'
assert audience['framing'] == twilight['framing']
assert audience['toonMaterialMapping'] == twilight['toonMaterialMapping']
print('Mode invariants: fixed camera, unchanged geometry hashes/bounds and identical base-role toon mapping.')
summary = {
    'state': 'passed-harness-validation-not-visual-approval',
    'method': 'Same GLB geometry/transforms and camera; shared derived two-role MeshToonMaterial mapping with a 3-step ramp. Audience uses warm amber lighting; Twilight uses violet lighting. Imported PBR materials are retained as baseline evidence, not rendered.',
    'limitations': 'Harness-only toon consumer treatment; does not demonstrate exported GLB toon portability or final game appearance. Toon mapping discards metallic/roughness response, environment reflections, and source PBR BRDF behavior. SwiftShader is not target-device evidence.',
    'modeResults': {},
}
for mode, item in report['views'].items():
    summary['modeResults'][mode] = {'evidence': f'{mode}.webp', 'lighting': item['renderContract'], 'renderer': item['renderer'], 'baselinePbrMaterials': item['materials'], 'toonMaterialMapping': item['toonMaterialMapping'], 'framing': item['framing'], 'renderInvariants': item['renderInvariants'], 'loaderWarnings': item['loaderWarnings']}
Path(sys.argv[1]).write_text(json.dumps(summary, indent=2) + '\n')
PY
  magick compare -metric AE "$HERE/audience.webp" "$HERE/twilight.webp" null: 2>"$SCRATCH/pixel-difference.txt" || true
  python3 - "$SCRATCH/pixel-difference.txt" "$HERE/report.json" <<'PY'
import json, sys
from pathlib import Path
pixels = int(Path(sys.argv[1]).read_text().split()[0].split('.')[0])
report = json.loads(Path(sys.argv[2]).read_text())
report['imageComparison'] = {'metric': 'ImageMagick absolute-error changed-pixel count', 'changedPixels': pixels, 'totalPixels': 960 * 540}
assert pixels > 1000, f'mode lighting produced too few changed pixels: {pixels}'
Path(sys.argv[2]).write_text(json.dumps(report, indent=2) + '\n')
print(f'Asset-view pixel difference: {pixels}/518400 pixels changed.')
PY
else
  echo "Required export missing at ../endcaps.glb; positive browser validation cannot run." >&2
  exit 1
fi

echo "Browser console/server logs, if needed, were held in temporary scratch and removed by cleanup."
