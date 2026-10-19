"""Disposable neutral-light geometry evidence; never saves the opened source."""
import argparse
import sys
import subprocess
sys.dont_write_bytecode=True
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
import build as B

def encode_preview(png):
    webp=png.with_suffix('.webp')
    partial=png.with_name(png.stem+'.partial.webp')
    if webp.exists(): raise FileExistsError('Refusing existing preview output: '+str(webp))
    try:
        subprocess.run(['cwebp','-quiet','-q','80','-m','6','-alpha_q','100',str(png),'-o',str(partial)],check=True)
        if not partial.is_file() or partial.stat().st_size==0: raise RuntimeError('WebP preview missing or empty: '+str(partial))
        partial.replace(webp)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    png.unlink()
    return webp

VIEWS=['group-front','group-threequarter','A-front','B-front','C-front',
       'B-threequarter','C-threequarter','B-head','C-head','B-shoulder','C-shoulder',
       'B-rest','C-rest','B-back','C-back']


def aim(o,target):
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()


def render(out,views,samples=32):
    source=Path(bpy.data.filepath);before=B.sha(source);B.sources()
    paths=[out/(v+'.webp') for v in views]
    render_paths=[p.with_suffix('.png') for p in paths]
    if any(p.exists() for p in paths+render_paths):raise FileExistsError('Refusing existing preview output or render path')
    scene=bpy.context.scene;coll=bpy.data.collections.new('REVIEW_ONLY');scene.collection.children.link(coll)
    scene.render.engine='CYCLES';scene.cycles.samples=samples;scene.cycles.use_denoising=True
    scene.world=bpy.data.worlds.new('ReviewWorld');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.43,.43,.43,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.65
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
    for name,pos,energy,size in [('Key',(-3,-4,5),300,4),('Fill',(3,-3,3),170,4),('Rear',(1,3,4),220,3)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
        o=bpy.data.objects.new(name,data);coll.objects.link(o);o.location=pos;aim(o,(0,0,1))
    data=bpy.data.cameras.new('ReviewCamera');camera=bpy.data.objects.new('ReviewCamera',data);coll.objects.link(camera)
    scene.camera=camera;data.type='ORTHO'
    for view,path in zip(views,paths):
        render_path=path.with_suffix('.png')
        B.assigned_poses()
        cid,kind=view.split('-',1)
        group=cid=='group'
        for o in bpy.data.objects:
            if o.get('character_id'):o.hide_render=not group and o['character_id']!=cid
        if group:
            target=Vector((0,0,1.025));offset=(0,-7,0) if kind=='front' else (2.2,-8,.8)
            scale,width,height=4.05,1800,1100
        else:
            root=B.obj(cid,'NeutralBase');x=root.location.x
            target=Vector((x,0,1.04));offset=(0,-6,0);scale,width,height=2.25,1000,1100
            if kind=='threequarter':offset=(3,-6,.9)
            elif kind=='head':
                rig=B.obj(cid,'CrowdRig');center=rig.pose.bones['head'].head
                target=Vector((x,0,0))+center+Vector((0,0,.145));scale,width,height=.49,1000,1000;offset=(1,-6,.35)
            elif kind=='shoulder':
                rig=B.obj(cid,'CrowdRig');center=(rig.pose.bones['upper_arm.L'].head+rig.pose.bones['forearm.L'].head)*.5
                target=Vector((x,0,0))+center;scale,width,height=.85,1000,1000;offset=(1,-5,.9)
            elif kind=='rest':B.apply_pose(cid,'Rest')
            elif kind=='back':offset=(1.5,6,.6)
            elif kind!='front':raise ValueError(kind)
        camera.location=target+Vector(offset);aim(camera,target);data.ortho_scale=scale
        scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.resolution_percentage=100
        scene.render.image_settings.file_format='PNG';scene.render.filepath=str(render_path)
        print('TRIO RENDER BEGIN',view,render_path,flush=True)
        bpy.ops.render.render(write_still=True)
        assert render_path.stat().st_size>0
        encode_preview(render_path)
        print('TRIO RENDER COMPLETE',view,flush=True)
    assert B.sha(source)==before,'CANDIDATE MUTATED';B.sources()
    print('READ-ONLY RENDERS COMPLETE',before,flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--views',nargs='+',choices=VIEWS,default=VIEWS[:7]);parser.add_argument('--samples',type=int,default=32)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    assert args.output_dir.is_dir() and 1<=args.samples<=128
    render(args.output_dir.resolve(),args.views,args.samples)
