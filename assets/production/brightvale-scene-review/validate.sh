#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/../../.." && pwd)"
SCRATCH="$(mktemp -d /tmp/opencode/brightvale-scene-review-XXXXXX)"
VITE="$ROOT/node_modules/vite/bin/vite.js"
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"
SERVER_PID=""
PORT=""

cleanup() {
  local status=$?
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Owned Vite process still running: $SERVER_PID" >&2
    exit 1
  fi
  if [[ -n "$PORT" ]]; then
    python3 - "$PORT" <<'PY'
import socket,sys
s=socket.socket(); s.settimeout(.2)
assert s.connect_ex(('127.0.0.1',int(sys.argv[1]))) != 0, 'owned Vite listener still accepts connections'
PY
  fi
  if [[ $status -eq 0 ]]; then rm -rf -- "$SCRATCH"; else echo "Validation scratch retained: $SCRATCH" >&2; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ -f "$VITE" ]] || { echo "Existing Vite not found: $VITE" >&2; exit 2; }
[[ -n "$CHROMIUM" ]] || { echo "Chromium unavailable; browser validation skipped." >&2; exit 2; }
node --check "$HERE/main.js"
"$ROOT/node_modules/.bin/prettier" --check "$HERE/main.js" "$HERE/index.html" >/dev/null

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
node "$VITE" "$ROOT" --host 127.0.0.1 --port "$PORT" --strictPort >"$SCRATCH/vite.log" 2>&1 &
SERVER_PID=$!
URL="http://127.0.0.1:$PORT/assets/production/brightvale-scene-review/"
for _ in $(seq 1 100); do
  if curl --silent --fail "$URL" >/dev/null; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Vite exited before ready:" >&2
    python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text())' "$SCRATCH/vite.log" >&2
    exit 1
  fi
  sleep .1
done
curl --silent --fail "$URL" >/dev/null || { echo "Vite did not become ready" >&2; exit 1; }

FLAGS=(--headless --no-sandbox --disable-dev-shm-usage --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars --virtual-time-budget=30000 --dump-dom)
"$CHROMIUM" "${FLAGS[@]}" "$URL?case=negative&platform=../missing-platform.glb" >"$SCRATCH/missing.html" 2>"$SCRATCH/chromium-negative.log"
python3 - "$SCRATCH/missing.html" <<'PY'
from pathlib import Path
import sys
html=Path(sys.argv[1]).read_text()
assert 'data-state="failed"' in html, 'missing GLB route was not rejected'
assert ('GLB magic/header' in html or 'JSON' in html), 'missing asset failure was not explicit'
print('Negative browser route: invalid playfield GLB rejected even when Vite returns its SPA fallback.')
PY

for mode in audience twilight; do
  "$CHROMIUM" "${FLAGS[@]}" "$URL?mode=$mode&case=negative" >"$SCRATCH/$mode.html" 2>"$SCRATCH/chromium-$mode.log"
  python3 - "$SCRATCH/$mode.html" "$HERE/$mode.webp" "$SCRATCH/$mode.json" "$mode" <<'PY'
from pathlib import Path
import base64,json,re,sys
html_path,image_path,report_path,mode=sys.argv[1:]
html=Path(html_path).read_text()
assert 'data-state="passed"' in html, f'{mode} scene validation failed'
report_match=re.search(r'<pre id="report"[^>]*>(.*?)</pre>',html,re.S)
assert report_match, 'report element missing'
report=json.loads(report_match.group(1))
assert report['mode']==mode
assert report['assembly']['framingLongSections']==26 and report['assembly']['wholePosts']==27
assert report['renderer']['calls']>0 and report['renderer']['triangles']>250000
assert report['loaderWarnings']==[], report['loaderWarnings']
assert len(report['inputs'])==6
match=re.search(r'<pre id="evidence"[^>]*>(.*?)</pre>',html,re.S)
assert match, 'evidence node missing'
evidence=json.loads(match.group(1))
assert evidence['mimeType']=='image/webp' and evidence['dataUrl'].startswith('data:image/webp;')
image=base64.b64decode(evidence['dataUrl'].split(',',1)[1])
assert image[:4]==b'RIFF' and image[8:12]==b'WEBP'
Path(image_path).write_bytes(image)
Path(report_path).write_text(json.dumps(report,indent=2)+'\n')
print(f'{mode}: shared city/playfield scene passed; {report["renderer"]["calls"]} calls / {report["renderer"]["triangles"]} tris; WebP captured.')
PY
done

magick compare -metric AE \
  -crop 1600x500+0+400 "$HERE/audience.webp" "$HERE/twilight.webp" null: \
  2>"$SCRATCH/mode-pixels.txt" || true
PIXELS="$(python3 - "$SCRATCH/mode-pixels.txt" <<'PY'
from pathlib import Path
import sys
print(int(Path(sys.argv[1]).read_text().split()[0].split('.')[0]))
PY
)"
[[ "$PIXELS" -gt 10000 ]] || { echo "Audience/Twilight scene-surface difference too small: $PIXELS pixels" >&2; exit 1; }

python3 - "$SCRATCH/audience.json" "$SCRATCH/twilight.json" "$HERE/report.json" "$PIXELS" <<'PY'
import json,sys
from pathlib import Path
a=json.loads(Path(sys.argv[1]).read_text()); t=json.loads(Path(sys.argv[2]).read_text())
for key in ('inputs','importedAssetCounts','geometry','assembly','camera','toonMaterials'):
    assert a[key]==t[key],f'{key} changed between modes'
assert a['lighting']['preset']=='audience' and t['lighting']['preset']=='twilight'
out={'state':'passed-harness-validation-not-final-runtime-approval','sameSceneAndCamera':True,'modeDifference':{'metric':'ImageMagick absolute-error changed-pixel count in 1600x500 lower scene crop (excludes sky/backdrop)','changedPixels':int(sys.argv[4]),'crop':'1600x500+0+400'},'method':a['materialTreatment'],'limitations':a['limitations'],'modeResults':{'audience':a,'twilight':t}}
Path(sys.argv[3]).write_text(json.dumps(out,indent=2)+'\n')
print(f'Mode checks: same scene/camera/materials; {sys.argv[4]} lower-scene pixels differ.')
PY

"$ROOT/node_modules/.bin/prettier" --check "$HERE/main.js" "$HERE/index.html" >/dev/null
echo "Captures: $HERE/audience.webp and $HERE/twilight.webp"
echo "Report: $HERE/report.json"
