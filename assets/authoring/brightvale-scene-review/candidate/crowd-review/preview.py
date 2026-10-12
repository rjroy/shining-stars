"""Read-only actual matched Audience/Twilight views; inherited presentation."""
import argparse, importlib.util, sys
from pathlib import Path
sys.dont_write_bytecode = True
import bpy
spec = importlib.util.spec_from_file_location('_crowd_place', Path(__file__).resolve().parent / 'place.py')
C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)
P = C.module('_scene_preview', C.SCENE_PACKAGE / 'preview.py')

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--output-dir', type=Path, required=True)
    args = p.parse_args(sys.argv[sys.argv.index('--')+1:]); out = args.output_dir.resolve()
    assert out.is_dir() and out.is_relative_to(C.SCENE_PACKAGE)
    C.protected(); P.render(out, ['audience', 'twilight']); C.protected()
