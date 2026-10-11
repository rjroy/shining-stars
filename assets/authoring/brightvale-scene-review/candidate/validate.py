"""Read-only candidate identity, unchanged crowd, fit, lane and wall checks.
The previous validator's full-city/crowd visibility, city spacing and OPEN-wall
assertions are intentionally not this revised composition contract."""
import argparse, importlib.util, json, math, sys
from pathlib import Path
sys.dont_write_bytecode = True
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from bpy_extras.object_utils import world_to_camera_view
sys.path.insert(0, str(Path(__file__).resolve().parent))
import compose as C
sys.path.insert(0, str(C.PACKAGE.parent))
spec = importlib.util.spec_from_file_location('_maintained_scene_validation', C.PACKAGE.parent / 'validate.py')
V = importlib.util.module_from_spec(spec); spec.loader.exec_module(V)
import assemble as A

def identity(road):
    objects = [o for o in bpy.context.scene.objects if o.get('review_asset')]
    current = V.source_signatures(objects)
    for key in A.SOURCES:
        if key == 'highway':
            with bpy.data.libraries.load(str(road), link=False) as (src, dst):
                dst.collections = ['CANDIDATE | static highway | UNAPPROVED']
            cols = list(dst.collections); refs = list(cols[0].all_objects)
            for col in cols: bpy.context.scene.collection.children.link(col)
        else: cols, refs = A.load_asset(key)
        bpy.context.view_layer.update()
        signatures = V.source_signatures(refs); lookup = {o.name: o for o in refs}
        for o in objects:
            if o.get('review_asset') != key: continue
            ref = lookup[o['source_object']]
            assert current[o.name] == signatures[ref.name], ('Source data/material/rig changed', o.name)
            if key in ('platform', 'endcaps', 'highway'):
                assert o.parent and o.parent.name == 'COMPOSITION.Playfield.ForegroundPivot'
                assert max(abs(a-b) for a,b in zip(V.flat(o.matrix_basis), V.flat(ref.matrix_basis))) < 1e-7, ('Junction local transform', o.name)
                assert o.matrix_parent_inverse == Matrix.Identity(4)
                expected = C.group_matrix() @ ref.matrix_world
                assert max(abs(a-b) for a,b in zip(V.flat(o.matrix_world), V.flat(expected))) < 5e-6
            elif ref.parent:
                assert o.parent.get('source_object') == ref.parent.name
                assert max(abs(a-b) for a,b in zip(V.flat(o.matrix_basis), V.flat(ref.matrix_basis))) < 1e-7, ('Descendant local transform', o.name)
            else:
                assert abs(max(o.scale)-min(o.scale)) < 1e-7 and min(o.scale) > 0
        for o in refs: bpy.data.objects.remove(o, do_unlink=True)
        for col in cols: bpy.data.collections.remove(col)
    return V.digest(current)

def crowd_frozen():
    def action_signature(action):
        channels = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    channels.extend(bag.fcurves)
        return V.digest([[f.data_path, f.array_index, f.extrapolation,
            [[list(k.co), list(k.handle_left), list(k.handle_right), k.interpolation,
              k.handle_left_type, k.handle_right_type] for k in f.keyframe_points]] for f in channels])
    objects = [o for o in bpy.context.scene.objects if o.get('review_asset') == 'crowd']
    def key(o): return (o['instance_id'], o.get('source_role', o['source_object']))
    signatures = V.source_signatures(objects)
    state = {key(o): [signatures[o.name], V.flat(o.matrix_world), V.flat(o.matrix_basis),
                        [[pb.name, list(pb.rotation_quaternion), list(pb.location), list(pb.scale)] for pb in o.pose.bones] if o.type == 'ARMATURE' else None,
                        o.animation_data.action.name if o.animation_data and o.animation_data.action else None] for o in objects}
    with bpy.data.libraries.load(str(C.CURRENT), link=False) as (src, dst):
        dst.collections = [n for n in src.collections if n.startswith('CROWD.')]
    cols = list(dst.collections)
    for col in cols: bpy.context.scene.collection.children.link(col)
    refs = [o for col in cols for o in col.all_objects]
    bpy.context.scene.frame_set(1); bpy.context.view_layer.update()
    ref_signatures = V.source_signatures(refs)
    assert len(refs) == len(objects) == 193
    for o in refs:
        frozen = state[key(o)]
        assert frozen[0] == ref_signatures[o.name], ('Crowd data modified', key(o))
        assert max(abs(a-b) for a,b in zip(frozen[1], V.flat(o.matrix_world))) < 1e-7, ('Crowd world moved', key(o))
        assert max(abs(a-b) for a,b in zip(frozen[2], V.flat(o.matrix_basis))) < 1e-7
        if o.type == 'ARMATURE':
            assert frozen[3] == [[pb.name, list(pb.rotation_quaternion), list(pb.location), list(pb.scale)] for pb in o.pose.bones], ('Crowd pose changed', key(o))
            # Appending the maintained scene may duplicate the datablock ID;
            # compare its exact animation channels rather than ID identity.
            current = next(c for c in objects if key(c) == key(o))
            assert action_signature(current.animation_data.action) == action_signature(o.animation_data.action), ('Crowd action changed', key(o))
    for o in refs: bpy.data.objects.remove(o, do_unlink=True)
    for col in cols: bpy.data.collections.remove(col)
    return V.digest({str(k): v for k,v in state.items()})

