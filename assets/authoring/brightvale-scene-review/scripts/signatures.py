"""Reusable source-data and evaluated-projection signatures; no scene mutation."""
import hashlib
import json
import bpy
import numpy as np


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def flat(matrix):
    return [c for row in matrix for c in row]


def material_signature(mat):
    nodes = []
    for node in mat.node_tree.nodes:
        inputs = []
        for socket in node.inputs:
            if not hasattr(socket, 'default_value'): continue
            value = socket.default_value
            if not isinstance(value, (str, int, float, bool)) and value is not None: value = list(value)
            inputs.append([socket.identifier, value])
        extra = {}
        for field in ('operation', 'blend_type', 'noise_dimensions', 'feature', 'distance', 'interpolation'):
            if hasattr(node, field): extra[field] = getattr(node, field)
        if hasattr(node, 'color_ramp'): extra['color_ramp'] = [[e.position, list(e.color)] for e in node.color_ramp.elements]
        nodes.append([node.name, node.bl_idname, inputs, extra])
    return digest([list(mat.diffuse_color), nodes, [[l.from_node.name, l.from_socket.identifier, l.to_node.name, l.to_socket.identifier] for l in mat.node_tree.links]])


def source_signatures(objects):
    data_cache = {}; mat_cache = {}; result = {}
    for o in objects:
        data = o.data
        if data is not None and data not in data_cache:
            if o.type == 'MESH':
                value = {'vertices': [list(v.co) for v in data.vertices], 'edges': [list(e.vertices) for e in data.edges],
                         'polygons': [[list(p.vertices), p.material_index, p.use_smooth] for p in data.polygons],
                         'weights': [[[g.group, g.weight] for g in v.groups] for v in data.vertices]}
            elif o.type == 'CURVE':
                value = {'resolution': data.resolution_u, 'bevel_depth': data.bevel_depth, 'bevel_resolution': data.bevel_resolution,
                         'dimensions': data.dimensions, 'fill_mode': data.fill_mode, 'splines': []}
                for s in data.splines:
                    value['splines'].append([s.type, s.use_cyclic_u, s.resolution_u,
                        [[list(p.co), list(p.handle_left), list(p.handle_right), p.radius, p.tilt] for p in s.bezier_points],
                        [[list(p.co), p.radius, p.tilt] for p in s.points]])
            elif o.type == 'ARMATURE':
                value = {b.name: [b.parent.name if b.parent else None, b.use_connect, b.use_deform, flat(b.matrix_local)] for b in data.bones}
            else: raise AssertionError(('Unexpected source data', o.name, o.type))
            data_cache[data] = digest(value)
        materials = []
        for slot in o.material_slots if o.type in ('MESH', 'CURVE') else []:
            m = slot.material
            if m not in mat_cache: mat_cache[m] = material_signature(m)
            materials.append(mat_cache[m])
        modifiers = []
        for mod in o.modifiers:
            record = {'type': mod.type, 'viewport': mod.show_viewport, 'render': mod.show_render}
            for field in ('width', 'segments', 'limit_method', 'angle_limit', 'affect', 'use_clamp_overlap', 'weight',
                          'keep_sharp', 'mode', 'use_deform_preserve_volume', 'use_vertex_groups', 'use_bone_envelopes'):
                if hasattr(mod, field): record[field] = getattr(mod, field)
            modifiers.append(record)
        result[o.name] = {'type': o.type, 'data': data_cache.get(data), 'materials': materials, 'modifiers': modifiers,
                         'vertex_groups': [g.name for g in o.vertex_groups] if o.type == 'MESH' else [],
                         'pose_definitions': o.get('pose_definitions')}
    return result


def geometry():
    scene = bpy.context.scene; graph = bpy.context.evaluated_depsgraph_get(); camera = scene.camera
    projection = np.array(camera.calc_matrix_camera(graph, x=1600, y=900)) @ np.array(camera.matrix_world.inverted())
    result = {}
    for o in sorted(scene.objects, key=lambda o: o.name):
        if o.type not in ('MESH', 'CURVE') or o.name == 'Review.Ground': continue
        ev = o.evaluated_get(graph); mesh = ev.to_mesh()
        try:
            coords = np.empty(len(mesh.vertices)*3, dtype=np.float64); mesh.vertices.foreach_get('co', coords); coords = coords.reshape((-1, 3))
            assert np.isfinite(coords).all(), o.name
            local = np.column_stack((coords, np.ones(len(coords))))
            world = local @ np.array(ev.matrix_world).T; clip = world @ projection.T
            assert np.all(clip[:, 3] > 0), ('Geometry behind camera', o.name)
            screen = (clip[:, :2]/clip[:, 3, None]+1)*.5
            result[o.name] = {'asset': o['review_asset'], 'instance': o.get('instance_id'),
                             'bounds': [world[:, :3].min(axis=0).tolist(), world[:, :3].max(axis=0).tolist()],
                             'screen': [screen.min(axis=0).tolist(), screen.max(axis=0).tolist()],
                             'vertices': len(coords), 'triangles': sum(len(p.vertices)-2 for p in mesh.polygons),
                             'evaluated_fingerprint': hashlib.sha256(np.round(world[:, :3], 7).tobytes()).hexdigest()}
        finally: ev.to_mesh_clear()
    return result


def aggregate(records, field):
    records = list(records); assert records
    return [np.array([r[field][0] for r in records]).min(axis=0).tolist(),
            np.array([r[field][1] for r in records]).max(axis=0).tolist()]
