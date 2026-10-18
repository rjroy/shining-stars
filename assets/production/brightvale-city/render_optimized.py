"""Isolated city comparison at accepted gameplay camera, plus whole-city study.

Original Blender mood rig, NOT actual Toon/highway/browser evidence. No source save.
"""
import argparse,json,math,sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
from mathutils import Matrix,Quaternion,Vector
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from glb_checks import sha
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,default=ROOT/'evidence/optimized');args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);out=args.output_dir.resolve();assert out.is_dir()
manifest=json.loads((ROOT/'optimized-manifest.json').read_text());source=ROOT.parents[1]/'authoring/brightvale-city/city.blend';base=ROOT/'city.glb';target=ROOT/'city-optimized.glb';assert Path(bpy.data.filepath).resolve()==source.resolve() and sha(source)==manifest['source_sha256'] and sha(base)==manifest['baseline_sha256'] and sha(target)==manifest['artifact_sha256']
consumer=json.loads((ROOT/'evidence/consumer/report.json').read_text());cameras=[]
def find_cameras(obj):
    if isinstance(obj,dict):
        if isinstance(obj.get('camera'),dict) and 'fov' in obj['camera']:cameras.append(obj['camera'])
        for value in obj.values():find_cameras(value)
    elif isinstance(obj,list):
        for value in obj:find_cameras(value)
find_cameras(consumer);assert cameras and all(c==cameras[0] for c in cameras);camera=cameras[0]
# Equivalent isolated-city camera: inverse external placement and native->glTF
# basis. This does not modify either asset or the app camera/layout.
C=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)));placement=Matrix.Translation((0,3.9,-55))@Matrix.Diagonal((.35,.35,.35,1));x,y,z,w=camera['quaternion'];world=Quaternion((w,x,y,z)).to_matrix().to_4x4();world.translation=Vector(camera['position']);native=(placement@C).inverted()@world
data=bpy.data.cameras.new('Inspection.accepted.game.camera');obj=bpy.data.objects.new(data.name,data);bpy.context.scene.collection.objects.link(obj);obj.location=native.translation;obj.rotation_mode='QUATERNION';obj.rotation_quaternion=native.to_quaternion();data.type='PERSP';data.sensor_fit='VERTICAL';data.sensor_height=32;data.lens=16/math.tan(math.radians(camera['fov'])/2);data.clip_start=camera['near']/.35;data.clip_end=camera['far']/.35
scene=bpy.context.scene;records=[]
def render(name,mode,study=False):
    path=out/name;assert not path.exists()
    for c in bpy.data.collections:
        if c.name.startswith('08 | Lighting.'):c.hide_render=c.name!='08 | Lighting.'+mode
        if c.name in ('08 | Low ravine atmosphere','08 | Local inhabited light anchors'):c.hide_render=False
    scene.world=bpy.data.worlds[mode+'.world'];scene.camera=bpy.data.objects['Camera.Reference'] if study else obj;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1792 if study else 1440;scene.render.resolution_y=1008 if study else 900;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(path)
    print('OPTIMIZED_RENDER_ATTEMPT',name,flush=True);bpy.ops.render.render(write_still=True);records.append(dict(path=name,sha256=sha(path),dimensions=[scene.render.resolution_x,scene.render.resolution_y],camera='Camera.Reference' if study else camera,mode=mode,context='Isolated city, original Blender PBR lighting/world/mist; no game highway or UI. Actual accepted game placement/camera unchanged in app.'));print('OPTIMIZED_RENDER_OUTCOME',name,path.stat().st_size,flush=True)
city=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(c.name.startswith(tuple(f'{i:02} |' for i in range(1,8))) for c in o.users_collection)];assert len(city)==5368
for o in city:bpy.data.objects.remove(o,do_unlink=True)
for variant,path in [('baseline',base),('optimized',target)]:
    before=set(bpy.context.scene.objects);assert bpy.ops.import_scene.gltf(filepath=str(path))=={'FINISHED'};imported=set(bpy.context.scene.objects)-before
    render(variant+'-game-camera-audience.png','Audience');render(variant+'-game-camera-twilight.png','Twilight')
    if variant=='optimized':render('optimized-whole-city-audience.png','Audience',True)
    for o in imported:bpy.data.objects.remove(o,do_unlink=True)
assert sha(source)==manifest['source_sha256'] and sha(base)==manifest['baseline_sha256'] and sha(target)==manifest['artifact_sha256']
(out/'render-record.json').write_text(json.dumps(dict(source_sha256=manifest['source_sha256'],baseline_sha256=manifest['baseline_sha256'],artifact_sha256=manifest['artifact_sha256'],renders=records,source_and_baseline_unchanged=True),indent=2)+'\n')