def make_tree(o):
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get()); mesh = ev.to_mesh()
    try:
        # Local coordinates avoid precision loss at the far modules.
        return (BVHTree.FromPolygons([v.co for v in mesh.vertices], [list(p.vertices) for p in mesh.polygons]), ev.matrix_world.inverted())
    finally: ev.to_mesh_clear()

def inside(tree, point):
    tree, inverse = tree
    # A horizontal depth ray stays in the sampled body-height slice. Diagonal
    # rays through the source's small beveled horizontal level transitions can
    # count two nearly coincident contour faces and give false parity results.
    direction = Vector((.013, 1, 0)).normalized(); count = 0
    start = inverse @ point
    for _ in range(40):
        hit, normal, index, distance = tree.ray_cast(start, direction, 100)
        if hit is None: return count % 2 == 1
        count += 1; start = hit + direction * .00001
    raise AssertionError('Wall parity ray overflow')

def walls():
    roots = [o for o in bpy.context.scene.objects if o.get('wall_side')]
    assert len(roots) == 2 * C.WALL_COUNT
    assert all('post' not in o['source_object'] for o in bpy.context.scene.objects if o.get('review_asset') == 'framing')
    result = {}; total = 0
    for side in ('left', 'right'):
        sequence = sorted([o for o in roots if o['wall_side'] == side], key=lambda o:o['wall_index'])
        assert [o['wall_kind'] for o in sequence] == ['long', 'short'] * (C.WALL_COUNT // 2), 'Wall sequence'
        trees = {o: make_tree(o.children[0]) for o in sequence}
        differences = []; samples = 0
        for a,b in zip(sequence, sequence[1:]):
            da = a.rotation_euler.to_matrix() @ Vector((1,0,0)); db = b.rotation_euler.to_matrix() @ Vector((1,0,0))
            ha = (2.8 if a['wall_kind'] == 'long' else 1.8)/2
            hb = (2.8 if b['wall_kind'] == 'long' else 1.8)/2
            end_a = a.location + (ha-C.WALL_OVERLAP/2) * da
            end_b = b.location - (hb-C.WALL_OVERLAP/2) * db
            assert (end_a-end_b).length < 1e-5, 'Wall joint placement gap'
            direction = (da+db).normalized(); normal = Vector((-direction.y,direction.x,0))
            junction = (end_a+end_b)/2
            differences.append(math.degrees(da.angle(db)))
            # Inspect actual evaluated SOLID union across the entire joint core,
            # rather than trusting center distances, caps, or overlapping boxes.
            for along in (-.20,-.10,0,.10,.20):
                for across in (-.23,-.115,0,.115,.23):
                    for height in (.20,.40,.75,.97):
                        point = junction + along*direction + across*normal + Vector((0,0,height))
                        assert inside(trees[a],point) or inside(trees[b],point), ('Wall solid joint gap', side, a['wall_index'], along, across, height)
                        samples += 1
        result[side] = {'modules':len(sequence), 'long':len(sequence)//2, 'short':len(sequence)//2,
            'solid_union_joint_samples': samples, 'max_adjacent_angle_degrees':max(differences),
            'nominal_body_overlap':C.WALL_OVERLAP, 'placement':[{'index':o['wall_index'],'kind':o['wall_kind'],
            'location':list(o.location),'yaw':o.rotation_euler.z} for o in sequence]}
        total += samples
    return {'boundaries':result, 'solid_union_samples_total':total}

def lanes():
    scene = bpy.context.scene; camera = scene.camera; graph = bpy.context.evaluated_depsgraph_get(); tested = 0
    for center in (-4.5,-1.5,1.5,4.5):
        for offset in (-1.2,-.6,0,.6,1.2):
            for i in range(41):
                y = 3.2 + i * (C.LENGTH+2.7-3.4)/40
                target = C.group_matrix() @ Vector((center+offset,y,.445))
                hit, point, normal, index, o, matrix = scene.ray_cast(graph,camera.location,(target-camera.location).normalized())
                assert hit and o.get('review_asset') == 'highway', ('Lane occluded',center,offset,y,o.name if o else None)
                tested += 1
    return tested

def crowd_visibility():
    scene = bpy.context.scene; graph = bpy.context.evaluated_depsgraph_get(); result = {}
    for rig in [o for o in scene.objects if o.type == 'ARMATURE']:
        head = rig.pose.bones['head']; delta = head.matrix @ head.bone.matrix_local.inverted()
        target = rig.matrix_world @ delta @ Vector((0,-.080,1.654))
        hit, point, normal, index, o, matrix = scene.ray_cast(graph,scene.camera.location,(target-scene.camera.location).normalized())
        result[rig['instance_id']] = {'visible_own_head':bool(hit and o.get('instance_id')==rig['instance_id']),
                                      'first_hit':o.name if hit else None}
    return result

def negatives():
    result = {}; scene = bpy.context.scene
    root = next(o for o in scene.objects if o.get('wall_side')=='left' and o['wall_index']==1)
    saved = root.location.copy(); root.location.y += .5; bpy.context.view_layer.update()
    try: walls()
    except AssertionError as error:
        assert 'Wall' in str(error); result['displaced_wall_rejected'] = str(error)
    else: raise AssertionError('Wall defect accepted')
    finally: root.location = saved; bpy.context.view_layer.update()
    mesh = root.children[0]; saved_mesh = mesh.location.copy()
    mesh.location.x += .4; bpy.context.view_layer.update()
    try: walls()
    except AssertionError as error:
        assert 'Wall solid joint gap' in str(error); result['actual_solid_joint_gap_rejected'] = str(error)
    else: raise AssertionError('Mesh joint gap accepted')
    finally: mesh.location = saved_mesh; bpy.context.view_layer.update()
    member = next(o for o in scene.objects if o.get('review_asset')=='highway' and o.get('lane_index')==1)
    saved = member.matrix_basis.copy(); saved_location = member.location.copy(); member.location.x += .125; bpy.context.view_layer.update()
    try:
        assert max(abs(a-b) for a,b in zip(V.flat(member.matrix_basis),V.flat(saved))) < 1e-7, 'Junction local transform'
    except AssertionError: result['shifted_lane_local_transform_rejected'] = True
    else: raise AssertionError('Shifted lane accepted')
    finally: member.location = saved_location; bpy.context.view_layer.update()
    crowd = next(o for o in scene.objects if o.get('instance_id')=='L01' and o.get('source_role')=='NeutralBase')
    saved_crowd = crowd.location.copy(); crowd.location.y += .1; bpy.context.view_layer.update()
    old_objects = set(bpy.data.objects); old_collections = set(bpy.data.collections)
    try: crowd_frozen()
    except AssertionError as error:
        assert 'Crowd world moved' in str(error); result['moved_crowd_rejected'] = str(error)
    else: raise AssertionError('Crowd displacement accepted')
    finally:
        for o in set(bpy.data.objects)-old_objects: bpy.data.objects.remove(o,do_unlink=True)
        for col in set(bpy.data.collections)-old_collections: bpy.data.collections.remove(col)
        crowd.location = saved_crowd; bpy.context.view_layer.update()
    return result

def run(road, report, negative):
    source = Path(bpy.data.filepath); before = A.sha(source); A.check_sources()
    assert A.sha(C.CURRENT) == C.CURRENT_SHA
    assert not bpy.data.libraries and not bpy.data.images
    assert len([o for o in bpy.context.scene.objects if o.type == 'ARMATURE']) == 10
    result = {'blender':bpy.app.version_string, 'candidate_sha256':before, 'road_sha256':A.sha(road),
              'source_identity_fingerprint':identity(road), 'unchanged_crowd_fingerprint':crowd_frozen()}
    bpy.context.view_layer.update()
    wall_result = walls(); lane_result = lanes(); records = V.geometry()
    counts = {key:len([r for r in records.values() if r['asset']==key]) for key in A.SOURCES}
    assert counts == {'platform':53,'endcaps':2,'highway':14,'framing':44,'city':196,'crowd':173}, counts
    screens = {key:V.aggregate((r for r in records.values() if r['asset']==key),'screen') for key in A.SOURCES}
    for key in ('platform','endcaps','highway'):
        assert min(screens[key][0]) >= 0 and max(screens[key][1]) <= 1, ('Gameplay cropped',key)
    bounds = {key:V.aggregate((r for r in records.values() if r['asset']==key),'bounds') for key in A.SOURCES}
    assert bounds['city'][0][1] > bounds['highway'][1][1], 'City physically overlaps road'
    crowd_x = V.aggregate((r for r in records.values() if r['asset']=='crowd'),'bounds')
    for side, index in (('left',1),('right',0)):
        wall_box = V.aggregate((records[o.name] for o in bpy.context.scene.objects if o.type=='MESH' and o.parent and o.parent.get('wall_side')==side),'bounds')
        clearance = crowd_x[0][0]-wall_box[1][0] if side=='left' else wall_box[0][0]-crowd_x[1][0]
        assert clearance > 0, ('Wall inside unchanged crowd',side,clearance)
        wall_result['boundaries'][side]['minimum_lateral_crowd_clearance'] = clearance
    projected = [world_to_camera_view(bpy.context.scene,bpy.context.scene.camera,C.group_matrix()@Vector(p)) for p in
        [(-6,-2.7,.44),(6,-2.7,.44),(6,C.LENGTH+2.7,.44),(-6,C.LENGTH+2.7,.44)]]
    area = abs(sum(a.x*b.y-a.y*b.x for a,b in zip(projected,projected[1:]+projected[:1])))/2
    result.update({'pass':True,'walls':wall_result,'unobstructed_lane_rays':lane_result,
        'crowd_head_visibility_not_a_pass_gate':crowd_visibility(),'asset_drawables':counts,
        'bounds':bounds,'screen_rectangles_normalized_bottom_left':screens,
        'playfield_surface_projected_frame_fraction':area,
        'placed_triangles':sum(r['triangles'] for r in records.values()),
        'geometry_fingerprint':V.digest(records),'composition':json.loads(bpy.context.scene['composition_revision']),
        'camera':{'position':list(bpy.context.scene.camera.location),'rotation':list(bpy.context.scene.camera.rotation_euler),
                  'lens':bpy.context.scene.camera.data.lens,'sensor_width':36,'resolution':[1600,900]}})
    if negative:
        result['negative_tests'] = negatives()
        restored_walls = walls()
        assert restored_walls['solid_union_samples_total'] == wall_result['solid_union_samples_total']
        assert lanes() == lane_result
        assert V.digest(V.geometry()) == result['geometry_fingerprint'], 'Negative restore drift'
    assert A.sha(source) == before; A.check_sources(); assert A.sha(C.CURRENT) == C.CURRENT_SHA
    report.write_text(json.dumps(result,indent=2)+'\n'); print('COMPOSITION VALIDATION SUCCESS',report,flush=True)

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--road',type=Path,required=True); p.add_argument('--report',type=Path,required=True)
    p.add_argument('--negative-test',action='store_true'); args = p.parse_args(sys.argv[sys.argv.index('--')+1:])
    print('COMPOSITION VALIDATION ATTEMPT',bpy.data.filepath,flush=True)
    run(args.road.resolve(),C.new_output(args.report,'.json'),args.negative_test)
