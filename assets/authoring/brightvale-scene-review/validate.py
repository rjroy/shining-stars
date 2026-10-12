"""Read-only current-state, ground/arc/lane checks and visible-pixel evidence."""
import argparse, collections, json, math, sys
from pathlib import Path
sys.dont_write_bytecode = True
import bpy
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent / 'scripts'))
import crowd as C
G, V = C.G, C.V
import checks as L
# Recorded from the exact crowd checkpoint, not derived from a generated copy.
EXPECTED_STATE = '5f2382487b4e6f65b5cc0788e55c4b0accb66e15e04bbf374242ef3d581eb081'

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
    # Exercise ground and actual section/post-solid checks independently of
    # the pinned semantic fingerprint. All changes are in memory only.
    def rejects(name, obj, field, value, check, message):
        saved = getattr(obj, field).copy() if hasattr(getattr(obj, field), 'copy') else getattr(obj, field)
        try:
            setattr(obj, field, value); bpy.context.view_layer.update()
            try: check()
            except AssertionError as error:
                assert message in str(error), (name, str(error)); result[name] = True
            else: raise AssertionError('Defect accepted: '+name)
        finally:
            setattr(obj, field, saved); bpy.context.view_layer.update()
    city = bpy.data.objects['city::CITY.ProvisionalLayout']
    rejects('buried_city_rejected', city, 'location', city.location+Vector((0,0,-.1)), L.ground_checks, 'City base not on lower')
    plaza = bpy.data.objects[G.PLAZA]
    rejects('wrong_plaza_height_rejected', plaza, 'location', plaza.location+Vector((0,0,.1)), L.ground_checks, 'Wrong local-ground')
    rejects('oversized_plaza_rejected', plaza, 'scale', (1.02,1.02,1), L.ground_checks, 'Disk rotation/scale')
    post = next(o for o in bpy.context.scene.objects if o.get('arc_role')=='post' and o['arc_index']==1)
    rejects('noncircular_post_rejected', post, 'location', post.location+Vector((.2,0,0)), L.arc_check, 'Not circular')
    lens = next(o for o in post.children if 'amber lens' in o['source_object'])
    rejects('hidden_post_lens_rejected', lens, 'hide_render', True, L.arc_check, 'Hidden post component')
    section = next(o for o in bpy.context.scene.objects if o.get('arc_role')=='section' and o['arc_index']==0).children[0]
    rejects('actual_joint_gap_rejected', section, 'location', section.location+Vector((.6,0,0)), L.arc_check, 'Open section-post joint')
    assert C.state() == expected, 'Negative test restoration drift'
    return result

def run(report, negative=False, compare=None):
    source = Path(bpy.data.filepath); before = C.A.sha(source); C.A.check_sources()
    bpy.context.view_layer.update()
    actual = C.state()
    assert V.digest(actual) == EXPECTED_STATE, 'Scene data/transforms/camera/lights/poses/provenance differ from preserved current state'
    comparison = None
    if compare:
        compare = compare.resolve(); compare_sha = C.A.sha(compare)
        bpy.ops.wm.open_mainfile(filepath=str(compare)); bpy.context.view_layer.update()
        assert C.state() == actual, 'Independent regeneration differs from saved current scene'
        assert C.A.sha(compare) == compare_sha
        comparison = {'sha256': compare_sha, 'exact_semantic_match': True}
        bpy.ops.wm.open_mainfile(filepath=str(source)); bpy.context.view_layer.update()
    assert not bpy.data.libraries and not bpy.data.images, 'External scene dependencies'
    assert len(bpy.data.objects) == len(bpy.context.scene.objects) == 651, 'Unexpected object population'
    assert len(bpy.data.cameras) == 1 and len(bpy.data.lights) == 4
    assert len([o for o in bpy.context.scene.objects if o.type == 'ARMATURE']) == 10
    records = V.geometry()
    result = {'pass': True, 'blender': bpy.app.version_string,
              'scene_sha256': before, 'state_fingerprint': V.digest(actual),
              'visible_pixel_grid_step': 2, 'visibility': visibility(records),
              'unobstructed_lane_rays': L.lane_checks(), 'arc': L.arc_check(), 'ground': L.ground_checks(),
              'source_sha256': {k:v[1] for k,v in C.A.SOURCES.items()}, 'comparison': comparison}
    if negative: result['negative_tests'] = negative_tests(records, actual)
    assert C.state() == actual, 'Validation restoration drift'
    assert C.A.sha(source) == before; C.A.check_sources()
    report.write_text(json.dumps(result, indent=2)+'\n'); print('STUDY VALIDATION SUCCESS', report, flush=True)

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--report', type=Path, required=True)
    p.add_argument('--negative-test', action='store_true')
    p.add_argument('--compare', type=Path, help='Independently regenerated saved scene')
    args = p.parse_args(sys.argv[sys.argv.index('--')+1:]); run(C.output(args.report, '.json'), args.negative_test, args.compare)
