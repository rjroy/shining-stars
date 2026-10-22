#!/usr/bin/env python3
"""Reproducible, lossless pilot atlas from the approved source; no runtime edits."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import struct
import subprocess
import zlib

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'assets/authoring/brightvale-silhouette-crowd/pilot-candidate-shoulder-cleaned.png'
SOURCE_HASH = '9f5785def1d7bec9339b908a6e926b370a1715196af26bf2d9524f87624598ba'
WIDTH, HEIGHT, GUTTER, PIXELS_PER_UNIT = 1424, 896, 16, 560
# Same crops, scale, shoulder/grip landmarks and stick endpoints as the accepted
# six-pose source inspection. Rectangles are [x,y,width,height], y down.
FIGURES = [
    dict(id='A', body=[110,30,530,595], arm=[815,90,320,415],
         body_at=[16,16], arm_at=[1080,16], shoulder=[599,370], arm_pivot=[849,422],
         grip=[1038,155], stick_top=[1020,35], stick_bottom=[1044,195],
         inspection_color='#55ddff', visible_body_height_px=560),
    dict(id='B', body=[150,635,470,585], arm=[815,700,310,405],
         body_at=[578,16], arm_at=[1080,463], shoulder=[576,986], arm_pivot=[849,1022],
         grip=[996,762], stick_top=[953,651], stick_bottom=[1010,800],
         inspection_color='#ff65c7', visible_body_height_px=565),
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def decode(path):
    return subprocess.check_output(['magick',str(path),'-depth','8','rgba:-'])


def crop(raw, width, height, rect):
    x,y,w,h = rect
    if not (x>=0 and y>=0 and w>0 and h>0 and x+w<=width and y+h<=height):
        raise ValueError('Crop outside image')
    return b''.join(raw[((y+row)*width+x)*4:((y+row)*width+x+w)*4] for row in range(h))


def padded_rect(rect, gutter):
    x,y,w,h = rect
    return [x-gutter,y-gutter,w+2*gutter,h+2*gutter]


def overlaps(a,b):
    return a[0]<b[0]+b[2] and b[0]<a[0]+a[2] and a[1]<b[1]+b[3] and b[1]<a[1]+a[3]


def paste_extruded(atlas, width, height, pixels, rect, gutter):
    x,y,w,h = rect
    outer = padded_rect(rect,gutter)
    if outer[0]<0 or outer[1]<0 or outer[0]+outer[2]>width or outer[1]+outer[3]>height:
        raise ValueError('Gutter outside atlas')
    for yy in range(y-gutter,y+h+gutter):
        sy = max(0,min(h-1,yy-y))
        for xx in range(x-gutter,x+w+gutter):
            sx = max(0,min(w-1,xx-x))
            src,dst = (sy*w+sx)*4,(yy*width+xx)*4
            atlas[dst:dst+4] = pixels[src:src+4]


def chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)


def png(raw,w,h):
    assert len(raw)==w*h*4
    rows=b''.join(b'\0'+raw[y*w*4:(y+1)*w*4] for y in range(h))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b'')


def local(point,origin):
    return [(point[0]-origin[0])/PIXELS_PER_UNIT,(origin[1]-point[1])/PIXELS_PER_UNIT]


def dump(path,data):
    path.write_text(json.dumps(data,indent=2)+'\n')


def build(output):
    print('[crowd-atlas] reading approved source', flush=True)
    source_bytes=SOURCE.read_bytes()
    assert sha(source_bytes)==SOURCE_HASH, 'Approved source identity mismatch'
    protected={p.name:sha(p.read_bytes()) for p in SOURCE.parent.glob('pilot-candidate*.png')}
    raw=decode(SOURCE)
    assert len(raw)==1254*1254*4
    atlas=bytearray(WIDTH*HEIGHT*4)
    parts,figures,source_rects=[],[],[]
    for f in FIGURES:
        body_origin=[f['body'][2]/2,f['body'][3]]
        body_shoulder=[f['shoulder'][i]-f['body'][i] for i in (0,1)]
        arm_pivot=[f['arm_pivot'][i]-f['arm'][i] for i in (0,1)]
        for role,origin in [('body',body_origin),('arm',arm_pivot)]:
            sx,sy,w,h=f[role]
            x,y=f[role+'_at']
            rect=[x,y,w,h]
            outer=padded_rect(rect,GUTTER)
            assert not any(overlaps(outer,p['padded_rect_px']) for p in parts)
            pixels=crop(raw,1254,1254,f[role])
            paste_extruded(atlas,WIDTH,HEIGHT,pixels,rect,GUTTER)
            part=dict(id=f['id']+'.'+role,source_rect_px=f[role],tile_rect_px=rect,
                      padded_rect_px=outer,origin_px=origin,
                      uv_rect_bottom_left=[x/WIDTH,1-(y+h)/HEIGHT,w/WIDTH,h/HEIGHT],
                      card_bounds_local=[-origin[0]/PIXELS_PER_UNIT,(origin[1]-h)/PIXELS_PER_UNIT,
                                         (w-origin[0])/PIXELS_PER_UNIT,origin[1]/PIXELS_PER_UNIT],
                      content_rgba_sha256=sha(pixels),source_pixels_per_atlas_pixel=1)
            if role=='body':
                part['shoulder_px']=body_shoulder
            else:
                part['shoulder_px']=arm_pivot
                part['grip_px']=[f['grip'][i]-f['arm'][i] for i in (0,1)]
            parts.append(part)
            source_rects.append(f[role])
        figures.append(dict(id=f['id'],body_part=f['id']+'.body',arm_part=f['id']+'.arm',
                            shoulder_body_local=local(body_shoulder,body_origin),
                            grip_arm_local=local(f['grip'],f['arm_pivot']),
                            stick_top_arm_local=local(f['stick_top'],f['arm_pivot']),
                            stick_bottom_arm_local=local(f['stick_bottom'],f['arm_pivot']),
                            inspection_body_height_px=f['visible_body_height_px'],
                            inspection_color=f['inspection_color']))
    output.mkdir(parents=True,exist_ok=True)
    atlas_path=output/'crowd-atlas.png'
    atlas_path.write_bytes(png(bytes(atlas),WIDTH,HEIGHT))
    decoded=decode(atlas_path)
    assert decoded==bytes(atlas), 'PNG encoding altered pixels'
    checks=[]
    for part in parts:
        pixels=crop(decoded,WIDTH,HEIGHT,part['tile_rect_px'])
        expected=crop(raw,1254,1254,part['source_rect_px'])
        assert pixels==expected,part['id']
        x,y,w,h=part['tile_rect_px']
        # Check every gutter texel, not only its corners.
        for yy in range(y-GUTTER,y+h+GUTTER):
            for xx in range(x-GUTTER,x+w+GUTTER):
                sx,sy=max(0,min(w-1,xx-x)),max(0,min(h-1,yy-y))
                assert decoded[(yy*WIDTH+xx)*4:(yy*WIDTH+xx)*4+4]==expected[(sy*w+sx)*4:(sy*w+sx)*4+4]
        checks.append(dict(part=part['id'],rgba_pixel_identity=True,all_gutter_pixels_match_nearest_edge=True))
    outside=[a for i,a in enumerate(raw[3::4]) if a and not any(x<=i%1254<x+w and y<=i//1254<y+h for x,y,w,h in source_rects)]
    assert max(outside,default=0)<=1, 'Material source pixels excluded by the established inspection crops'
    metadata=dict(schema='brightvale-silhouette-crowd-v1',status='derivative candidate; independent verification pending',
                  source=dict(path=str(SOURCE.relative_to(ROOT)),sha256=SOURCE_HASH,width=1254,height=1254),
                  atlas=dict(file='crowd-atlas.png',sha256=sha(atlas_path.read_bytes()),width=WIDTH,height=HEIGHT,
                             encoded_bytes=atlas_path.stat().st_size,decoded_rgba_bytes=len(atlas),gutter_px=GUTTER,
                             color_space='srgb (interpretation of untagged approved source; RGB values unchanged)',
                             alpha='straight, original 8-bit values retained; no alpha normalization',
                             flip_y=True,wrap='ClampToEdgeWrapping',min_filter='LinearFilter',mag_filter='LinearFilter',
                             generate_mipmaps=False,premultiply_alpha=False),
                  coordinates=dict(rects='top-left pixel edges [x,y,width,height]; half-open',
                                   landmarks='original image pixel-coordinate convention used by the accepted inspection; no extra half-pixel offset',
                                   card_local='x right, y up, z toward viewer; XY card plane',
                                   card_bounds='[left,bottom,right,top] relative to part origin',
                                   uv_rect='[u_min,v_min,u_span,v_span], bottom-left; ordinary plane UVs, Texture.flipY=true',
                                   units='provisional local units, not meters; 560 original pixels = 1 unit for ALL parts',
                                   source_pixels_per_unit=PIXELS_PER_UNIT,
                                   rotation='Three.js rotation.z radians = negative image-space inspection degrees * pi/180',
                                   assembly='body at root; arm origin at shoulder_body_local; rotate arm and stick together about that origin',
                                   depth='body in front of arm; original fist in front of stick and halo; choose small depth offsets in consumer'),
                  inspection=dict(image_angles_degrees=[-15,0,15],body_height_px=192,
                                  accepted_preview_sha256='5801f33d2fa37089cc4a0d793b4036a4561a82d7e095baf84ad523bb676ac5d2'),
                  parts=parts,figures=figures)
    dump(output/'crowd-atlas.json',metadata)
    assert sha(SOURCE.read_bytes())==SOURCE_HASH
    for name,h in protected.items(): assert sha((SOURCE.parent/name).read_bytes())==h,name
    report=dict(source_sha256=SOURCE_HASH,atlas_sha256=metadata['atlas']['sha256'],
                metadata_sha256=sha((output/'crowd-atlas.json').read_bytes()),
                source_original_hashes_unchanged=protected,parts=checks,
                crop_caveat=dict(excluded_nonzero_alpha_pixels=len(outside),max_excluded_alpha=max(outside,default=0),
                                explanation='Established inspection crops omit only 1/255-alpha background specks; no source pixel alpha >=2 omitted.'),
                dimensions=[WIDTH,HEIGHT],encoded_png_bytes=atlas_path.stat().st_size,decoded_rgba_bytes=len(atlas),
                tools=dict(python=platform.python_version(),zlib=zlib.ZLIB_VERSION,
                           imagemagick=subprocess.check_output(['magick','-version'],text=True).splitlines()[0]),
                limits=['No runtime, renderer, mobile or mipmapping validation.','No approved memory/population/performance budget.',
                        'Straight-alpha filtering and chosen consumer alpha test need actual-app inspection.',
                        'Gutters support the specified no-mipmap sampler; not a claim of bleed-free arbitrary mip levels.'])
    dump(output/'validation.json',report)
    print('[crowd-atlas] verified lossless tiles, gutters, source identity and metadata',flush=True)
    print(json.dumps(dict(atlas_sha256=report['atlas_sha256'],metadata_sha256=report['metadata_sha256'],
                          encoded_png_bytes=report['encoded_png_bytes'],decoded_rgba_bytes=len(atlas)),indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parent)
    build(parser.parse_args().output)
