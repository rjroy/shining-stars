#!/usr/bin/env python3
"""Reassemble the actual decoded atlas using only its attachment metadata."""
import argparse
import json
import math
from pathlib import Path
import subprocess
import tempfile
import produce as p

FONT='/usr/share/fonts/liberation/LiberationSans-Regular.ttf'


def run(*args):
    result=subprocess.run(['magick',*map(str,args)],capture_output=True)
    if result.returncode: raise RuntimeError(result.stderr.decode(errors='replace'))


def inspect(package,qa_dir,reference,metadata_name):
    print('[crowd-atlas] inspecting actual atlas and metadata assembly',flush=True)
    meta=json.loads((package/metadata_name).read_text())
    atlas=package/meta['atlas']['file']
    assert p.sha(atlas.read_bytes())==meta['atlas']['sha256']
    decoded=p.decode(atlas)
    parts={v['id']:v for v in meta['parts']}
    for part in parts.values():
        assert p.sha(p.crop(decoded,meta['atlas']['width'],meta['atlas']['height'],part['tile_rect_px']))==part['content_rgba_sha256']
    qa_dir.mkdir(parents=True,exist_ok=True)
    packed=qa_dir/'waist-up-atlas-packed-inspection.png'
    run(atlas,'-background','#788390','-alpha','remove','-alpha','off',packed)
    records=[]
    scale_px=meta['coordinates']['source_pixels_per_unit']
    with tempfile.TemporaryDirectory(prefix='crowd-atlas-qa-',dir='/tmp/opencode') as tmp:
        work=Path(tmp)
        sheet=work/'sheet.png'
        run('-size','1440x880','xc:#121a26',sheet)
        for row,figure in enumerate(meta['figures']):
            body,arm=parts[figure['body_part']],parts[figure['arm_part']]
            body_image,arm_image=work/'body.png',work/'arm.png'
            for part,dest in [(body,body_image),(arm,arm_image)]:
                x,y,w,h=part['tile_rect_px']
                run(atlas,'-crop',f'{w}x{h}+{x}+{y}','+repage',dest)
            shoulder=[100+body['shoulder_px'][0],230+body['shoulder_px'][1]]
            for col,degrees in enumerate(meta['inspection']['image_angles_degrees']):
                c,s=math.cos(math.radians(degrees)),math.sin(math.radians(degrees))

                def transformed(local):
                    dx,dy=local[0]*scale_px,-local[1]*scale_px
                    return [shoulder[0]+c*dx-s*dy,shoulder[1]+s*dx+c*dy]

                px,py=arm['origin_px']
                tx,ty=shoulder[0]-c*px+s*py,shoulder[1]-s*px-c*py
                posed=work/'posed.png'
                run(arm_image,'-virtual-pixel','transparent','-define','distort:viewport=1000x1000+0+0',
                    '-distort','AffineProjection',f'{c},{s},{-s},{c},{tx},{ty}','+repage',posed)
                top,bottom=transformed(figure['stick_top_arm_local']),transformed(figure['stick_bottom_arm_local'])
                grip=transformed(figure['grip_arm_local'])
                mapped_pivot=[c*px-s*py+tx,s*px+c*py+ty]
                pivot_error=math.dist(mapped_pivot,shoulder)
                vx,vy=bottom[0]-top[0],bottom[1]-top[1]
                grip_axis_error=abs(vx*(top[1]-grip[1])-(top[0]-grip[0])*vy)/math.hypot(vx,vy)
                assert pivot_error<1e-8 and grip_axis_error<1e-8
                if degrees==0: assert abs(top[0]-bottom[0])<1e-8,'Neutral shaft must be vertical'
                line=f'line {top[0]},{top[1]} {bottom[0]},{bottom[1]}'
                halo,core,assembled=work/'halo.png',work/'core.png',work/'assembled.png'
                run('-size','1000x1000','xc:none','-stroke',figure['inspection_color'],'-strokewidth','15',
                    '-draw',line,'-blur','0x8','-channel','A','-evaluate','multiply','0.24','+channel',halo)
                run('-size','1000x1000','xc:none','-stroke',figure['inspection_color'],'-strokewidth','6',
                    '-draw',line,'-stroke','#eaffff','-strokewidth','2','-draw',line,core)
                run('-size','1000x1000','xc:none',halo,'-composite',core,'-composite',posed,'-composite',
                    body_image,'-geometry','+100+230','-composite',assembled)
                small,inset=work/'small.png',work/'inset.png'
                resize=meta['inspection']['pixels_per_local_unit']/scale_px
                run(assembled,'-filter','Lanczos','-resize',f'{round(1000*resize)}x{round(1000*resize)}!',small)
                ix,iy=round(shoulder[0]-85),round(shoulder[1]-70)
                run(assembled,'-crop',f'180x155+{ix}+{iy}','+repage','-background','#788390',
                    '-alpha','remove','-alpha','off','-resize','135x116!',inset)
                x,y=col*480,64+row*380
                run(sheet,'-fill','#202936','-draw',f'rectangle {x+8},{y+5} {x+471},{y+367}',
                    small,'-geometry',f'+{x+12}+{y+36}','-composite',inset,'-geometry',f'+{x+329}+{y+180}','-composite',
                    '-font',FONT,'-pointsize','18','-fill','#e2e8f0',
                    '-draw',f"text {x+20},{y+29} 'Figure {figure['id']} | {degrees:+d} deg'",
                    '-pointsize','12','-fill','#bac6d7',
                    '-draw',f"text {x+329},{y+170} 'Shoulder / lighter ground'",
                    '-draw',f"text {x+20},{y+345} 'Shared 192 px/unit | approved waist-up atlas pixels'",sheet)
                records.append(dict(figure=figure['id'],angle_degrees=degrees,shoulder_canvas=shoulder,
                                    grip_canvas=grip,stick_top_canvas=top,stick_bottom_canvas=bottom,
                                    arm_affine=[c,s,-s,c,tx,ty],
                                    shoulder_mapping_error_px=pivot_error,grip_axis_error_px=grip_axis_error))
        preview=qa_dir/'waist-up-atlas-assembled-inspection.png'
        run(sheet,'-font',FONT,'-fill','#e2e8f0','-pointsize','23',
            '-draw',"text 22,31 'WAIST-UP DERIVATIVE QA / new approved anatomy / vertical neutral grip'",
            '-pointsize','13','-fill','#bac6d7',
            '-draw',"text 22,53 'Actual packed pixels, common source scale, new source shoulder and palm coordinates. No 45-degree offset.'",
            '-draw',"text 22,842 'Body over arm; approved fist over inspection-only shaft/halo. Source gesture, rims and lower alpha retained without repair.'",
            '-draw',"text 22,862 'CPU inspection only: no shader, GPU UV filtering, mipmaps, runtime integration or mobile-performance claim.'",preview)
    maximum=0
    if reference:
        old=json.loads(reference.read_text())
        assert old['source_sha256']==meta['source']['sha256']
        for actual,expected in zip(records,old['poses'],strict=True):
            assert actual['figure']==expected['figure'] and actual['angle_degrees']==expected['angle_degrees']
            for key in ('shoulder_canvas','grip_canvas','stick_top_canvas','stick_bottom_canvas','arm_affine'):
                maximum=max(maximum,max(abs(a-b) for a,b in zip(actual[key],expected[key],strict=True)))
        assert maximum<1e-8,maximum
    report=dict(atlas_sha256=meta['atlas']['sha256'],metadata_sha256=p.sha((package/metadata_name).read_bytes()),
                preview=preview.name,preview_sha256=p.sha(preview.read_bytes()),
                reference_report=str(reference.relative_to(p.ROOT)) if reference else None,
                maximum_reference_pose_coordinate_error_px=maximum if reference else None,
                parts_extracted_from_actual_atlas_match_metadata_hashes=True,poses=records,
                caveat='CPU reconstruction does not validate Three.js UV/flipY/filtering; that belongs to the next actual-consumer phase.')
    p.dump(qa_dir/'waist-up-atlas-inspection-report.json',report)
    print(json.dumps(dict(preview=str(preview),maximum_reference_pose_coordinate_error_px=report['maximum_reference_pose_coordinate_error_px']),indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package',type=Path,default=Path(__file__).resolve().parent)
    parser.add_argument('--qa-dir',type=Path,required=True)
    parser.add_argument('--reference-report',type=Path)
    parser.add_argument('--metadata',default='crowd-atlas-waist-up.json')
    args=parser.parse_args()
    inspect(args.package.resolve(),args.qa_dir.resolve(),args.reference_report.resolve() if args.reference_report else None,args.metadata)
