"""Bounded review-only assembly of immutable accepted sources. No asset rebuild."""
import argparse
import hashlib
import json
import sys
sys.dont_write_bytecode=True
from pathlib import Path
import bpy
from mathutils import Vector

PACKAGE=Path(__file__).resolve().parent
SOURCES={
 'platform':('neon-twilight-platform/platform.blend','ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af',['Collection']),
 'endcaps':('brightvale-platform-endcaps/endcaps.blend','c49ae80c34350ddb7281c3192c4ed90921852f0386fa047a9196087cc13b4207',['CANDIDATE | endcap pair | UNAPPROVED']),
 'highway':('brightvale-highway/highway.blend','2f2eca2987cd42b105c579420ca2e2cbc71ad75d73bcbf164aca60afe32652e5',['CANDIDATE | static highway | UNAPPROVED']),
 'framing':('brightvale-outer-framing/framing.blend','cd17e3162c434ce4054f6c32d86d4b6a885e9dbad44c1841b563513fffd75542',['CANDIDATE | outer framing | UNAPPROVED']),
 'city':('brightvale-distant-city/city.blend','4beb993e9b580bb0b6dd47e5523a0ad9aecc8c26804a4b4cbdc42cc5488caa2c',['CITY_ASSET']),
}
CAMERA_POSITION=(0,-18,7.5)
CAMERA_TARGET=(0,12,3)
CAMERA_LENS=28.
CITY_POSITION=(1.5,44,1.04)
CITY_SCALE=.13
GROUND_Z=-.65
FRAMING={'long':2.8,'post':8.5,'short':14.0}
FRAMING_X=10.5
MODES={
 'neutral':{'world':(.24,.26,.30),'strength':.45,'sun':(1.4,(1.,.94,.86)),
            'key':(1900,(1.,.92,.82)),'fill':(1300,(.70,.82,1.)),'rim':(1700,(.72,.80,1.))},
 'audience':{'world':(.11,.065,.042),'strength':.50,'sun':(1.5,(1.,.77,.48)),
             'key':(2500,(1.,.72,.42)),'fill':(1600,(.64,.76,1.)),'rim':(2000,(1.,.61,.30))},
 'twilight':{'world':(.030,.018,.075),'strength':.65,'sun':(.95,(.52,.40,1.)),
             'key':(2100,(.74,.61,1.)),'fill':(1400,(.44,.63,1.)),'rim':(1900,(.67,.32,1.))},
}


def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def check_sources():
    for key,(rel,expected,_) in SOURCES.items():
        assert sha(PACKAGE.parent/rel)==expected,('Source checksum mismatch',key)


def new_output(path,suffix):
    p=Path(path).resolve()
    if p.exists():raise FileExistsError('Refusing existing output: '+str(p))
    if p.suffix!=suffix or not p.parent.is_dir():raise ValueError('Existing directory and new '+suffix+' required')
    if not (p.is_relative_to(PACKAGE) or p.is_relative_to(Path('/tmp/opencode'))):raise ValueError('Output outside authorized package/scratch')
    return p


def load_asset(key):
    """Append only authoritative collections; platform mixed collection filtered."""
    rel,_,names=SOURCES[key]
    with bpy.data.libraries.load(str(PACKAGE.parent/rel),link=False) as (src,dst):
        assert all(n in src.collections for n in names),(key,src.collections)
        dst.collections=names
    collections=list(dst.collections)
    objects=[o for c in collections for o in c.all_objects]
    assert len(objects)==len(set(objects)),('Nested duplicate',key)
    if key=='platform':
        excluded=[o for o in objects if o.type not in ('MESH','CURVE') or o.name.startswith('Studio')]
        for o in excluded:bpy.data.objects.remove(o,do_unlink=True)
        objects=[o for o in objects if o not in excluded]
        assert len(objects)==53
    assert not any(o.type in ('CAMERA','LIGHT') or o.name.startswith('Studio') for o in objects),key
    for c in collections:bpy.context.scene.collection.children.link(c)
    return collections,objects


def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()


def collection(name):
    c=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(c);return c


def annotate(key,objects):
    for o in objects:
        o['review_asset']=key;o['source_object']=o.name;o.name=key+'::'+o.name


