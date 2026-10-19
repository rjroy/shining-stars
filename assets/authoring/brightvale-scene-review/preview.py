"""Matched scene-review modes; only world/light state changes, never source save."""
import argparse
import hashlib
import json
import sys
import subprocess
sys.dont_write_bytecode=True
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
import assemble as A

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


def state():
    return json.dumps({o.name:[list(c for row in o.matrix_world for c in row),o.hide_render,
                              o.data.name if o.data else None] for o in bpy.data.objects},sort_keys=True)


def render(out,modes):
    out=out.resolve()
    assert out.is_relative_to(A.PACKAGE) or out.is_relative_to(Path('/tmp/opencode')),'Output outside package/scratch'
    source=Path(bpy.data.filepath);before=A.sha(source);A.check_sources()
    outputs=[out/(m+'.webp') for m in modes]
    render_paths=[p.with_suffix('.png') for p in outputs]
    if not out.is_dir() or any(p.exists() for p in outputs+render_paths):raise FileExistsError('Existing directory and new preview files/render paths required')
    scene=bpy.context.scene;signature=state();lens=scene.camera.data.lens
    for mode,path in zip(modes,outputs):
        A.set_mode(mode)
        assert state()==signature and scene.camera.data.lens==lens,'Geometry/camera changed between modes'
        png=path.with_suffix('.png')
        scene.render.filepath=str(png)
        print('SCENE RENDER BEGIN',mode,png,flush=True)
        bpy.ops.render.render(write_still=True)
        assert png.stat().st_size>0
        encode_preview(png)
        print('SCENE RENDER COMPLETE',mode,flush=True)
    assert A.sha(source)==before,'SCENE SOURCE MUTATED';A.check_sources()
    print('MATCHED CAMERA/PLACEMENT SIGNATURE',hashlib.sha256(signature.encode()).hexdigest(),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--modes',nargs='+',choices=list(A.MODES),default=list(A.MODES))
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    render(args.output_dir.resolve(),args.modes)
