"""Read-only matched study-size and diagnostic geometry renders; no source save."""
import argparse
import json
import math
from pathlib import Path
import sys
import subprocess
sys.dont_write_bytecode = True
import bpy
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
sys.path.insert(0, str(Path(__file__).resolve().parent))
import produce as P

STUDY = dict(position=[0,-15,13.899999618530273], rotation=[1.4559197425842285,0,0],
             lens_mm=28, sensor_width_mm=36, resolution=[1600,900],
             city_scale=.3499999940395355, city_translation=[0,55,3.8999998569488525])


def aim(o, target):
    o.rotation_euler = (Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()


def setup(view):
    root = bpy.data.objects['CITY.ProvisionalLayout']
    root.scale = (STUDY['city_scale'],)*3; root.location = STUDY['city_translation']
    s = bpy.context.scene
    cdata = bpy.data.cameras.new('Diagnostic camera'); c = bpy.data.objects.new('Diagnostic camera', cdata)
    s.collection.objects.link(c); s.camera = c; cdata.clip_end = 5000
    if view == 'study':
        c.location = STUDY['position']; c.rotation_euler = STUDY['rotation']
        cdata.lens = 28; cdata.sensor_width = 36
        s.render.resolution_x, s.render.resolution_y = STUDY['resolution']
    else:
        c.location = (-69,-39,49); aim(c,(-28,65,22))
        cdata.type = 'ORTHO'; cdata.ortho_scale = 52
        s.render.resolution_x = 1000; s.render.resolution_y = 1100
    s.render.resolution_percentage = 100
    s.render.engine = 'CYCLES'; s.cycles.samples = 24; s.cycles.use_denoising = True; s.cycles.seed = 422
    s.render.film_transparent = True
    s.view_settings.view_transform = 'AgX'; s.view_settings.look = 'AgX - Medium High Contrast'
    s.view_settings.exposure = 0
    s.world = bpy.data.worlds.new('Geometry review neutral world'); s.world.use_nodes = True
    bg = s.world.node_tree.nodes.get('Background'); bg.inputs['Color'].default_value = (.30,.30,.30,1)
    bg.inputs['Strength'].default_value = .7
    for name,position,energy,size in [('Key',(-50,25,75),38000,65),('Fill',(12,40,45),22000,55)]:
        d = bpy.data.lights.new(name,'AREA'); d.energy = energy; d.shape = 'DISK'; d.size = size
        o = bpy.data.objects.new(name,d); s.collection.objects.link(o); o.location = position; aim(o,(-26,64,20))
    # Identical restrained geometry review: keep role colors; no bloom/emissive glare.
    for mat in bpy.data.materials:
        mat.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value = 0
    bpy.context.view_layer.update()
    return s,c


def projected(s,c):
    records = {}
    for o in bpy.data.objects:
        if o.type != 'MESH': continue
        v = [world_to_camera_view(s,c,o.matrix_world @ p.co) for p in o.data.vertices]
        lo = [min(p.x for p in v)*s.render.resolution_x, (1-max(p.y for p in v))*s.render.resolution_y]
        hi = [max(p.x for p in v)*s.render.resolution_x, (1-min(p.y for p in v))*s.render.resolution_y]
        records[o.name] = dict(min_px=lo,max_px=hi,width_px=hi[0]-lo[0],height_px=hi[1]-lo[1])
    return records


def extrusion_pixels(s,c):
    values=[]
    for o in bpy.data.objects:
        if o.type!='MESH': continue
        for vertices,faces in P.components(o.data):
            n=len(vertices)//2
            if n not in (4,7) or len(vertices)!=n*2 or len(faces)!=n+2: continue
            delta=o.data.vertices[vertices[n]].co-o.data.vertices[vertices[0]].co
            if abs(delta.length-(.07 if n==7 else .09))>1e-5: continue
            for a,b in zip(vertices[:n],vertices[n:]):
                va=world_to_camera_view(s,c,o.matrix_world@o.data.vertices[a].co)
                vb=world_to_camera_view(s,c,o.matrix_world@o.data.vertices[b].co)
                values.append(math.hypot((va.x-vb.x)*1600,(va.y-vb.y)*900))
    return dict(maximum_px=max(values),samples=len(values),mean_px=sum(values)/len(values))


def silhouette_metrics(out):
    result={}
    for view in ('study','detail'):
        masks=[]
        for kind in ('source','derived'):
            image=bpy.data.images.load(str(out/(kind+'-'+view+'.png')))
            pixels=np.empty(image.size[0]*image.size[1]*4,dtype=np.float32)
            image.pixels.foreach_get(pixels)
            masks.append(pixels.reshape(-1,4)[:,3]>.5)
            bpy.data.images.remove(image)
        a,b=masks
        result[view]=dict(alpha_threshold=.5,silhouette_iou=float(np.sum(a&b)/np.sum(a|b)),
            differing_pixels=int(np.sum(a!=b)),foreground_union_pixels=int(np.sum(a|b)))
    return result


def comparison_sheet(out,destination):
    """Image operations only: equal matte, labels, unscaled crop; no retouching."""
    print('CITY COMPARISON ASSEMBLY ATTEMPT',destination,flush=True)
    def run(*args):subprocess.run(args,check=True,timeout=60)
    for row,view in [('top','study'),('bottom','detail')]:
        for kind in ('source','derived'):
            label=kind.upper()+' | '+('study crop, 1:1 pixels' if kind=='source' else 'same camera and city transform') if view=='study' else kind.upper()+' | '+('full silhouette diagnostic' if kind=='source' else '56% fewer placed triangles')
            crop=['-crop','1000x600+0+0','+repage'] if view=='study' else []
            run('magick',str(out/(kind+'-'+view+'.png')),*crop,
                '-background','#24262b','-alpha','remove','-alpha','off','-gravity','north',
                '-background','#24262b','-splice','0x54','-fill','white','-font','Adwaita-Mono',
                '-pointsize','20','-annotate','+0+16',label,str(out/(row+'-'+kind+'.png')))
        run('magick',str(out/(row+'-source.png')),str(out/(row+'-derived.png')),'+append',str(out/(row+'.png')))
    run('magick',str(out/'top.png'),str(out/'bottom.png'),'-append',str(out/'comparison.png'))
    run('cwebp','-quiet','-q','92',str(out/'comparison.png'),'-o',str(destination))
    print('CITY COMPARISON ASSEMBLY SUCCESS',destination,flush=True)


def main():
    p=argparse.ArgumentParser(); p.add_argument('--source',type=Path,default=P.SOURCE)
    p.add_argument('--derived',type=Path,required=True); p.add_argument('--output-dir',type=Path,required=True)
    p.add_argument('--comparison',type=Path,help='Optional new labeled WebP; requires installed magick/cwebp')
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:]); out=a.output_dir.resolve()
    assert out.is_relative_to('/tmp/opencode') and out.is_dir(), 'Raw previews belong in authorized scratch'
    comparison=P.output(a.comparison,'.webp') if a.comparison else None
    hashes={str(f):P.sha(f) for f in (a.source,a.derived)}; report={'study_camera':STUDY}
    try:
        for kind,path in [('source',a.source),('derived',a.derived)]:
            for view in ('study','detail'):
                if kind=='source': P.load_source(path); P.select_slice()
                else: bpy.ops.wm.open_mainfile(filepath=str(path))
                s,c=setup(view)
                if view=='study':
                    report[kind+'_projected_objects']=projected(s,c)
                    if kind=='source':report['removed_extrusion_screen_depth']=extrusion_pixels(s,c)
                image=P.output(out/(kind+'-'+view+'.png'),'.png')
                s.render.image_settings.file_format='PNG'; s.render.image_settings.color_mode='RGBA'; s.render.filepath=str(image)
                print('CITY RENDER ATTEMPT',image,flush=True)
                assert bpy.ops.render.render(write_still=True)=={'FINISHED'} and image.stat().st_size>0
                print('CITY RENDER SUCCESS',image,flush=True)
        report['rendered_silhouette_comparison']=silhouette_metrics(out)
        P.output(out/'projection.json','.json').write_text(json.dumps(report,indent=2)+'\n')
        if comparison:comparison_sheet(out,comparison)
    finally:
        assert all(P.sha(f)==h for f,h in hashes.items()),'Read-only preview changed an input'


if __name__=='__main__':main()
