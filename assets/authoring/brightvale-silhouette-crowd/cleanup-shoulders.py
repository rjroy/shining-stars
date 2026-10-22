#!/usr/bin/env python3
"""Authorized non-generative shoulder-only candidate edit, no alpha changes.

Run from any cwd. Requires existing ImageMagick for decoding only. Encodes a
fresh 8-bit RGBA PNG with no imported generation credentials or color profile.
Original files and prior comparison evidence are hash-checked and never written.
"""
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import zlib

PACKAGE = Path(__file__).resolve().parent
ROOT = PACKAGE.parents[2]
SOURCE = PACKAGE / 'pilot-candidate-revised.png'
OUTPUT = PACKAGE / 'pilot-candidate-shoulder-cleaned.png'
EVIDENCE = ROOT / '.lore/local/evidence/silhouette-crowd'
ORIGINALS = {
    'pilot-candidate.png': 'd3ccd17ebda314ba3c686b6fa229749867a4efe4cb8c36611bfb4572fbd57a3d',
    'pilot-candidate-revised.png': 'da92baf81297a97b5e529095b942aac7dd3d60d1ad854d9608e554eadad34545',
}
# Half-open x/y boxes contain all edits; centerline capsules select the actual
# cut faces/rims. Full blend inside inner_radius, cosine falloff to outer_radius.
# Only RGB of existing nonzero-alpha pixels is changed; silhouette is untouched.
REGIONS = [
    dict(name='A torso attachment', box=[566, 309, 648, 454], start=[589,329], end=[627,417], inner_radius=17, outer_radius=28),
    dict(name='A arm root', box=[821, 352, 905, 503], start=[846,374], end=[855,478], inner_radius=19, outer_radius=39),
    dict(name='B torso attachment', box=[533, 925, 619, 1062], start=[560,947], end=[598,1027], inner_radius=17, outer_radius=28),
    dict(name='B arm root', box=[819, 949, 907, 1110], start=[848,979], end=[850,1080], inner_radius=19, outer_radius=39),
]
TARGET = [11, 11, 12]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def distance(p, a, b):
    vx, vy = b[0]-a[0], b[1]-a[1]
    t = max(0, min(1, ((p[0]-a[0])*vx+(p[1]-a[1])*vy)/(vx*vx+vy*vy)))
    return math.hypot(p[0]-a[0]-t*vx, p[1]-a[1]-t*vy)


def weight(d, inner, outer):
    if d <= inner:
        return 1.0
    if d >= outer:
        return 0.0
    return (1+math.cos(math.pi*(d-inner)/(outer-inner)))/2


def decode(path):
    return subprocess.check_output(['magick', str(path), '-depth', '8', 'rgba:-'])


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind+data)&0xffffffff)


def main():
    # Controlled geometry/blend checks independent of mutable source artwork.
    assert distance((4,3),(0,0),(8,0)) == 3
    assert distance((-3,4),(0,0),(8,0)) == 5
    assert weight(0,17,28) == 1 and weight(28,17,28) == 0
    assert abs(weight(22.5,17,28)-0.5) < 1e-9
    for name, expected in ORIGINALS.items():
        assert digest(PACKAGE/name) == expected, name
    protected = {p.name: digest(p) for p in EVIDENCE.glob('assembled-preview*') if p.is_file()}
    raw = decode(SOURCE)
    w = h = 1254
    assert len(raw) == w*h*4
    edited = bytearray(raw)
    counts = []
    for region in REGIONS:
        x0,y0,x1,y1 = region['box']
        changed = 0
        for y in range(y0,y1):
            for x in range(x0,x1):
                i = (y*w+x)*4
                if raw[i+3] == 0:
                    continue
                blend = weight(distance((x,y),region['start'],region['end']),region['inner_radius'],region['outer_radius'])
                for channel in range(3):
                    edited[i+channel] = round(raw[i+channel]*(1-blend)+TARGET[channel]*blend)
                changed += edited[i:i+4] != raw[i:i+4]
        counts.append(dict(**region, changed_pixels=changed))
    differences = []
    for i in range(0,len(raw),4):
        assert raw[i+3] == edited[i+3], 'Alpha changed.'
        if raw[i:i+4] != edited[i:i+4]:
            x,y = (i//4)%w, (i//4)//w
            assert any(r['box'][0]<=x<r['box'][2] and r['box'][1]<=y<r['box'][3] for r in REGIONS), (x,y)
            differences.append((x,y))
    stride = w*4
    scanlines = b''.join(b'\0'+edited[y*stride:(y+1)*stride] for y in range(h))
    png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(scanlines,9))+chunk(b'IEND',b'')
    if OUTPUT.exists():
        assert OUTPUT.read_bytes() == png, 'Separate candidate already differs; do not overwrite.'
    else:
        OUTPUT.write_bytes(png)
    assert decode(OUTPUT) == bytes(edited), 'PNG roundtrip changed pixels.'
    for name, expected in ORIGINALS.items():
        assert digest(PACKAGE/name) == expected, name
    for name, expected in protected.items():
        assert digest(EVIDENCE/name) == expected, name
    report = dict(source=SOURCE.name, source_sha256=ORIGINALS[SOURCE.name], candidate=OUTPUT.name,
                  candidate_sha256=digest(OUTPUT), dimensions=[w,h], format='8-bit RGBA PNG; IHDR/IDAT/IEND only; untagged RGB',
                  method='RGB-only near-black cut-face/rim fill with cosine-feathered capsule masks; no generation/resizing/alpha edits',
                  target_rgb=TARGET, regions=counts, changed_pixels=len(differences),
                  alpha_changed_pixels=0, changed_pixels_outside_shoulder_boxes=0,
                  unchanged_original_hashes=ORIGINALS, prior_evidence_hashes=protected,
                  decoder=subprocess.check_output(['magick','-version'],text=True).splitlines()[0],
                  verification='Controlled distance/falloff tests; all-pixel confinement/alpha check; exact decoded PNG roundtrip; original/evidence hash checks passed.')
    (EVIDENCE/'shoulder-cleanup-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    main()
