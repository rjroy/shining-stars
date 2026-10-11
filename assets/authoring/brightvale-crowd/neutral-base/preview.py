"""Disposable neutral geometry views of a saved source; never saves that source."""
import argparse
import hashlib
import sys
from pathlib import Path
import bpy
from mathutils import Vector


def aim(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def render(out,views):
    source=Path(bpy.data.filepath);before=hashlib.sha256(source.read_bytes()).hexdigest()
    expected=[out/(v+'.png') for v in views]
    if any(p.exists() for p in expected):raise FileExistsError('Refusing existing preview output')
    scene=bpy.context.scene
    coll=bpy.data.collections.new('REVIEW_ONLY');scene.collection.children.link(coll)
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
    scene.world=bpy.data.worlds.new('ReviewWorld');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.43,.43,.43,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.65
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
    for name,location,energy,size in [('Key',(-3,-4,5),300,4),('Fill',(3,-3,3),170,4),('Rear',(1,3,4),220,3)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
        obj=bpy.data.objects.new(name,data);coll.objects.link(obj);obj.location=location;aim(obj,(0,0,1))
    cd=bpy.data.cameras.new('ReviewCamera');cam=bpy.data.objects.new('ReviewCamera',cd);coll.objects.link(cam)
    scene.camera=cam;cd.type='ORTHO'
    setups={
        'head':((0,-4,1.66),(0,-.01,1.66),.43,1000,1000),
        'head-side':((4,-.1,1.65),(0,0,1.65),.43,1000,1000),
        'upper':((2,-5,2.1),(0,0,1.40),.96,1000,1000),
        'front':((0,-6,.92),(0,0,.92),2.06,1200,1200),
        'side':((6,0,1.05),(0,0,.92),2.06,1000,1200),
        'threequarter':((3,-6,2.0),(0,0,.94),2.10,1200,1200),
        'back':((0,6,.92),(0,0,.92),2.06,1200,1200),
        'hand':((.755,-3,1.409),(.755,0,1.409),.31,1000,1000),
        'topology':((2.6,-6,2.0),(0,0,.94),2.10,1200,1200),
        'shoulder':((.58,-3,1.70),(.245,0,1.415),.63,1200,1000),
    }
    for view in views:
        loc,target,scale,w,h=setups[view];cam.location=loc;aim(cam,target);cd.ortho_scale=scale
        scene.render.resolution_x=w;scene.render.resolution_y=h;scene.render.resolution_percentage=100
        wires=[]
        if view=='topology':
            mat=bpy.data.materials.new('ReviewWire');mat.diffuse_color=(.012,.012,.012,1)
            for obj in list(bpy.data.collections['NEUTRAL_CHARACTER'].objects):
                if obj.type!='MESH':continue
                duplicate=obj.copy();duplicate.data=obj.data.copy();coll.objects.link(duplicate)
                duplicate.data.materials.clear();duplicate.data.materials.append(mat)
                mod=duplicate.modifiers.new('Review only edge overlay','WIREFRAME');mod.thickness=.00065;mod.offset=1
                wires.append(duplicate)
        scene.render.image_settings.file_format='PNG';scene.render.filepath=str(out/(view+'.png'))
        print('NEUTRAL RENDER BEGIN',view,flush=True);bpy.ops.render.render(write_still=True)
        assert (out/(view+'.png')).stat().st_size>0
        for obj in wires:bpy.data.objects.remove(obj,do_unlink=True)
        print('NEUTRAL RENDER COMPLETE',view,flush=True)
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before,'SOURCE MUTATED'
    print('SOURCE UNCHANGED',before,flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True)
    p.add_argument('--views',nargs='+',default=['front','side','threequarter','shoulder','back','head','hand','topology'])
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);assert args.output_dir.is_dir()
    render(args.output_dir.resolve(),args.views)
