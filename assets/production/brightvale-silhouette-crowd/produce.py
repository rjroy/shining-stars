#!/usr/bin/env python3
"""Reproducible, lossless waist-up atlas from approved source; no runtime edits."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import struct
import subprocess
import zlib

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'assets/authoring/brightvale-silhouette-crowd/pilot-candidate-waist-up.png'
SOURCE_HASH = '92cbcf67c40fea19978aaba31cb49ce0600f7bbfe886d7d076c34ce2b2d5c5ed'
WIDTH, HEIGHT, GUTTER, PIXELS_PER_UNIT = 1440, 1120, 16, 560
ATLAS_NAME = 'crowd-atlas-waist-up.png'
METADATA_NAME = 'crowd-atlas-waist-up.json'
VALIDATION_NAME = 'validation-waist-up.json'
# New-source image coordinates, y down. All parts remain at original 1:1 scale.
# Arms retain the approved across/above-head gesture; no mirror/repair/45deg turn.
# Neutral shafts pass vertically through the opaque center of the new palm.
FIGURES = [
    dict(id='A', body=[145,30,485,620], arm=[720,40,400,500],
         body_at=[16,16], arm_at=[1015,16], shoulder=[589,375], arm_pivot=[1067,453],
         grip=[791,126], stick_top=[791,-15], stick_bottom=[791,173],
         lower_torso=[270,475,290,155], inspection_color='#55ddff'),
    dict(id='B', body=[170,650,450,594], arm=[720,650,400,540],
         body_at=[533,16], arm_at=[1015,548], shoulder=[572,1007], arm_pivot=[1067,1081],
         grip=[796,750], stick_top=[796,609], stick_bottom=[796,797],
         lower_torso=[290,1090,250,140], inspection_color='#ff65c7'),
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
                lx,ly,lw,lh=f['lower_torso']
                assert sx<=lx and sy<=ly and lx+lw<=sx+w and ly+lh<=sy+h
                part['lower_torso_source_rect_px']=f['lower_torso']
                part['lower_torso_tile_rect_px']=[x+lx-sx,y+ly-sy,lw,lh]
                part['lower_torso_note']='Approved waist/lower-torso pixels, including authored alpha; region annotation only, no fade or cleanup added.'
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
                            neutral_stick_orientation='vertical in the source/card plane; follows the existing arm wave, no additional 45-degree offset',
                            inspection_color=f['inspection_color']))
    output.mkdir(parents=True,exist_ok=True)
    atlas_path=output/ATLAS_NAME
    atlas_path.write_bytes(png(bytes(atlas),WIDTH,HEIGHT))
    decoded=decode(atlas_path)
    assert decoded==bytes(atlas), 'PNG encoding altered pixels'
    checks=[]
    for part in parts:
        pixels=crop(decoded,WIDTH,HEIGHT,part['tile_rect_px'])
        expected=crop(raw,1254,1254,part['source_rect_px'])
        assert pixels==expected,part['id']
        u,v,uw,vh=part['uv_rect_bottom_left']
        assert 0<=u<u+uw<=1 and 0<=v<v+vh<=1,part['id']
        x,y,w,h=part['tile_rect_px']
        # Check every gutter texel, not only its corners.
        for yy in range(y-GUTTER,y+h+GUTTER):
            for xx in range(x-GUTTER,x+w+GUTTER):
                sx,sy=max(0,min(w-1,xx-x)),max(0,min(h-1,yy-y))
                assert decoded[(yy*WIDTH+xx)*4:(yy*WIDTH+xx)*4+4]==expected[(sy*w+sx)*4:(sy*w+sx)*4+4]
        checks.append(dict(part=part['id'],rgba_pixel_identity=True,all_gutter_pixels_match_nearest_edge=True))
    outside=[a for i,a in enumerate(raw[3::4]) if a and not any(x<=i%1254<x+w and y<=i//1254<y+h for x,y,w,h in source_rects)]
    assert max(outside,default=0)<=1, 'New source crops exclude more than 1/255-alpha background specks'
    for f in FIGURES:
        gx,gy=f['grip']
        assert raw[(gy*1254+gx)*4+3]>=250, 'Grip must lie inside the approved palm'
        assert f['stick_top'][0]==gx==f['stick_bottom'][0], 'Neutral stick must remain vertical'
        assert f['stick_top'][1]<gy<f['stick_bottom'][1]
    metadata=dict(schema='brightvale-silhouette-crowd-v1',status='derivative candidate; independent verification pending',
                  source=dict(path=str(SOURCE.relative_to(ROOT)),sha256=SOURCE_HASH,width=1254,height=1254),
                  atlas=dict(file=ATLAS_NAME,sha256=sha(atlas_path.read_bytes()),width=WIDTH,height=HEIGHT,
                             encoded_bytes=atlas_path.stat().st_size,decoded_rgba_bytes=len(atlas),gutter_px=GUTTER,
                             color_space='srgb (interpretation of untagged approved source; RGB values unchanged)',
                             alpha='straight, original 8-bit values retained; no alpha normalization',
                             flip_y=True,wrap='ClampToEdgeWrapping',min_filter='LinearFilter',mag_filter='LinearFilter',
                             generate_mipmaps=False,premultiply_alpha=False),
                  coordinates=dict(rects='top-left pixel edges [x,y,width,height]; half-open',
                                   landmarks='new approved source pixel coordinates; no additional half-pixel offset, mirroring or source resampling',
                                   card_local='x right, y up, z toward viewer; XY card plane',
                                   card_bounds='[left,bottom,right,top] relative to part origin',
                                   uv_rect='[u_min,v_min,u_span,v_span], bottom-left; ordinary plane UVs, Texture.flipY=true',
                                   units='provisional local units, not meters; 560 original pixels = 1 unit for ALL new parts',
                                   source_pixels_per_unit=PIXELS_PER_UNIT,
                                   rotation='Three.js rotation.z radians = negative image-space inspection degrees * pi/180',
                                   assembly='body at root; arm origin at shoulder_body_local; rotate arm and stick together about that origin',
                                   depth='body in front of arm; original fist in front of stick and halo; choose small depth offsets in consumer'),
                  inspection=dict(image_angles_degrees=[-15,0,15],pixels_per_local_unit=192,
                                  source_approval_sha256=SOURCE_HASH,
                                  stick_orientation='vertical at neutral; previous 45deg CCW direction is superseded'),
                  parts=parts,figures=figures)
    dump(output/METADATA_NAME,metadata)
    assert sha(SOURCE.read_bytes())==SOURCE_HASH
    for name,h in protected.items(): assert sha((SOURCE.parent/name).read_bytes())==h,name
    report=dict(source_sha256=SOURCE_HASH,atlas_sha256=metadata['atlas']['sha256'],
                metadata_sha256=sha((output/METADATA_NAME).read_bytes()),
                source_original_hashes_unchanged=protected,parts=checks,
                crop_caveat=dict(excluded_nonzero_alpha_pixels=len(outside),max_excluded_alpha=max(outside,default=0),
                                explanation='New part crops omit only 1/255-alpha background specks; all source pixels with alpha >=2 are retained. No within-tile background cleanup.'),
                attachment_source_landmarks=FIGURES,
                grip_alpha={f['id']:raw[(f['grip'][1]*1254+f['grip'][0])*4+3] for f in FIGURES},
                neutral_sticks_vertical=True,
                dimensions=[WIDTH,HEIGHT],encoded_png_bytes=atlas_path.stat().st_size,decoded_rgba_bytes=len(atlas),
                tools=dict(python=platform.python_version(),zlib=zlib.ZLIB_VERSION,
                           imagemagick=subprocess.check_output(['magick','-version'],text=True).splitlines()[0]),
                limits=['No runtime, renderer, mobile or mipmapping validation.','No approved memory/population/performance budget.',
                        'Straight-alpha filtering and chosen consumer alpha test need actual-app inspection.',
                        'Gutters support the specified no-mipmap sampler; not a claim of bleed-free arbitrary mip levels.'])
    dump(output/VALIDATION_NAME,report)
    print('[crowd-atlas] verified lossless tiles, gutters, source identity and metadata',flush=True)
    print(json.dumps(dict(atlas_sha256=report['atlas_sha256'],metadata_sha256=report['metadata_sha256'],
                          encoded_png_bytes=report['encoded_png_bytes'],decoded_rgba_bytes=len(atlas)),indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parent)
    build(parser.parse_args().output)
