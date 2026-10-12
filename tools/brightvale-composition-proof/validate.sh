#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/../.." && pwd)"
SCRATCH="$(mktemp -d /tmp/opencode/brightvale-composition-XXXXXX)"
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"
PORT=""
SERVER_PID=""

rm -f -- "$HERE"/audience-*.webp "$HERE"/twilight-*.webp "$HERE/report.json"
cleanup() {
  local status=$?
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$PORT" ]]; then
    python3 - "$PORT" <<'PY'
import socket,sys
s=socket.socket(); s.settimeout(.2)
assert s.connect_ex(('127.0.0.1',int(sys.argv[1]))) != 0, 'proof server still listening on owned port'
s.close()
PY
  fi
  if [[ $status -eq 0 ]]; then
    rm -rf -- "$SCRATCH"
  else
    printf 'Composition proof scratch retained: %s\n' "$SCRATCH" >&2
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ -n "$CHROMIUM" ]] || { echo "Chromium unavailable" >&2; exit 2; }
node --check "$HERE/main.js"
"$ROOT/node_modules/.bin/prettier" --check "$HERE/main.js" "$HERE/index.html" >/dev/null
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
VITE_SONG_VOLUME=0 node "$ROOT/node_modules/vite/bin/vite.js" "$ROOT" --host 127.0.0.1 --port "$PORT" --strictPort >"$SCRATCH/vite.log" 2>&1 &
SERVER_PID=$!
BASE="http://127.0.0.1:$PORT/tools/brightvale-composition-proof/"
for _ in $(seq 1 100); do
  curl --silent --fail "$BASE" >/dev/null && break
  kill -0 "$SERVER_PID" 2>/dev/null || { python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text())' "$SCRATCH/vite.log" >&2; exit 1; }
  sleep .1
done

for viewport in reference narrow; do
  if [[ "$viewport" == reference ]]; then size="1600,900"; else size="1120,700"; fi
  for mode in audience twilight; do
    "$CHROMIUM" --headless --no-sandbox --disable-dev-shm-usage \
      --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
      --hide-scrollbars --window-size="$size" --virtual-time-budget=60000 \
      --dump-dom "$BASE?view=$viewport&mode=$mode" \
      >"$SCRATCH/$viewport-$mode.html" 2>"$SCRATCH/$viewport-$mode.chromium.log"
  done
done

python3 - "$SCRATCH" "$HERE" <<'PY'
from html.parser import HTMLParser
from pathlib import Path
import base64,json,sys

scratch=Path(sys.argv[1]); out=Path(sys.argv[2])
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

reports={}
for viewport in ('reference','narrow'):
    for mode in ('audience','twilight'):
        path=scratch/f'{viewport}-{mode}.html'
        parser=Capture(); parser.feed(path.read_text())
        state=parser.attrs.get('report',{}).get('data-state')
        assert state=='passed', f'{viewport}/{mode} proof state={state}: {parser.values.get("report","missing report")}'
        report=json.loads(parser.values['report'])
        assert report['requestedMode']==mode
        assert report['layout']['playfieldTiltDegrees']==14
        assert report['layout']['framingPlacements']==53
        assert report['layout']['crowdPlacements']==25
        assert report['layout']['groundSurfaces']==2
        assert report['groundNormalEvidence']=={'meshCount':2,'meshesWithNormals':2,'allHaveNormals':True}, report['groundNormalEvidence']
        counts=report['instanceCounts']
        assert counts['Brightvale.City']=={'batches':288,'instances':1080}, counts['Brightvale.City']
        assert counts['Brightvale.Framing']=={'batches':10,'instances':266}, counts['Brightvale.Framing']
        assert counts['Brightvale.Crowd']=={'batches':98,'instances':350}, counts['Brightvale.Crowd']
        difference=report['audienceTwilightDifference']
        assert difference['sameCamera'] and difference['visibleGeometryPixels']>0
        assert difference['changedVisibleGeometryPixels']>0, f'{viewport}: no visible geometry changes between modes'
        crowd=report['occlusionAwareCrowdEvidence']
        assert len(crowd['people'])==25
        assert crowd['fullyOccludedCount']==0, crowd['fullyOccludedIds']
        capture=parser.values.get('capture','')
        assert capture.startswith('data:image/webp;base64,'), f'{viewport}/{mode}: WebP evidence missing'
        filename=f'{mode}-{viewport}.webp'
        (out/filename).write_bytes(base64.b64decode(capture.split(',',1)[1]))
        report['evidence']['screenshot']=filename
        reports[f'{viewport}/{mode}']=report

for viewport in ('reference','narrow'):
    a=reports[f'{viewport}/audience']['viewport']['camera']
    t=reports[f'{viewport}/twilight']['viewport']['camera']
    assert a==t, f'{viewport}: mode pair camera differs'
    assert reports[f'{viewport}/audience']['assembledSceneTreeTriangles']==reports[f'{viewport}/twilight']['assembledSceneTreeTriangles']
    assert reports[f'{viewport}/audience']['actualRendererInfo']==reports[f'{viewport}/twilight']['actualRendererInfo']

compact={'proof':'Brightvale runtime composition visual proof','scope':'isolated runtime modules; no gameplay cutover','status':'passed','viewports':{}}
for viewport in ('reference','narrow'):
    audience=reports[f'{viewport}/audience']; twilight=reports[f'{viewport}/twilight']
    assert audience['viewport']==twilight['viewport'], f'{viewport}: mode pair camera or viewport differs'
    assert audience['assembledSceneTreeTriangles']==twilight['assembledSceneTreeTriangles']
    assert audience['actualRendererInfo']==twilight['actualRendererInfo']
    compact['viewports'][viewport]={
        'camera':audience['viewport'],
        'layout':audience['layout'],
        'sourceAssets':audience['sourceAssets'],
        'instanceCounts':audience['instanceCounts'],
        'groupBounds':audience['groupBounds'],
        'groundNormalEvidence':audience['groundNormalEvidence'],
        'assembledSceneTreeTriangles':audience['assembledSceneTreeTriangles'],
        'actualRendererInfo':audience['actualRendererInfo'],
        'audienceTwilightGeometryPixelDifference':audience['audienceTwilightDifference'],
        'crowdOcclusion':{
            'method':audience['occlusionAwareCrowdEvidence']['method'],
            'fullyOccludedCount':audience['occlusionAwareCrowdEvidence']['fullyOccludedCount'],
            'people':[{'id':p['id'],'source':p['source'],'visiblePixels':p['visiblePixels']} for p in audience['occlusionAwareCrowdEvidence']['people']],
        },
        'captures':[f'audience-{viewport}.webp',f'twilight-{viewport}.webp'],
    }
compact['limitations']=[
    'Chromium/SwiftShader only; no device-performance or hardware-budget claim.',
    'Narrow viewport is one sample, not a declared minimum supported viewport.',
    'Per-person ID pass reports visible pixels under depth testing; partial visibility is allowed.',
    'Renderer triangles/calls describe the submitted frame; assembled triangles are scene-tree geometry inventory.',
]
(out/'report.json').write_text(json.dumps(compact,indent=2)+'\n')
print('Reference and narrow Audience/Twilight captures passed: 4 WebPs; same-camera geometry difference; 25/25 crowd placements have visible ID pixels.')
for viewport,value in compact['viewports'].items():
    print(f"{viewport}: assembled={value['assembledSceneTreeTriangles']} triangles; renderer={value['actualRendererInfo']['triangles']} triangles/{value['actualRendererInfo']['calls']} calls; crowd fully occluded={value['crowdOcclusion']['fullyOccludedCount']}")
PY
