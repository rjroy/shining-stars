"""Placement-only crowd study from the preserved accepted ground checkpoint."""
import argparse, importlib.util, math, sys
from pathlib import Path
sys.dont_write_bytecode = True
import bpy

PACKAGE = Path(__file__).resolve().parent
SCENE_PACKAGE = PACKAGE.parents[1]
REFERENCE = PACKAGE.parent / 'ground-review/scene-review.blend'
REFERENCE_SHA = '8cca46b2edfd1794045d35112dc1f3c312e090ef91d0fc4f12f2ff85c96ab39f'
PLACEMENTS = {'L03': (-11, 8.6), 'L04': (-13, 12.5), 'L05': (-15, 18),
              'R03': (11, 9), 'R04': (13.3, 13), 'R05': (15, 19)}

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    obj = importlib.util.module_from_spec(spec); spec.loader.exec_module(obj)
    return obj

G = module('_crowd_ground', PACKAGE.parent / 'ground-review/build.py')
A, V = G.A, G.V

def protected():
    G.protected()
    assert A.sha(REFERENCE) == REFERENCE_SHA, 'Ground checkpoint changed'

def output(path, suffix):
    p = Path(path).resolve()
    assert p.suffix == suffix and p.parent.is_dir()
    assert p.is_relative_to(SCENE_PACKAGE), 'Outside scene-review package'
    assert not p.exists(), 'Refusing existing output'
    return p

def roots():
    result = {o['instance_id']: o for o in bpy.context.scene.objects
              if o.get('review_asset') == 'crowd' and not o.parent}
    assert len(result) == 10 and all(o.get('source_role') == 'NeutralBase' for o in result.values())
    return result

def place():
    camera = bpy.context.scene.camera
    for iid, xy in PLACEMENTS.items():
        root = roots()[iid]
        root.location.x, root.location.y = xy  # existing Z untouched
        root.rotation_euler.z = math.atan2(camera.location.x - xy[0], xy[1] - camera.location.y)
    bpy.context.view_layer.update()

def state():
    result = G.state()
    disk = bpy.data.objects[G.PLAZA]
    result['disk'] = {'world': V.flat(disk.matrix_world), 'basis': V.flat(disk.matrix_basis),
                      'data': V.source_signatures([disk]), 'hide': [disk.hide_render, disk.hide_viewport]}
    result['scene_properties'] = {k: str(bpy.context.scene[k]) for k in bpy.context.scene.keys()}
    return result

def build(dest):
    dest = output(dest, '.blend'); protected()
    print('CROWD CHECKPOINT READ', REFERENCE, flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(REFERENCE)); place(); protected()
    print('CROWD SAVE ATTEMPT', dest, flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(dest), compress=True)
    protected(); print('CROWD SAVE SUCCESS', dest, flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:]); build(args.output)
