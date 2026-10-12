"""Read-only exact preservation and gameplay pixel-grid visibility evidence."""
import argparse, collections, json, math, sys
from pathlib import Path
sys.dont_write_bytecode = True
import bpy
from mathutils import Vector
import importlib.util
spec = importlib.util.spec_from_file_location('_crowd_place', Path(__file__).resolve().parent / 'place.py')
C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)
G, V = C.G, C.V
L = C.module('_ground_lane_checks', C.PACKAGE.parent / 'ground-review/validate.py')

def visibility(records):
    """Trace a 2x2-pixel grid across each evaluated projected crowd rectangle.

    Reports first-hit instance ownership including other people and scenery.
    Thus counts are actual visible samples, not nominal projected bounds.
    """
    scene = bpy.context.scene; graph = bpy.context.evaluated_depsgraph_get()
    camera = scene.camera; origin = camera.matrix_world.translation
    projection = camera.calc_matrix_camera(graph, x=1600, y=900).inverted()
    result = {}
    for iid, root in sorted(C.roots().items()):
        own = [r for r in records.values() if r['instance'] == iid]
        screen = V.aggregate(own, 'screen'); bounds = V.aggregate(own, 'bounds')
        assert min(screen[0]) >= 0 and max(screen[1]) <= 1, ('Cropped crowd', iid)
        assert bounds[1][0] < -6.98 or bounds[0][0] > 6.98, ('Crowd inside playfield', iid)
        assert abs(bounds[0][2] - 8.25) < 2e-6, ('Crowd ground height', iid)
        pts = list(G.evaluated_points([o for o in scene.objects if o.get('instance_id') == iid]))
        margin = 26.9963657525 - max(math.hypot(p[0], p[1]-20) for p in pts)
        assert margin > .05, ('Crowd outside plaza', iid)
        forward = root.matrix_world.to_3x3() @ Vector((0, -1, 0)); forward.z = 0; forward.normalize()
        facing = origin - root.location; facing.z = 0; facing.normalize()
        assert forward.dot(facing) > .98, ('Crowd not facing player', iid)
        hits = []; upper = 0; owners = collections.Counter(); tested = 0
        x0, x1 = math.floor(screen[0][0]*1600), math.ceil(screen[1][0]*1600)
        y0, y1 = math.floor(screen[0][1]*900), math.ceil(screen[1][1]*900)
        for y in range(y0, y1, 2):
            for x in range(x0, x1, 2):
                local = projection @ Vector((2*(x+.5)/1600-1, 2*(y+.5)/900-1, -1, 1))
                local /= local.w
                world = camera.matrix_world @ local.to_3d()
                hit, point, normal, index, obj, matrix = scene.ray_cast(graph, origin, (world-origin).normalized())
                tested += 1
                owner = obj.get('instance_id') or obj.get('review_asset') or obj.name if hit else 'background'
                owners[owner] += 1
                if hit and obj.get('instance_id') == iid:
                    hits.append([x, 899-y])
                    if point.z > bounds[0][2] + .9: upper += 1
        assert len(hits) >= 25 and upper >= 10, ('No meaningful upper silhouette', iid, len(hits), upper)
        result[iid] = {'location': list(root.location), 'yaw': root.rotation_euler.z,
                       'facing_dot': forward.dot(facing), 'plaza_margin': margin,
                       'bounds': bounds, 'screen_rectangle': screen,
                       'tested_samples': tested, 'visible_samples': len(hits), 'upper_body_samples': upper,
                       'visible_sample_rectangle_pixels_top_left': [[min(p[i] for p in hits) for i in range(2)],
                                                                   [max(p[i] for p in hits) for i in range(2)]],
                       'first_hit_owners': dict(owners)}
    return result

