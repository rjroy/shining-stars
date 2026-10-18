"""Actual GLB-reimport evidence in the unchanged authoring study rig. Never saves source."""
import argparse,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from glb_checks import sha
SOURCE=ROOT.parents[1]/'authoring/brightvale-city/city.blend';expected='edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff'
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,default=ROOT/'evidence');args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=args.output_dir.resolve();assert out.is_dir();assert Path(bpy.data.filepath).resolve()==SOURCE.resolve() and sha(SOURCE)==expected
manifest=json.loads((ROOT/'manifest.json').read_text());glb=ROOT/'city.glb';assert sha(glb)==manifest['artifact_sha256']
paths=[out/name for name in ['source-water-neutral.png','glb-city-audience.png','glb-city-twilight.png','glb-water-neutral.png']];assert not any(p.exists() for p in paths),'Refusing to overwrite evidence'
scene=bpy.context.scene;records=[]
def render(name,camera,mode,kind):
    for c in bpy.data.collections:
        if c.name.startswith('08 | Lighting.'):c.hide_render=c.name!='08 | Lighting.'+mode
        if c.name in ('08 | Low ravine atmosphere','08 | Local inhabited light anchors'):c.hide_render=mode=='Neutral'
    scene.world=bpy.data.worlds[mode+'.world'];scene.camera=bpy.data.objects[camera];scene.render.engine='CYCLES';scene.cycles.samples=24
    scene.render.resolution_x=1792 if 'city' in name else 1600;scene.render.resolution_y=1008 if 'city' in name else 1100;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(out/name)
    print('TRANSFER_RENDER_ATTEMPT',name,kind,flush=True);bpy.ops.render.render(write_still=True)
    assert (out/name).is_file()
    records.append(dict(path=name,geometry=kind,source_sha256=expected,glb_sha256=manifest['artifact_sha256'] if kind=='reimported GLB' else None,camera=camera,mode=mode,resolution=[scene.render.resolution_x,scene.render.resolution_y],renderer='Cycles',samples=24,lighting='Original authoring study rig, including source fog in mood views. Rig is inspection context, not part of GLB.'))
    print('TRANSFER_RENDER_OUTCOME',name,(out/name).stat().st_size,flush=True)
render('source-water-neutral.png','Camera.LandscapeWater','Neutral','approved native source')
city=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(c.name.startswith(tuple(f'{i:02} |' for i in range(1,8))) for c in o.users_collection)]
assert len(city)==5368
for o in city:bpy.data.objects.remove(o,do_unlink=True)
print('REIMPORT_FOR_RENDER_ATTEMPT',glb,flush=True);assert bpy.ops.import_scene.gltf(filepath=str(glb))=={'FINISHED'}
assert len([o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('source_object')])==5368
render('glb-city-audience.png','Camera.Reference','Audience','reimported GLB')
render('glb-city-twilight.png','Camera.Reference','Twilight','reimported GLB')
render('glb-water-neutral.png','Camera.LandscapeWater','Neutral','reimported GLB')
assert sha(SOURCE)==expected and sha(glb)==manifest['artifact_sha256']
(out/'render-record.json').write_text(json.dumps(records,indent=2)+'\n');print('TRANSFER_SOURCE_AND_GLB_UNCHANGED',expected,manifest['artifact_sha256'],flush=True)