def set_mode(mode):
    settings=MODES[mode];scene=bpy.context.scene
    node=scene.world.node_tree.nodes['Background']
    node.inputs['Color'].default_value=(*settings['world'],1)
    node.inputs['Strength'].default_value=settings['strength']
    for name in ('sun','key','fill','rim'):
        light=bpy.data.objects['Review.'+name].data
        light.energy,light.color=settings[name]
    scene['review_mode']=mode


def assemble(output):
    new_output(output,'.blend');check_sources()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    print('ASSEMBLY READ CHECKSUM-LOCKED SOURCES',flush=True)
    for key in ('platform','endcaps','highway','framing','city'):
        cols,objects=load_asset(key);annotate(key,objects)
        for i,c in enumerate(cols):c.name=key.upper()+'.Asset'+str(i)
        if key=='city':
            root=next(o for o in objects if o['source_object']=='CITY.ProvisionalLayout')
            root.location=CITY_POSITION;root.scale=(CITY_SCALE,)*3
        if key=='framing':
            for root in [o for o in objects if not o.parent]:
                side='left' if 'left' in root['source_object'] else 'right'
                kind=next(k for k in FRAMING if k in root['source_object'])
                root.location=(( -1 if side=='left' else 1)*FRAMING_X,FRAMING[kind],GROUND_Z)
    # Appended originals are not retained as hidden population or nested sets.
    review=collection('REVIEW_ONLY.CameraLightsGround')
    mesh=bpy.data.meshes.new('Review.Ground.Mesh')
    mesh.from_pydata([(-2000,-100,GROUND_Z),(2000,-100,GROUND_Z),(2000,2000,GROUND_Z),(-2000,2000,GROUND_Z)],[],[(0,1,2,3)])
    ground=bpy.data.objects.new('Review.Ground',mesh);review.objects.link(ground)
    material=bpy.data.materials.new('Review.Ground.Material');material.use_nodes=True
    material.diffuse_color=(.036,.043,.060,1)
    bsdf=material.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=material.diffuse_color;bsdf.inputs['Roughness'].default_value=.88
    mesh.materials.append(material)
    camera_data=bpy.data.cameras.new('Review.Camera');camera=bpy.data.objects.new('Review.Camera',camera_data);review.objects.link(camera)
    camera.location=CAMERA_POSITION;aim(camera,CAMERA_TARGET);camera_data.lens=CAMERA_LENS;camera_data.sensor_width=36;camera_data.clip_end=5000
    scene=bpy.context.scene;scene.camera=camera
    for name,kind,pos,size,target in [('sun','SUN',(-20,-35,45),0,(0,20,0)),
                                      ('key','AREA',(-7,-5,16),14,(0,6,0)),
                                      ('fill','AREA',(12,-1,11),12,(0,7,1)),
                                      ('rim','AREA',(0,22,17),16,(0,7,0))]:
        data=bpy.data.lights.new('Review.'+name,kind);light=bpy.data.objects.new('Review.'+name,data);review.objects.link(light);light.location=pos;aim(light,target)
        if kind=='AREA':data.shape='DISK';data.size=size
        else:data.angle=.32
    scene.world=bpy.data.worlds.new('Review.World');scene.world.use_nodes=True
    scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    scene.render.resolution_x=1600;scene.render.resolution_y=900;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=0
    scene.render.image_settings.file_format='PNG';scene.render.filepath='//review-output-not-generated.png'
    scene.frame_start=scene.frame_end=1;scene.frame_set(1)
    scene['status']='Assembled scene REVIEW CANDIDATE; user review pending; no runtime approval'
    scene['sources']=json.dumps({k:v[:2] for k,v in SOURCES.items()},sort_keys=True)
    scene['camera_contract']='One provisional study camera; not either existing runtime camera'
    scene['crowd']='Excluded; crowd is authored and reviewed through the current waist-up atlas pipeline.'
    set_mode('neutral')
    # Excluded platform studio objects must not leave their unused ground mesh,
    # camera/light data or charcoal material inside the maintained review file.
    # This cleans only the NEW in-memory assembly, never any source package.
    for blocks in (bpy.data.meshes,bpy.data.curves,bpy.data.cameras,bpy.data.lights,bpy.data.materials,bpy.data.worlds):
        for block in list(blocks):
            if block.users==0:blocks.remove(block)
    check_sources();new_output(output,'.blend')
    print('ASSEMBLY SAVE NEW CANDIDATE',output,flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output),compress=True)
    check_sources();print('ASSEMBLY COMPLETE; source bytes unchanged',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    assemble(new_output(args.output,'.blend'))
