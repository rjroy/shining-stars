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
[[ -f "$HERE/../city-slice.glb" ]] || { echo "Required export missing at ../city-slice.glb" >&2; exit 1; }
mkdir -p -- "$SCRATCH"
node --check "$HERE/main.js"

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
node "$VITE" "$ROOT" --host 127.0.0.1 --port "$PORT" --strictPort >"$SCRATCH/vite.log" 2>&1 &
SERVER_PID=$!
URL="http://127.0.0.1:$PORT/assets/production/brightvale-distant-city/validation/"
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

CHROMIUM_FLAGS=(--headless --no-sandbox --disable-dev-shm-usage --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=8000 --dump-dom)
"$CHROMIUM" "${CHROMIUM_FLAGS[@]}" "$URL?case=negative&asset=../missing-city.glb" >"$SCRATCH/negative.html" 2>"$SCRATCH/chromium-negative.log"
python3 - "$SCRATCH/negative.html" <<'PY'
from pathlib import Path
import sys
html = Path(sys.argv[1]).read_text()
assert 'data-state="failed"' in html, 'missing-file route did not fail'
assert 'Invalid GLB payload: missing glTF magic header (HTTP 200' in html, 'SPA HTML fallback was not rejected as a non-GLB payload'
print('Negative path: invalid GLB and missing asset fallback rejected.')
PY

for mode in audience twilight; do
  "$CHROMIUM" "${CHROMIUM_FLAGS[@]}" "$URL?mode=$mode" >"$SCRATCH/$mode.html" 2>"$SCRATCH/chromium-$mode.log"
  "$ROOT/node_modules/.bin/prettier" --check "$HERE/main.js" >/dev/null
  python3 - "$SCRATCH/$mode.html" "$HERE/$mode.webp" "$HERE/report.json" "$mode" <<'PY'
from pathlib import Path
import base64, json, re, sys
html_path, image_path, report_path, mode = map(str, sys.argv[1:])
html = Path(html_path).read_text()
match = re.search(r'<pre id="report"[^>]*>(.*?)</pre>', html, re.S)
assert match, f'{mode} report missing'
data = json.loads(match.group(1))
assert 'data-state="passed"' in html, f'{mode} browser validation failed: {data}'
assert data['mode'] == mode
assert data['glbResponseBodyBytes'] == 1584308
assert data['structural'] == {'nodeCount': 31, 'uniqueMeshCount': 24, 'uniquePrimitiveCount': 132, 'uniqueMeshTriangles': 33246}
assert (data['placedPrimitiveMeshCount'], data['placedTriangleCount']) == (150, 36489)
assert data['uniqueLoadedGeometryCount'] < data['placedPrimitiveMeshCount']
assert data['geometryIdentityReuseCount'] > 0
assert data['renderer']['calls'] > 0 and 0 < data['renderer']['triangles'] <= 36489
assert len(data['baselinePbrMaterials']) == len(data['derivedToonMapping']) == 6
assert {item['cityRole'] for item in data['baselinePbrMaterials']} == {'body','recess','roof','stone_trim','gold','emissive_window'}
window = next(item for item in data['baselinePbrMaterials'] if item['name'] == 'Window')
assert abs(window['emissiveIntensity'] - 1.8) < .002 and all(abs(a-b) < 1e-5 for a,b in zip(window['emissive'], [1,.47,.12]))
toon_window = next(item for item in data['derivedToonMapping'] if item['name'].startswith('Window |'))
assert abs(toon_window['emissiveIntensity'] - 1.8) < .002 and all(abs(a-b) < 1e-5 for a,b in zip(toon_window['emissive'], [1,.47,.12]))
assert all(not material['textures'] for material in data['baselinePbrMaterials'])
assert data['loaderWarnings'] == [], data['loaderWarnings']
assert data['browserResourceTransferBytes'] is not None
evidence = re.search(r'<pre id="evidence"[^>]*>(.*?)</pre>', html, re.S)
assert evidence, 'evidence missing'
encoded = json.loads(evidence.group(1))
image = base64.b64decode(encoded['dataUrl'].split(',', 1)[1])
assert encoded['mimeType'] == 'image/webp' and image[:4] == b'RIFF' and image[8:12] == b'WEBP'
Path(image_path).write_bytes(image)
previous = json.loads(Path(report_path).read_text()) if Path(report_path).exists() else {'views': {}}
previous.setdefault('views', {})[mode] = data
Path(report_path).write_text(json.dumps(previous, indent=2) + '\n')
print(f'{mode}: contract, six material roles/emission, 150 placements and evidence passed.')
PY
done

