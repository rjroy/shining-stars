"""Read-only matched landscape views plus an explicitly diagnostic top plan."""
import argparse,importlib.util,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
PACKAGE=Path(__file__).resolve().parent
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
F=module('_framing_compose',PACKAGE/'framing-compose.py')
P=module('_maintained_scene_preview',PACKAGE.parent/'preview.py')

def render(out):
    source=Path(bpy.data.filepath);before=F.A.sha(source);F.protected()
    assert out.is_dir() and (out.is_relative_to(PACKAGE) or out.is_relative_to(Path('/tmp/opencode')))
    top=out/'diagnostic-top.png';assert not top.exists()
    P.render(out,['neutral','audience','twilight'])
    F.A.set_mode('neutral')
    scene=bpy.context.scene;original=scene.camera
    camera=original.copy();camera.data=original.data.copy();scene.collection.objects.link(camera)
    camera.name='DIAGNOSTIC_ONLY.TopPlan';camera.location=(0,22,100);F.A.aim(camera,(0,22,0))
    camera.data.type='ORTHO';camera.data.ortho_scale=62;scene.camera=camera
    scene.render.resolution_x=scene.render.resolution_y=1000;scene.render.filepath=str(top)
    print('DIAGNOSTIC TOP PLAN RENDER ATTEMPT',top,flush=True);bpy.ops.render.render(write_still=True)
    assert top.stat().st_size>0
    print('DIAGNOSTIC TOP PLAN RENDER SUCCESS',top,flush=True)
    assert F.A.sha(source)==before;F.protected()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True)
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);render(args.output_dir.resolve())