def negative_tests(records, expected):
    result = {}; root = C.roots()['L05']; saved = root.location.copy()
    try:
        root.location.x = 0; bpy.context.view_layer.update()
        try: visibility(V.geometry())
        except AssertionError as e:
            assert 'inside playfield' in str(e); result['lane_intrusion_rejected'] = True
        else: raise AssertionError('Lane defect accepted')
        root.location = saved; root.location.z += .1; bpy.context.view_layer.update()
        try: visibility(V.geometry())
        except AssertionError as e:
            assert 'ground height' in str(e); result['floating_feet_rejected'] = True
        else: raise AssertionError('Floating feet accepted')
        root.location = (7.8*-1, 16.6, saved.z); bpy.context.view_layer.update()
        try: visibility(V.geometry())
        except AssertionError as e:
            assert 'No meaningful upper silhouette' in str(e); result['hidden_spectator_rejected'] = True
        else: raise AssertionError('Hidden spectator accepted')
    finally:
        root.location = saved; bpy.context.view_layer.update()
    camera = bpy.context.scene.camera; saved_camera = camera.location.copy()
    try:
        camera.location.z += .1; bpy.context.view_layer.update()
        assert C.state() != expected; result['camera_drift_rejected'] = True
    finally:
        camera.location = saved_camera; bpy.context.view_layer.update()
    assert C.state() == expected, 'Negative test restoration drift'
    return result

def run(report, negative=False):
    source = Path(bpy.data.filepath); before = C.A.sha(source); C.protected()
    bpy.ops.wm.open_mainfile(filepath=str(C.REFERENCE)); bpy.context.view_layer.update()
    baseline = C.state(); old = {iid: (list(o.location), list(o.rotation_euler)) for iid, o in C.roots().items()}
    C.place(); expected = C.state()
    bpy.ops.wm.open_mainfile(filepath=str(source)); bpy.context.view_layer.update()
    actual = C.state()
    assert actual == expected, 'Saved result differs from deterministic placement or data/settings changed'
    changed = [name for name in baseline['objects'] if baseline['objects'][name] != actual['objects'][name]]
    noncrowd = [o.name for o in bpy.context.scene.objects if o.get('review_asset') != 'crowd' and o.name != G.PLAZA]
    assert all(baseline['objects'][n] == actual['objects'][n] for n in noncrowd), 'Noncrowd changed'
    assert baseline['disk'] == actual['disk'] and baseline['world'] == actual['world'] and baseline['render'] == actual['render']
    assert baseline['scene_properties'] == actual['scene_properties']
    for o in bpy.context.scene.objects:
        if o.get('review_asset') != 'crowd': continue
        a, b = baseline['objects'][o.name], actual['objects'][o.name]
        for key in a:
            if key in ('world', 'basis', 'rotation_euler', 'rotation_quaternion'): continue
            assert a[key] == b[key], ('Crowd data/rig/pose changed', o.name, key)
        if o.parent: assert a['basis'] == b['basis'] and a['rotation_euler'] == b['rotation_euler']
        else:
            assert a['rotation_euler'][:2] == b['rotation_euler'][:2]
            assert old[o['instance_id']][0][2] == o.location.z
    records = V.geometry()
    result = {'pass': True, 'blender': bpy.app.version_string, 'reference_sha256': C.REFERENCE_SHA,
              'scene_sha256': before, 'state_fingerprint': V.digest(actual),
              'unchanged_noncrowd_objects': len(noncrowd)+1,
              'moved_instances': {iid: {'from': old[iid][0], 'to': list(C.roots()[iid].location),
                                       'yaw_from': old[iid][1][2], 'yaw_to': C.roots()[iid].rotation_euler.z} for iid in C.PLACEMENTS},
              'visible_pixel_grid_step': 2, 'visibility': visibility(records),
              'unobstructed_lane_rays': L.lane_checks(), 'placement_matches_fresh_checkpoint_replay': True}
    if negative: result['negative_tests'] = negative_tests(records, actual)
    assert C.A.sha(source) == before; C.protected()
    report.write_text(json.dumps(result, indent=2)+'\n'); print('CROWD VALIDATION SUCCESS', report, flush=True)

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--report', type=Path, required=True)
    p.add_argument('--negative-test', action='store_true')
    args = p.parse_args(sys.argv[sys.argv.index('--')+1:]); run(C.output(args.report, '.json'), args.negative_test)
