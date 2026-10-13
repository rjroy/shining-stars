"""Matched scene-review modes; only world/light state changes, never source save."""
import argparse
import hashlib
import json
import sys
sys.dont_write_bytecode=True
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
import assemble as A


def state():
    return json.dumps({o.name:[list(c for row in o.matrix_world for c in row),o.hide_render,
                              o.data.name if o.data else None] for o in bpy.data.objects},sort_keys=True)


def render(out,modes):
    out=out.resolve()
    assert out.is_relative_to(A.PACKAGE) or out.is_relative_to(Path('/tmp/opencode')),'Output outside package/scratch'
    source=Path(bpy.data.filepath);before=A.sha(source);A.check_sources()
    outputs=[out/(m+'.png') for m in modes]
    if not out.is_dir() or any(p.exists() for p in outputs):raise FileExistsError('Existing directory and new preview files required')
    scene=bpy.context.scene;signature=state();lens=scene.camera.data.lens
    for mode,path in zip(modes,outputs):
        A.set_mode(mode)
        assert state()==signature and scene.camera.data.lens==lens,'Geometry/camera changed between modes'
        scene.render.filepath=str(path)
        print('SCENE RENDER BEGIN',mode,path,flush=True)
        bpy.ops.render.render(write_still=True)
        assert path.stat().st_size>0
        print('SCENE RENDER COMPLETE',mode,flush=True)
    assert A.sha(source)==before,'SCENE SOURCE MUTATED';A.check_sources()
    print('MATCHED CAMERA/PLACEMENT SIGNATURE',hashlib.sha256(signature.encode()).hexdigest(),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--modes',nargs='+',choices=list(A.MODES),default=list(A.MODES))
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    render(args.output_dir.resolve(),args.modes)
