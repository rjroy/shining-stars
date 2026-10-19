"""Saved-highway geometry evidence, read-only. All diagnostic cameras are TEMP.
Load approved highway.blend (or an explicitly selected scratch rebuild) in Blender.
The saved approved platform camera is preserved, not used as an invented game view.
Writes retained WebP evidence and a render manifest; PNGs are temporary.
"""
import argparse,json,sys,subprocess
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import CANDIDATE,PLATFORM_REF,ENDCAP_REF,output_path,sha,source_integrity

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

LIGHTS=['Studio key | soft warmbox','Studio fill | cool sky','Studio rim | violet','Studio front strip']
MODES={
 'neutral':{'world':((.22,.22,.22,1),.50),'floor':(.18,.18,.18,1),
            'lights':[(450,(1,1,1)),(350,(1,1,1)),(250,(1,1,1)),(180,(1,1,1))],
            'far':(1000,(1,1,1))},
 'audience':{'world':((.10,.055,.022,1),.32),'floor':(.05,.03,.018,1),
             'lights':[(330,(1,.72,.43)),(225,(1,.78,.54)),(180,(1,.48,.22)),(150,(1,.86,.68))],
             'far':(900,(1,.76,.52))},
 'twilight':{'world':((.01,.012,.05,1),.28),'floor':(.012,.016,.05,1),
             'lights':[(300,(.58,.63,1)),(260,(.32,.42,1)),(255,(.62,.30,1)),(135,(.48,.58,1))],
             'far':(850,(.50,.44,1))}}

