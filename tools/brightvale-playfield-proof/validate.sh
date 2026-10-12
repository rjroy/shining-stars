#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/../.." && pwd)"
SCRATCH="$(mktemp -d /tmp/opencode/brightvale-playfield-XXXXXX)"
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"
PORT=""
SERVER_PID=""
# Never leave an older successful capture looking current when this run fails.
rm -f -- "$HERE/reference.json" "$HERE/narrow.json" "$HERE/reference.webp" "$HERE/narrow.webp"
cleanup() {
  local status=$?
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  if [[ -n "$PORT" ]]; then python3 - "$PORT" <<'PY'
import socket,sys
s=socket.socket(); s.settimeout(.2)
assert s.connect_ex(('127.0.0.1',int(sys.argv[1]))) != 0, 'owned proof server still listening'
PY
  fi
  if [[ $status -eq 0 ]]; then rm -rf -- "$SCRATCH"; else echo "Proof scratch retained: $SCRATCH" >&2; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ -n "$CHROMIUM" ]] || { echo "Chromium unavailable" >&2; exit 2; }
node --check "$HERE/main.js"
"$ROOT/node_modules/.bin/prettier" --check "$HERE/main.js" "$HERE/index.html" >/dev/null
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
node "$ROOT/node_modules/vite/bin/vite.js" "$ROOT" --host 127.0.0.1 --port "$PORT" --strictPort >"$SCRATCH/vite.log" 2>&1 &
SERVER_PID=$!
BASE="http://127.0.0.1:$PORT/tools/brightvale-playfield-proof/"
for _ in $(seq 1 100); do
  curl --silent --fail "$BASE" >/dev/null && break
  kill -0 "$SERVER_PID" 2>/dev/null || { python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text())' "$SCRATCH/vite.log" >&2; exit 1; }
  sleep .1
done
for mode in reference narrow; do
  query=""
  [[ "$mode" == narrow ]] && query='?view=narrow'
  "$CHROMIUM" --headless --no-sandbox --disable-dev-shm-usage --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars --virtual-time-budget=30000 --dump-dom "$BASE$query" >"$SCRATCH/$mode.html" 2>"$SCRATCH/$mode.chromium.log"
  python3 - "$SCRATCH/$mode.html" "$HERE/$mode.webp" "$HERE/$mode.json" "$mode" <<'PY'
from html.parser import HTMLParser
from pathlib import Path
import base64,json,sys

class Capture(HTMLParser):
    def __init__(self):
        super().__init__(); self.current=None; self.values={}; self.attrs={}
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='pre' and attrs.get('id') in ('report','capture'):
            self.current=attrs['id']; self.values[self.current]=''; self.attrs[self.current]=attrs
    def handle_data(self,data):
        if self.current: self.values[self.current]+=data
    def handle_endtag(self,tag):
        if tag=='pre': self.current=None

html=Path(sys.argv[1]).read_text(); parser=Capture(); parser.feed(html)
mode=sys.argv[4]
assert parser.attrs.get('report',{}).get('data-state')=='passed', parser.values.get('report','missing proof report')
report=json.loads(parser.values['report'])
assert report['raySamples']==2692 and len(report['actualLaneGeometry'])==4 and len(report['actualLuminousTargets'])==4
assert all(x['centerError']<.06 for x in report['actualLuminousTargets'])
assert all(2.5<x['measuredBoundsWidth']<3 for x in report['actualLaneGeometry'])
assert sum(report['rayHitCounts'].values())==2692
assert set(report['timing'])=={'easy','normal','hard'}
assert all(all(extent['endpointsInsidePlayableViewport']) for extent in report['timing'].values()), 'all difficulty endpoints fit within the proof viewport'
capture=parser.values.get('capture','')
assert capture.startswith('data:image/webp;base64,'), 'rendered WebP canvas capture missing'
Path(sys.argv[2]).write_bytes(base64.b64decode(capture.split(',',1)[1]))
assert all(extent['measuredMinimumBodyGap'] > 0 for extent in report['timing'].values()), 'note body must clear measured surface'
assert all('surfaceHitLocalZ' in sample for lane in report['surfaceProfile'] for sample in lane['measuredSamples']), 'actual inverse-transformed ray hit coordinate missing'
Path(sys.argv[3]).write_text(json.dumps(report,indent=2)+'\n')
print(f"{mode}: {report['loadedMeshCount']} production meshes; {report['raySamples']} local-vertical surface rays; geometry checks passed; WebP captured")
PY
done
echo "Geometry proof captures: $HERE/reference.webp and $HERE/narrow.webp"
