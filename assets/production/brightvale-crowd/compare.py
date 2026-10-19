"""Read-only actual-model comparison at study sizes plus 3/4 diagnostics.

Uses ImageMagick for scratch PNG assembly and cwebp for the maintained WebP.
Intermediate PNGs stay in scratch. Never saves a blend.
"""
import argparse
import importlib.util
import subprocess
import sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
from mathutils import Vector

spec=importlib.util.spec_from_file_location('crowd_build',Path(__file__).with_name('build.py'))
B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B)

def encode_webp(source, dest):
    assert not dest.exists(), 'Refusing existing WebP'
    partial=dest.with_name(dest.stem+'.partial.webp')
    if partial.exists(): raise FileExistsError('Refusing stale partial WebP: '+str(partial))
    try:
        subprocess.run(['cwebp','-quiet','-q','80','-m','6','-alpha_q','100',str(source),'-o',str(partial)],check=True)
        if not partial.is_file() or partial.stat().st_size==0:
            raise RuntimeError('WebP output missing or empty: '+str(partial))
        partial.replace(dest)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise

def run(args):
    B.protected(args.source); derived_hash=B.sha(args.derived)
    dest=B.new_output(args.sheet,'.webp'); out=args.scratch.resolve()
    assert out.is_relative_to(Path('/tmp/opencode')) and out.is_dir()
    assembled=B.new_output(out/'comparison-sheet.png','.png')
    bpy.ops.wm.open_mainfile(filepath=str(args.source))
    originals=list(bpy.context.scene.objects)
    pair={}
    for cid in 'ABC':
        for pose in B.POSES:
            B.pose(cid,pose)
            obj=B.merge(B.frozen_parts(cid),'Source.'+cid+'.'+pose)
            floor=min(v.co.z for v in obj.data.vertices)
            for v in obj.data.vertices:v.co.z-=floor
            obj.hide_render=True
            pair['Crowd.'+cid+'.'+pose]=[obj]
    for obj in originals:obj.hide_render=True
    with bpy.data.libraries.load(str(args.derived),link=False) as (a,b):
        b.objects=[n for n in a.objects if n.endswith('.Surface')]
    for obj in b.objects:
        bpy.context.scene.collection.objects.link(obj)
        obj.hide_render=True;pair[obj['pose_id']].append(obj)
    scene=bpy.context.scene
    scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.render.film_transparent=False
    scene.world=bpy.data.worlds.new('Neutral comparison world');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.19,.19,.19,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
    scene.view_settings.exposure=0
    for name,pos,power,size in [('Key',(-3,-4,6),450,5),('Fill',(4,-2,3),220,4),('Back',(0,4,5),300,4)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
        obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=pos
        obj.rotation_euler=(Vector((0,0,1))-obj.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Comparison camera');data.type='ORTHO';data.ortho_scale=2.35
    cam=bpy.data.objects.new('Comparison camera',data);scene.collection.objects.link(cam);scene.camera=cam
    for pid,objects in pair.items():
        for view,size,position in [('near',180,(0,-7,1)),('far',80,(0,-7,1)),('threequarter',240,(3,-6,2.6))]:
            cam.location=position;cam.rotation_euler=(Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler()
            scene.render.resolution_x=scene.render.resolution_y=size
            for i,obj in enumerate(objects):
                image=out/(pid+'.'+view+('.source' if i==0 else '.reduced')+'.png')
                B.new_output(image,'.png');obj.hide_render=False
                scene.render.filepath=str(image)
                print('CROWD RENDER ATTEMPT',image,flush=True)
                bpy.ops.render.render(write_still=True)
                obj.hide_render=True
                assert image.stat().st_size>0
                print('CROWD RENDER SUCCESS',image,flush=True)
    font=subprocess.check_output(['fc-match','-f','%{file}','sans'],text=True)
    magick=['magick','-font',font,'-background','#e6e6e6','-fill','#222222']
    cells=[]
    for pid in pair:
        rows=[]
        for view in ('near','far','threequarter'):
            row=out/(pid+'.'+view+'.row.png')
            subprocess.run(magick+[str(out/(pid+'.'+view+'.source.png')),str(out/(pid+'.'+view+'.reduced.png')),
                '+append','-gravity','center','-extent','480x'+str({'near':180,'far':80,'threequarter':240}[view]),str(row)],check=True)
            rows.append(row)
        cell=out/(pid+'.cell.png')
        subprocess.run(magick+['-pointsize','17','-size','480x32','label:'+pid+'  |  source / reduced',
            *map(str,rows),'-append',str(cell)],check=True)
        cells.append(cell)
    rows=[]
    for i,cid in enumerate('ABC'):
        row=out/(cid+'.row.png')
        subprocess.run(magick+list(map(str,cells[i*3:i*3+3]))+['+append',str(row)],check=True);rows.append(row)
    subprocess.run(magick+['-pointsize','21','-size','1440x68',
        'label:Approved source vs reduced static pose bank\nFront ~138–150 px / ~61–66 px; larger 3/4 geometry diagnostic below',
        *map(str,rows),'-append','-depth','8',str(assembled)],check=True)
    encode_webp(assembled,dest)
    # Decode final sheet independently of its filename.
    image=bpy.data.images.load(str(dest));assert list(image.size)==[1440,1664]
    B.protected(args.source);assert B.sha(args.derived)==derived_hash
    print('CROWD COMPARISON SUCCESS',dest,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=B.SOURCE)
    p.add_argument('--derived',type=Path,required=True);p.add_argument('--scratch',type=Path,required=True)
    p.add_argument('--sheet',type=Path,required=True)
    run(p.parse_args(sys.argv[sys.argv.index('--')+1:]))
