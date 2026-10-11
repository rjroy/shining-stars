"""Read-only review cameras; never saves or modifies the .blend on disk.
Run on an explicitly loaded .blend, -- --output-dir /absolute/existing/dir
--views neutral detail distance audience twilight reverse
Outputs PNG intermediates; convert selected evidence to WebP outside Blender.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
import bpy
from mathutils import Vector

# Import the adjacent build module without littering a read-only source package.
sys.dont_write_bytecode=True


def aim(obj,target):
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def geometry_signature():
    objects=sorted(bpy.data.collections['CITY_ASSET'].all_objects,key=lambda o:o.name)
    payload=[]
    for obj in objects:
        payload.append([obj.name,[list(row) for row in obj.matrix_world],
                        [list(v.co) for v in obj.data.vertices] if obj.type=='MESH' else None])
    return hashlib.sha256(json.dumps(payload,separators=(',',':')).encode()).hexdigest()


def render(out,views):
    source=Path(bpy.data.filepath)
    before=hashlib.sha256(source.read_bytes()).hexdigest()
    geometry_before=geometry_signature()
    spec=importlib.util.spec_from_file_location('city_build',Path(__file__).with_name('build.py'))
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    scene=bpy.context.scene
    studio=bpy.data.collections.new('REVIEW_STUDIO');scene.collection.children.link(studio)
    scene.render.engine='CYCLES';scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1600;scene.render.resolution_y=900
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.world=bpy.data.worlds.new('ReviewWorld');scene.world.use_nodes=True
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    camdata=bpy.data.cameras.new('ReviewCamera');cam=bpy.data.objects.new('ReviewCamera',camdata)
    studio.objects.link(cam);scene.camera=cam;camdata.clip_end=2000
    lights=[]
    for name,pos,power,size in [('Key',(-100,-100,190),160000,160),
                               ('Fill',(110,-40,100),70000,140),
                               ('Back',(20,150,150),120000,120)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
        obj=bpy.data.objects.new(name,data);studio.objects.link(obj);obj.location=pos
        aim(obj,(0,35,25));lights.append(obj)
    # Orthographic geometry evidence + explicit perspective concept-comparison camera.
    cameras={
        'neutral':((30,-270,130),(0,40,43),'ORTHO',287),
        'detail':((-100,-140,88),(-61,39,68),'ORTHO',118),
        'distance':((0,-355,60),(0,35,43),'PERSP',43),
        'audience':((0,-300,62),(0,38,46),'PERSP',40),
        'twilight':((0,-300,62),(0,38,46),'PERSP',40),
        'reverse':((155,220,155),(0,42,39),'ORTHO',365),
    }
    for view in views:
        scene.render.resolution_x=1100 if view=='detail' else 1600
        scene.render.resolution_y=1300 if view=='detail' else 900
        mode='twilight' if view=='twilight' else 'audience';mod.palette(mode)
        neutral=view in {'neutral','detail','reverse','distance'}
        if neutral:
            # neutral colors retain material regions; no bloom, fog, dramatic darkening.
            colors=[(.48,.47,.44),(.12,.13,.14),(.20,.23,.27),(.67,.64,.58),
                    (.46,.41,.31),(.75,.69,.49)]
            for name,color in zip(mod.MAT_NAMES,colors):
                node=bpy.data.materials[name].node_tree.nodes.get('Principled BSDF')
                node.inputs['Base Color'].default_value=(*color,1)
                node.inputs['Emission Strength'].default_value=0
        bg=scene.world.node_tree.nodes['Background']
        bg.inputs['Color'].default_value=(.22,.24,.28,1) if neutral else ((.075,.095,.18,1) if mode=='audience' else (.055,.023,.11,1))
        bg.inputs['Strength'].default_value=.65 if neutral else .50
        for i,l in enumerate(lights):
            l.data.color=(1,1,1) if neutral else ([(1,.73,.48),(.42,.49,1),(.67,.55,1)][i] if mode=='audience' else [(.65,.48,1),(.36,.30,.72),(.6,.35,1)][i])
        loc,target,kind,value=cameras[view];cam.location=loc;aim(cam,target);camdata.type=kind
        if kind=='ORTHO':camdata.ortho_scale=value
        else:camdata.lens=value
        scene.render.filepath=str(out/(view+'.png'))
        print('CITY RENDER BEGIN',view,scene.render.filepath,flush=True)
        bpy.ops.render.render(write_still=True)
        assert Path(scene.render.filepath).stat().st_size>0
        assert geometry_signature()==geometry_before,'Preview mutated asset geometry/transforms'
        print('CITY RENDER COMPLETE',view,flush=True)
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before,'Source changed during preview'
    print('SOURCE UNCHANGED',before,flush=True)
    print('ALL VIEWS SHARE ASSET GEOMETRY',geometry_before,flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--views',nargs='+',default=['neutral','detail','distance','audience','twilight','reverse'],
                        choices=['neutral','detail','distance','audience','twilight','reverse'])
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    assert args.output_dir.is_dir()
    render(args.output_dir.resolve(),args.views)
