"""Read-only actual-model previews; TEMP diagnostic cameras, no game-fit claim."""
import argparse
import json
import sys
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
import build
import validate
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

VIEWS=['neutral-modules','neutral-section','neutral-post','neutral-placement',
       'assembly-audience','assembly-twilight']


def lighting(mode):
    scene=bpy.context.scene
    world=scene.world.node_tree.nodes.get('Background')
    floor=bpy.data.objects.get('Studio floor')
    if floor is None:
        floor=next(o for o in scene.objects if o.name.startswith('Studio') and o.type=='MESH')
    floor.scale.x*=5.;floor.scale.y*=5.
    floor_mat=floor.data.materials[0].copy();floor.data.materials[0]=floor_mat
    fp=floor_mat.node_tree.nodes.get('Principled BSDF')
    if mode=='audience':
        wc,fc,strength=(.10,.055,.022,1),(.05,.03,.018,1),.32
        colors=[(1,.72,.43),(1,.78,.54),(1,.48,.22),(1,.86,.68)]
    elif mode=='twilight':
        wc,fc,strength=(.01,.012,.05,1),(.012,.016,.05,1),.28
        colors=[(.58,.63,1),(.32,.42,1),(.62,.30,1),(.48,.58,1)]
    else:
        wc,fc,strength=(.22,.22,.22,1),(.18,.18,.18,1),.6
        colors=[(1,1,1)]*4
    world.inputs['Color'].default_value=wc
    world.inputs['Strength'].default_value=strength
    fp.inputs['Base Color'].default_value=fc
    lights=[o for o in scene.objects if o.type=='LIGHT']
    for i,o in enumerate(sorted(lights,key=lambda o:o.name)):
        o.data.color=colors[i%4]
        o.data.energy=[450,350,250,180][i%4]
    # Broad review softboxes cover the entire sparse study, not final lighting.
    for name,loc,energy in [('TEMP | review softbox',(-8,-6,14),1900),
                            ('TEMP | review fill',(10,9,12),1400)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=10
        data.color=(1,1,1) if mode=='neutral' else colors[0 if energy==1900 else 2]
        o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=loc
        o.rotation_euler=(Vector((0,5,0))-o.location).to_track_quat('-Z','Y').to_euler()


def camera(location,target,scale):
    data=bpy.data.cameras.new('TEMP | diagnostic orthographic camera')
    data.type='ORTHO';data.ortho_scale=scale;data.clip_end=300
    o=bpy.data.objects.new(data.name,data);bpy.context.scene.collection.objects.link(o)
    o.location=location;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.scene.camera=o
    return o


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output-dir',required=True)
    ap.add_argument('--view',choices=VIEWS+['all'],default='all')
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    out=build.allowed(args.output_dir)
    assert not out.exists(),'Preview output directory exists; choose NEW output'
    source=Path(bpy.data.filepath).resolve();before=build.sha(source);immutable=build.integrity()
    original_camera=validate.camera_state()
    views=VIEWS if args.view=='all' else [args.view]
    out.mkdir(parents=True)
    evidence={}
    print('PREVIEW_ATTEMPT',str(source),before,views,flush=True)
    for view in views:
        bpy.ops.wm.open_mainfile(filepath=str(source))
        asset=list(bpy.data.collections[build.ASSET].objects)
        roots=[o for o in asset if o.type=='EMPTY']
        references=list(bpy.data.collections[build.REFERENCE].objects)
        mode='audience' if view.endswith('audience') else 'twilight' if view.endswith('twilight') else 'neutral'
        lighting(mode)
        scene=bpy.context.scene
        scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
        scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
        scene.render.image_settings.file_format='PNG'
        scene.view_settings.view_transform='AgX';scene.view_settings.exposure=0
        scene.use_nodes=False
        visible=[]
        if view=='neutral-modules':
            for o in references: o.hide_render=True
            positions={('left','long'):(-7.7,0),('left','post'):(-4.45,.8),
                       ('left','short'):(-2.05,1.75),('right','short'):(2.05,1.75),
                       ('right','post'):(4.45,.8),('right','long'):(7.7,0)}
            for root in roots:
                x,y=positions[(root['side'],root['module'])]
                root.location=(x,y,-.70);root.rotation_euler=(0,0,0)
            scene.render.resolution_x=1600;scene.render.resolution_y=540
            cam=camera((2,-16,9),(0,.8,-.20),19.8)
            visible=[o for o in asset if o.type=='MESH']
        elif view in {'neutral-section','neutral-post'}:
            for o in references: o.hide_render=True
            kind='long' if view=='neutral-section' else 'post'
            selected=next(r for r in roots if r['side']=='left' and r['module']==kind)
            for o in asset:
                if o.type=='MESH': o.hide_render=o.parent!=selected
            selected.location=(0,0,-.70);selected.rotation_euler=(0,0,0)
            if kind=='long': cam=camera((3,-5,2.8),(0,0,-.1),4.1)
            else: cam=camera((2,-4,2.3),(0,0,-.02),2.85)
            visible=list(selected.children)
        else:
            cam=camera((0,-25,30),(0,8,.10),29.5) if view=='neutral-placement' else camera((18,-25,22),(0,8,.10),33.5)
            visible=references+[o for o in asset if o.type=='MESH']
        bpy.context.view_layer.update()
        projected=[world_to_camera_view(scene,cam,p) for p in validate.points(visible)]
        assert all(.01<p.x<.99 and .01<p.y<.99 and p.z>0 for p in projected),f'{view}: diagnostic camera clips geometry'
        path=out/f'{view}.png';scene.render.filepath=str(path)
        print('RENDER_ATTEMPT',view,str(path),flush=True)
        bpy.ops.render.render(write_still=True)
        assert path.is_file() and path.stat().st_size>1000,'Render missing/empty'
        assert validate.camera_state()==original_camera,'Preserved reference camera changed'
        evidence[view]={'file':path.name,'camera_location':list(cam.location),
                        'camera_rotation':list(cam.rotation_euler),'orthographic_scale':cam.data.ortho_scale,
                        'resolution':[scene.render.resolution_x,scene.render.resolution_y],
                        'mode':mode,'samples':24,'source_sha256':before,
                        'diagnostic_repose':view in {'neutral-modules','neutral-section','neutral-post'},
                        'geometry_in_frame':True,'not_game_camera':True}
        print('RENDER_PASS',view,path.stat().st_size,flush=True)
    assert build.sha(source)==before and build.integrity()==immutable
    (out/'preview-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
    print('PREVIEW_PASS source and immutable reference hashes unchanged',flush=True)


if __name__=='__main__':
    main()