python3 - "$HERE/report.json" <<'PY'
import json, sys
from pathlib import Path
report = json.loads(Path(sys.argv[1]).read_text())
a, t = report['views']['audience'], report['views']['twilight']
assert a['modeInvariant'] == t['modeInvariant'], 'camera, city transform or geometry differs across modes'
assert a['derivedToonMapping'] == t['derivedToonMapping'], 'toon material mapping differs across modes'
assert a['lighting'] != t['lighting'], 'mode lighting did not change'
summary = {
    'state': 'passed-browser-validation-not-final-appearance-approval',
    'method': 'Same placed GLB and study camera. Shared six-role toon mapping preserves imported base colors, flat normals, double-sidedness and emissive-window color/strength; Audience is warm amber and Twilight violet.',
    'recommendation': 'Browser evidence is suitable for parent review and, if accepted, the next production-scale slice. It is not approval for whole-city export or runtime integration.',
    'baselinePbrMaterials': a['baselinePbrMaterials'],
    'derivedToonMapping': a['derivedToonMapping'],
    'modeResults': {},
    'limitations': ['Toon materials exist only in this browser consumer; they are not portable/exported GLB appearance.', 'The inherited study projection intentionally crops the spire top; comparison.webp includes a separate full-silhouette source/derivative diagnostic.', 'Shared geometry is not GPU instancing. Renderer calls and typed-array bytes are not target-device or GPU-memory budgets.', 'The source/derivative comparison.webp is the matched geometry evidence: distant study crops preserve skyline and silhouette; source README reports zero silhouette pixels changed. Browser toon evidence is not a replacement for that geometry comparison.'],
}
for mode, item in report['views'].items():
    summary['modeResults'][mode] = {key: item[key] for key in ('glbResponseBodyBytes', 'browserResourceTransferBytes', 'localFetchParseAndFirstRenderMs', 'structural', 'placedPrimitiveMeshCount', 'placedTriangleCount', 'uniqueLoadedGeometryCount', 'geometryIdentityReuseCount', 'decodedGeometryTypedArrayBytes', 'decodedTextureBytes', 'renderer', 'browserGpuBackend', 'bounds', 'camera', 'lighting', 'modeInvariant', 'loaderWarnings')}
Path(sys.argv[1]).write_text(json.dumps(summary, indent=2) + '\n')
print('Mode invariant: same study camera, city transform, geometry signatures and six-role mapping.')
PY

magick compare -metric AE "$HERE/audience.webp" "$HERE/twilight.webp" null: 2>"$SCRATCH/pixel-difference.txt" || true
python3 - "$SCRATCH/pixel-difference.txt" "$HERE/report.json" <<'PY'
import json, sys
from pathlib import Path
changed = int(Path(sys.argv[1]).read_text().split()[0].split('.')[0])
assert changed > 1000, f'mode lighting changed too few pixels: {changed}'
path = Path(sys.argv[2])
report = json.loads(path.read_text())
report['imageComparison'] = {'metric': 'ImageMagick absolute-error changed pixels; canvas background is identical, so changed pixels lie on rendered city', 'changedPixels': changed, 'totalPixels': 1600 * 900}
path.write_text(json.dumps(report, indent=2) + '\n')
print(f'Mode-image difference: {changed}/1,440,000 pixels changed.')
PY
echo "Browser logs and scratch data removed; owned Vite process stopped."
