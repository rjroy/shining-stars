"""One authorized transform-only composition pass; immutable current scene input."""
import argparse, json, math, sys
from pathlib import Path
sys.dont_write_bytecode = True
import bpy
from mathutils import Matrix, Vector
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import assemble as A

PACKAGE = Path(__file__).resolve().parent
CURRENT = None  # Explicit scratch input; no maintained predecessor binary.
CURRENT_SHA = None
HISTORICAL_ROAD_SHA = '752abd57e22b4209f6491b55c7ed433b391b34e42be5aa6aec223de37b5270db'
LENGTH = 42.0
TILT = 14.0
PIVOT = Vector((0, -2.8, -.65))
CITY_POSITION = (0, 55, -5)
CITY_SCALE = .35
CAMERA_POSITION = (0, -15, 5)
CAMERA_TARGET = (0, 24, .5)
CAMERA_LENS = 28.0
WALL_COUNT = 22  # 11 long + 11 short per boundary
WALL_OVERLAP = .14  # body overlap, not cap-only contact

def new_output(path, suffix):
    p = Path(path).resolve()
    assert p.suffix == suffix and p.parent.is_dir(), 'New output in existing directory required'
    assert p.is_relative_to(PACKAGE) or p.is_relative_to(Path('/tmp/opencode')), 'Unauthorized output'
    if p.exists(): raise FileExistsError(p)
    return p

def group_matrix():
    return Matrix.Translation(PIVOT) @ Matrix.Rotation(math.radians(TILT), 4, 'X') @ Matrix.Translation(-PIVOT)

def tangent(side, y):
    # Integrate a shallow continuous curve, x minimum near y=10. Both sides
    # remain outside the unchanged sample crowd. Rigid stock, never bent.
    return Vector((side * .006 * (y - 10), 1, 0)).normalized()

def wall_layout():
    placements = []
    for side, label in ((-1, 'left'), (1, 'right')):
        point = Vector((side * (11.8 + .003 * 14**2), -4, A.GROUND_Z))
        previous_half = None
        previous_tangent = None
        for i in range(WALL_COUNT):
            kind = 'long' if i % 2 == 0 else 'short'
            half = (2.8 if kind == 'long' else 1.8) / 2
            if i == 0:
                direction = tangent(side, point.y + half)
                center = point + half * direction
            else:
                direction = tangent(side, point.y + previous_half + half - WALL_OVERLAP)
                center = point + (previous_half - WALL_OVERLAP / 2) * previous_tangent + (half - WALL_OVERLAP / 2) * direction
                # Refine tangent at this module's center without mesh deformation.
                direction = tangent(side, center.y)
                center = point + (previous_half - WALL_OVERLAP / 2) * previous_tangent + (half - WALL_OVERLAP / 2) * direction
            placements.append({'side': label, 'index': i, 'kind': kind,
                               'position': list(center), 'yaw': math.atan2(direction.y, direction.x)})
            point, previous_half, previous_tangent = center, half, direction
    return placements

def compose(road, output):
    new_output(output, '.blend'); A.check_sources()
    assert A.sha(CURRENT) == CURRENT_SHA, 'Maintained scene changed'
    bpy.ops.wm.open_mainfile(filepath=str(CURRENT))
    old_road = [o for o in bpy.context.scene.objects if o.get('review_asset') == 'highway']
    for o in old_road: bpy.data.objects.remove(o, do_unlink=True)
    with bpy.data.libraries.load(str(road), link=False) as (src, dst):
        dst.collections = ['CANDIDATE | static highway | UNAPPROVED']
    road_collection = dst.collections[0]
    bpy.context.scene.collection.children.link(road_collection)
    road_collection.name = 'HIGHWAY.LongerCandidate'
    A.annotate('highway', list(road_collection.objects))

    group = bpy.data.objects.new('COMPOSITION.Playfield.ForegroundPivot', None)
    bpy.context.scene.collection.objects.link(group)
    group['pivot_authoring'] = list(PIVOT); group['tilt_degrees'] = TILT
    # Its matrix implements T(pivot) R T(-pivot), so source local coordinates
    # and exact measured platform/cap/road junction all remain unchanged.
    group.matrix_world = group_matrix()
    for o in list(bpy.context.scene.objects):
        if o.get('review_asset') in ('platform', 'endcaps', 'highway'):
            assert o.parent is None
            local = o.matrix_basis.copy(); o.parent = group
            o.matrix_parent_inverse = Matrix.Identity(4); o.matrix_basis = local

    city = next(o for o in bpy.context.scene.objects if o.get('source_object') == 'CITY.ProvisionalLayout')
    city.location = CITY_POSITION; city.scale = (CITY_SCALE,) * 3

    old_framing = [o for o in bpy.context.scene.objects if o.get('review_asset') == 'framing']
    prototypes = {}
    for kind in ('long', 'short'):
        mesh = next(o for o in old_framing if o.type == 'MESH' and 'left ' + kind in o['source_object'])
        prototypes[kind] = (mesh.parent, mesh)
    framing_collection = A.collection('FRAMING.ContinuousAlternatingCurves')
    for placement in wall_layout():
        root_template, mesh_template = prototypes[placement['kind']]
        root = root_template.copy(); mesh = mesh_template.copy()
        label = placement['side'] + '.' + str(placement['index']).zfill(2) + '.' + placement['kind']
        root.name = 'framing.' + label + '.root'; mesh.name = 'framing.' + label + '.masonry'
        framing_collection.objects.link(root); framing_collection.objects.link(mesh)
        root.location = placement['position']; root.rotation_euler = (0, 0, placement['yaw'])
        root['wall_side'] = placement['side']; root['wall_index'] = placement['index']; root['wall_kind'] = placement['kind']
        mesh.parent = root
        # Shared immutable source mesh and material/modifier assignments.
        mesh.matrix_basis = mesh_template.matrix_basis.copy()
    for o in old_framing: bpy.data.objects.remove(o, do_unlink=True)
    camera = bpy.context.scene.camera
    camera.location = CAMERA_POSITION; A.aim(camera, CAMERA_TARGET); camera.data.lens = CAMERA_LENS
    scene = bpy.context.scene
    scene['status'] = 'Composition revision CANDIDATE; parent/designer/user review pending'
    scene['composition_revision'] = json.dumps({'length': LENGTH, 'tilt_degrees': TILT, 'pivot': list(PIVOT),
        'uniform_playfield_scale': 1, 'city_position': CITY_POSITION, 'city_scale': CITY_SCALE,
        'wall_count_each_side': WALL_COUNT, 'nominal_body_overlap': WALL_OVERLAP,
        'crowd': 'Unchanged original sample, including world transforms and actions'}, sort_keys=True)
    # Preserve original checkpoint provenance, not the scratch serialization.
    scene['road_candidate_sha256'] = HISTORICAL_ROAD_SHA
    # Remove only unused data from the NEW scene, not source data on disk.
    for blocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
        for block in list(blocks):
            if block.users == 0: blocks.remove(block)
    bpy.context.view_layer.update(); A.set_mode('neutral')
    A.check_sources(); assert A.sha(CURRENT) == CURRENT_SHA
    print('COMPOSITION SAVE ATTEMPT', output, flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    A.check_sources(); assert A.sha(CURRENT) == CURRENT_SHA
    print('COMPOSITION SAVE SUCCESS', output, flush=True)

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--road', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
    p.add_argument('--input', type=Path, required=True)
    args = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
    CURRENT = args.input.resolve(); CURRENT_SHA = A.sha(CURRENT)
    compose(args.road.resolve(), new_output(args.output, '.blend'))
