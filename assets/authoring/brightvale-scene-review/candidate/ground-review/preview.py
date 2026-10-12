"""Read-only matched gameplay views and an informative two-level side view."""
import argparse,importlib.util,sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
PACKAGE=Path(__file__).resolve().parent
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
G=module('_ground_builder',PACKAGE/'build.py')
P=module('_original_preview',G.SCENE_PACKAGE/'preview.py')

def render(out):
    source=Path(bpy.data.filepath);before=G.A.sha(source);G.protected()
    assert out.is_dir() and out.is_relative_to(G.SCENE_PACKAGE),'Unauthorized preview output'
    diagnostic=out/'diagnostic-levels.png';assert not diagnostic.exists()
    P.render(out,['neutral','audience','twilight'])
    G.A.set_mode('neutral');scene=bpy.context.scene
    original=scene.camera;camera=original.copy();camera.data=original.data.copy();scene.collection.objects.link(camera)
    camera.name='DIAGNOSTIC_ONLY.TwoGroundLevels';camera.location=(110,34,20);G.A.aim(camera,(0,34,16))
    camera.data.type='ORTHO';camera.data.ortho_scale=120;scene.camera=camera
    scene.render.filepath=str(diagnostic)
    print('DIAGNOSTIC LEVEL RENDER ATTEMPT',diagnostic,flush=True);bpy.ops.render.render(write_still=True)
    assert diagnostic.stat().st_size>0
    assert G.A.sha(source)==before;G.protected();print('DIAGNOSTIC LEVEL RENDER SUCCESS',diagnostic,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True)
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);render(args.output_dir.resolve())
