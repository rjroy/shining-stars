"""Read-only actual-model diagnostics and accepted-camera mode comparisons.
Load approved endcaps.blend (or an explicitly selected scratch rebuild) in Blender.
Temporary lighting/camera/visibility changes are never saved to either source.
WebP previews and render manifest go to a NEW output directory. PNGs are temporary
intermediates. No renderer/dependency installs needed.
"""
import bpy, json, sys, argparse
import subprocess
from pathlib import Path
from mathutils import Vector
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import PLATFORM, APPROVED_SHA, output_path, sha

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

# Exact Audience/Twilight studio values from the platform's accepted mode study.
MODES={
 'audience':{'world':((.10,.055,.022,1),.32),'ground':(.05,.03,.018,1),
             'lights':[(330,(1,.72,.43)),(225,(1,.78,.54)),(180,(1,.48,.22)),(150,(1,.86,.68))]},
 'twilight':{'world':((.010,.012,.050,1),.28),'ground':(.012,.016,.050,1),
             'lights':[(300,(.58,.63,1)),(260,(.32,.42,1)),(255,(.62,.30,1)),(135,(.48,.58,1))]},
 'neutral':{'world':((.25,.25,.25,1),.5),'ground':(.19,.19,.19,1),
             'lights':[(450,(1,1,1)),(350,(1,1,1)),(250,(1,1,1)),(180,(1,1,1))]}}
LIGHTS=['Studio key | soft warmbox','Studio fill | cool sky','Studio rim | violet','Studio front strip']

def main():
    p=argparse.ArgumentParser(); p.add_argument('--output-dir',required=True,type=Path)
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    output=output_path(a.output_dir); output.mkdir(parents=True,exist_ok=False)
    source=Path(bpy.data.filepath).resolve(); before=sha(source)
    assert sha(PLATFORM)==APPROVED_SHA
    scene=bpy.context.scene; accepted=scene.camera
    assert accepted.name=='Camera | concept v4 comparison' and accepted.data.type=='PERSP'
    original_compositor=scene.use_nodes
    ref=bpy.data.collections['REFERENCE | approved platform v8.3 | read-only context']
    pair=list(bpy.data.collections['CANDIDATE | endcap pair | UNAPPROVED'].objects)
    scene.cycles.samples=24; scene.cycles.use_denoising=True
    scene.render.resolution_x=1200; scene.render.resolution_y=800
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGB'
    ground=bpy.data.materials['Studio | charcoal violet']
    background=scene.world.node_tree.nodes['Background']
    views=[]

    def mode(name):
        cfg=MODES[name]
        background.inputs['Color'].default_value=cfg['world'][0]
        background.inputs['Strength'].default_value=cfg['world'][1]
        ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=cfg['ground']
        for key,(power,color) in zip(LIGHTS,cfg['lights']):
            bpy.data.objects[key].data.energy=power; bpy.data.objects[key].data.color=color

    def render(name,label):
        dest=output/(name+'.png'); scene.render.filepath=str(dest)
        views.append({'image':dest.name,'purpose':label,'camera':scene.camera.name,
                      'location':list(scene.camera.location),'rotation':list(scene.camera.rotation_euler),
                      'projection':scene.camera.data.type,'lens':scene.camera.data.lens,
                      'ortho_scale':scene.camera.data.ortho_scale,'bloom':scene.use_nodes,
                      'clay_override':bool(bpy.context.view_layer.material_override)})
        print('RENDER_ATTEMPT',dest,flush=True)
        bpy.ops.render.render(write_still=True)
        assert dest.is_file() and dest.stat().st_size>0
        encode_preview(dest)
        dest=dest.with_suffix('.webp')
        views[-1]['image']=dest.name
        print('RENDER_PASS',dest,flush=True)

    def camera(name,loc,target,scale):
        data=bpy.data.cameras.new(name); data.type='ORTHO'; data.ortho_scale=scale
        obj=bpy.data.objects.new(name,data); scene.collection.objects.link(obj)
        obj.location=loc; obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
        scene.camera=obj

    mode('neutral'); scene.use_nodes=False
    # Isolated pair remains in its measured placement, platform hidden only for diagnostics.
    ref.hide_render=True
    camera('TEMP | full-width neutral diagnostic',(0,-16,12.5),(0,0,.15),16.1)
    full=scene.camera
    render('neutral-pair','Isolated pair at fitted positions; neutral lighting, actual material regions')
    left=next(o for o in pair if o.location.x<0); left.hide_render=True
    camera('TEMP | isolated sculpted profile',(11,-7,4.5),(6.49,0,.45),6.7)
    render('neutral-endcap','Isolated right endcap: sculpted slopes, cheek, edge-band construction')
    clay=bpy.data.materials.new('TEMP | neutral clay'); clay.use_nodes=True
    bs=clay.node_tree.nodes['Principled BSDF']; bs.inputs['Base Color'].default_value=(.42,.42,.42,1)
    bs.inputs['Metallic'].default_value=0; bs.inputs['Roughness'].default_value=.8
    bpy.context.view_layer.material_override=clay
    camera('TEMP | exact side profile',(15,0,.48),(6.49,0,.48),6.5)
    bpy.data.objects['Studio ground (render only)'].hide_render=True
    render('neutral-profile','Orthographic side silhouette, no material/color/bloom dependence')
    bpy.data.objects['Studio ground (render only)'].hide_render=False
    left.hide_render=False; ref.hide_render=False; scene.camera=full
    render('neutral-fit','Primary full-width orthographic geometry/fit diagnostic; NOT a game or comparison camera')
    bpy.context.view_layer.material_override=None
    scene.camera=accepted
    scene.use_nodes=original_compositor
    for name in ('audience','twilight'):
        mode(name); render('comparison-'+name,'Actual pair and actual platform; accepted comparison camera, '+name+' studio values')
    assert sha(source)==before and sha(PLATFORM)==APPROVED_SHA
    manifest={'source_sha256_before_after':before,'platform_sha256_before_after':APPROVED_SHA,
              'no_source_saved':True,'engine':scene.render.engine,'samples':24,
              'resolution':[1200,800],'view_transform':scene.view_settings.view_transform,
              'look':scene.view_settings.look,'exposure':scene.view_settings.exposure,
              'geometry_same_in_both_modes':True,'views':views,
              'runtime_game_camera_fidelity':'not validated'}
    (output/'render-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('READ_ONLY_PREVIEW_PASS',before,APPROVED_SHA,flush=True)

if __name__=='__main__': main()