def main():
    p=argparse.ArgumentParser(); p.add_argument('--output-dir',type=Path,required=True)
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    out=output_path(a.output_dir); out.mkdir(parents=True,exist_ok=False)
    source=Path(bpy.data.filepath).resolve(); before=sha(source); hashes=source_integrity()
    scene=bpy.context.scene; accepted=scene.camera
    assert accepted.name=='Camera | concept v4 comparison' and accepted.data.lens==50
    accepted_state={'name':accepted.name,'matrix':[list(r) for r in accepted.matrix_world],'lens':accepted.data.lens}
    highway=list(bpy.data.collections[CANDIDATE].objects)
    pr=bpy.data.collections[PLATFORM_REF]; er=bpy.data.collections[ENDCAP_REF]
    refs=list(pr.objects)+list(er.objects)
    scene.cycles.samples=24; scene.cycles.use_denoising=True
    scene.render.resolution_x=1200; scene.render.resolution_y=800; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGB'
    # Neutral shape evidence and mode studies intentionally do not use bloom.
    scene.use_nodes=False
    far_data=bpy.data.lights.new('TEMP | even highway review skybox','AREA'); far_data.shape='DISK'; far_data.size=20
    far=bpy.data.objects.new(far_data.name,far_data); scene.collection.objects.link(far)
    far.location=(0,12,14); far.rotation_euler=(Vector((0,11,.4))-far.location).to_track_quat('-Z','Y').to_euler()
    ground=bpy.data.materials['Studio | charcoal violet']
    # Only disposable studio floor coverage: avoid its finite edge entering review views.
    bpy.data.objects['Studio ground (render only)'].scale=(10,10,1)
    background=scene.world.node_tree.nodes['Background']
    views=[]

    def mode(name):
        cfg=MODES[name]
        background.inputs['Color'].default_value=cfg['world'][0]; background.inputs['Strength'].default_value=cfg['world'][1]
        ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=cfg['floor']
        for n,(power,color) in zip(LIGHTS,cfg['lights']):
            bpy.data.objects[n].data.energy=power; bpy.data.objects[n].data.color=color
        far_data.energy,far_data.color=cfg['far']

    def camera(name,loc,target,lens=34,ortho=None):
        data=bpy.data.cameras.new('TEMP | '+name+' | NOT GAME CAMERA')
        data.type='ORTHO' if ortho else 'PERSP'; data.lens=lens; data.sensor_width=36
        if ortho: data.ortho_scale=ortho
        obj=bpy.data.objects.new(data.name,data); scene.collection.objects.link(obj)
        obj.location=loc; obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
        scene.camera=obj; bpy.context.view_layer.update()
        return obj

    def projected_bounds(objects):
        coords=[world_to_camera_view(scene,scene.camera,o.matrix_world@Vector(p)) for o in objects for p in o.bound_box]
        return {'min':[min(c[i] for c in coords) for i in range(3)],'max':[max(c[i] for c in coords) for i in range(3)]}

    def render(name,purpose,full_objects=None):
        dest=out/(name+'.png'); scene.render.filepath=str(dest)
        frame=projected_bounds(full_objects) if full_objects else None
        if frame:
            assert all(frame['min'][i]>.01 and frame['max'][i]<.99 for i in (0,1)),('Asset cropped',name,frame)
            assert frame['min'][2]>scene.camera.data.clip_start and frame['max'][2]<scene.camera.data.clip_end
        views.append({'image':dest.name,'purpose':purpose,'camera':scene.camera.name,'position':list(scene.camera.location),
                      'rotation':list(scene.camera.rotation_euler),'lens':scene.camera.data.lens,'projection':scene.camera.data.type,
                      'ortho_scale':scene.camera.data.ortho_scale,'projected_asset_bounds':frame,
                      'clay_override':bool(bpy.context.view_layer.material_override),'bloom':False,
                      'resolution':[scene.render.resolution_x,scene.render.resolution_y]})
        print('RENDER_ATTEMPT',dest,flush=True); bpy.ops.render.render(write_still=True)
        assert dest.is_file() and dest.stat().st_size>0
        encode_preview(dest)
        dest=dest.with_suffix('.webp')
        views[-1]['image']=dest.name
        print('RENDER_PASS',dest,flush=True)

    mode('neutral'); pr.hide_render=True; er.hide_render=True
    camera('isolated low oblique highway',(11,-13,10),(0,10,.3),lens=36)
    render('neutral-isolated','Isolated actual highway, neutral lighting/material partitions, complete silhouette',highway)
    camera('isolated profile and surface edge',(10,1,4.3),(4.4,5.3,.1),ortho=8.6)
    render('neutral-edge','Close isolated surface/profile evidence; fitted shoulder metal, inset bed and quiet modular seams')
    clay=bpy.data.materials.new('TEMP | neutral geometry clay'); clay.use_nodes=True
    bs=clay.node_tree.nodes['Principled BSDF']; bs.inputs['Base Color'].default_value=(.42,.42,.42,1)
    bs.inputs['Metallic'].default_value=0; bs.inputs['Roughness'].default_value=.8
    bpy.context.view_layer.material_override=clay
    bpy.data.objects['Studio ground (render only)'].hide_render=True
    scene.render.resolution_y=360
    camera('full side profile',(25,11.6,.1),(0,11.6,.1),ortho=21)
    render('neutral-profile','Full isolated orthographic profile: thickness, chamfer and short terminal ramp',highway)
    scene.render.resolution_y=800
    bpy.data.objects['Studio ground (render only)'].hide_render=False
    pr.hide_render=False; er.hide_render=False
    camera('complete assembly review',(0,-17,10),(0,6.5,.35),lens=34)
    assembly=scene.camera
    render('neutral-assembly','Primary complete assembly geometry evidence; temporary review camera, NOT runtime camera',highway+refs)
    bpy.context.view_layer.material_override=None
    camera('measured platform junction',(0,-6,6.5),(0,2.70,.38),ortho=15.4)
    render('neutral-junction','Close actual lane-to-platform fit and panel/edge detail; purposeful diagnostic crop')
    scene.camera=assembly
    for name in ('audience','twilight'):
        mode(name); render('assembly-'+name,'Same actual highway/platform/endcaps geometry, '+name+' review studio; no city/crowd/notes',highway+refs)
    assert accepted_state=={'name':accepted.name,'matrix':[list(r) for r in accepted.matrix_world],'lens':accepted.data.lens}
    assert sha(source)==before and source_integrity()==hashes
    manifest={'source_sha256_before_after':before,'immutable_sources_sha256_before_after':hashes,'no_source_saved':True,
              'blender':bpy.app.version_string,'engine':scene.render.engine,'samples':24,'denoising':True,
              'view_transform':scene.view_settings.view_transform,'look':scene.view_settings.look,'exposure':scene.view_settings.exposure,
              'preserved_approved_platform_camera':accepted_state,'geometry_same_both_modes':True,'modes':MODES,'views':views,
              'studio_floor_scale_in_memory':[10,10,1],
              'game_camera_runtime_fidelity':'NOT VALIDATED'}
    (out/'render-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('READ_ONLY_PREVIEW_PASS',before,json.dumps(hashes),flush=True)

if __name__=='__main__': main()
