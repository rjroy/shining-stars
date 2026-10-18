"""Actual isolated-city PBR checks at unchanged game and Observatory projections.

No app rendering or timing claim. Never saves native source; uses original rigs.
"""
import argparse,json,math,sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
from mathutils import Matrix,Quaternion,Vector
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from glb_checks import sha
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,default=ROOT/'evidence/spatial');args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);out=args.output_dir.resolve();assert out.is_dir()
m=json.loads((ROOT/'spatial-manifest.json').read_text());config=m['config'];source=ROOT.parents[1]/'authoring/brightvale-city/city.blend';old=ROOT/'city-optimized.glb';new=ROOT/'city-optimized-spatial.glb';protected={source:config['source_native_sha256'],ROOT/'city.glb':config['full_baseline_sha256'],old:config['source_optimized_sha256'],new:m['artifact_sha256']};assert Path(bpy.data.filepath).resolve()==source.resolve() and all(sha(p)==h for p,h in protected.items())
scene=bpy.context.scene;C=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)));report=json.loads((ROOT/'evidence/consumer-optimized/optimized/report.json').read_text());game=report['captures'][1]['camera'];cameras={}
for kind in ['game','observatory']:
    data=bpy.data.cameras.new('Inspection.spatial.'+kind);o=bpy.data.objects.new(data.name,data);scene.collection.objects.link(o)
    if kind=='game':
        scale=.35;placement=Matrix.Translation((0,3.9,-55))@Matrix.Diagonal((scale,scale,scale,1));x,y,z,w=game['quaternion'];world=Quaternion((w,x,y,z)).to_matrix().to_4x4();world.translation=Vector(game['position']);data.type='PERSP';data.sensor_fit='VERTICAL';data.sensor_height=32;data.lens=16/math.tan(math.radians(game['fov'])/2);data.clip_start=game['near']/scale;data.clip_end=game['far']/scale
    else:
        scale=.18;placement=Matrix.Translation((0,-2.85,-7))@Matrix.Diagonal((scale,scale,scale,1));world=Matrix.Translation((0,0,16));data.type='ORTHO';data.sensor_fit='HORIZONTAL';data.ortho_scale=25.6/scale;data.clip_start=.1/scale;data.clip_end=80/scale
    native=(placement@C).inverted()@world;o.location=native.translation;o.rotation_mode='QUATERNION';o.rotation_quaternion=native.to_quaternion();cameras[kind]=o
records=[]
def render(name,kind,mode,artifact):
    path=out/name;assert not path.exists()
    for c in bpy.data.collections:
        if c.name.startswith('08 | Lighting.'):c.hide_render=c.name!='08 | Lighting.'+mode
        if c.name in ('08 | Low ravine atmosphere','08 | Local inhabited light anchors'):c.hide_render=mode=='Neutral'
    scene.world=bpy.data.worlds[mode+'.world'];scene.camera=cameras[kind];scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1440;scene.render.resolution_y=900;scene.render.resolution_percentage=100
    # Actual Observatory ortho width/height is 25.6/10 despite 1.6 viewport.
    # Match that projection without touching the consumer camera or the asset.
    scene.render.pixel_aspect_x=1.6 if kind=='observatory' else 1;scene.render.pixel_aspect_y=1
    if kind=='observatory':
        projection=scene.camera.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(),x=1440,y=900,scale_x=1.6,scale_y=1)
        assert abs(projection[0][0]-.18/12.8)<1e-7 and abs(projection[1][1]-.18/5)<1e-7
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(path);print('SPATIAL_RENDER_ATTEMPT',name,flush=True);bpy.ops.render.render(write_still=True);records.append(dict(path=name,sha256=sha(path),artifact_sha256=sha(artifact),dimensions=[1440,900],projection=kind,mode=mode,pixel_aspect=[scene.render.pixel_aspect_x,scene.render.pixel_aspect_y],context='Isolated city, original native Blender PBR rig. No app UI/highway/sky/culling simulation or renderer-performance claim.'));print('SPATIAL_RENDER_OUTCOME',name,path.stat().st_size,flush=True)
city=[o for o in scene.objects if o.type=='MESH' and any(c.name.startswith(tuple(f'{i:02} |' for i in range(1,8))) for c in o.users_collection)];assert len(city)==5368
for o in city:bpy.data.objects.remove(o,do_unlink=True)
for variant,artifact in [('previous',old),('spatial',new)]:
    before=set(scene.objects);assert bpy.ops.import_scene.gltf(filepath=str(artifact))=={'FINISHED'};imported=set(scene.objects)-before
    if variant=='spatial':render('spatial-game-audience.png','game','Audience',artifact);render('spatial-game-twilight.png','game','Twilight',artifact)
    render(variant+'-observatory-neutral.png','observatory','Neutral',artifact)
    for o in imported:bpy.data.objects.remove(o,do_unlink=True)
assert all(sha(p)==h for p,h in protected.items());(out/'render-record.json').write_text(json.dumps(dict(artifact_sha256=m['artifact_sha256'],protected_inputs_unchanged=True,renders=records),indent=2)+'\n')
