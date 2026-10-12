"""Source-preserving static crowd derivation. Run with Blender 5.2.1.

No authoring generator is imported or run. Only evaluated copies are reduced.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
sys.dont_write_bytecode = True
import bpy
from mathutils import Matrix

PACKAGE = Path(__file__).resolve().parent
SOURCE = PACKAGE.parents[1] / 'authoring/brightvale-crowd/variants/variants.blend'
SOURCE_SHA = '854a120872c1152c0c7722e5f49f2d78572da69d485afbc646a5a6bcdba1b397'
POSES = ('Calm', 'Cheering', 'Reaching')

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def new_output(path, suffix):
    path = Path(path).resolve()
    assert path.suffix == suffix and path.parent.is_dir(), 'Wrong output type/directory'
    assert path.is_relative_to(PACKAGE) or path.is_relative_to(Path('/tmp/opencode')), 'Outside write scope'
    assert not path.exists(), 'Refusing existing output'
    return path

def protected(source):
    assert sha(source) == SOURCE_SHA, 'Approved source checksum mismatch'

def pose(cid, name):
    # Select the stored approved action; do not recompute poses or build anatomy.
    rig = bpy.data.objects[cid + '::CrowdRig']
    rig.animation_data.action = bpy.data.actions[cid + '.Pose.' + name]
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()

def frozen_parts(cid):
    deps = bpy.context.evaluated_depsgraph_get()
    root = bpy.data.objects[cid + '::NeutralBase']
    parts = []
    for source in sorted(bpy.context.scene.objects, key=lambda o:o.name):
        if source.type != 'MESH' or source.get('character_id') != cid:
            continue
        mesh = bpy.data.meshes.new_from_object(source.evaluated_get(deps), depsgraph=deps)
        mesh.transform(root.matrix_world.inverted() @ source.matrix_world)
        # new_from_object must retain per-object palette overrides explicitly.
        indices = [p.material_index for p in mesh.polygons]
        mesh.materials.clear()
        for slot in source.material_slots:
            mesh.materials.append(slot.material)
        for polygon, index in zip(mesh.polygons, indices):
            polygon.material_index = index
        obj = bpy.data.objects.new('copy.' + source.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj['source_role'] = source.get('source_role', source.name.split('::')[-1])
        parts.append(obj)
    return parts

def triangles(mesh):
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)

def reduce_part(obj):
    role = obj['source_role']
    ratio = (0.28 if role.startswith('ArmHand') else
             0.18 if role == 'Hair' else 0.25 if role == 'Head' else
             1.0 if role == 'Shirt' else 0.32 if role == 'Trousers' else
             0.45 if role.startswith('Shoe') else 0.4 if role == 'Waistband' else 1.)
    if ratio == 1.:
        return
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('Source surface collapse', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)

def merge(parts, name):
    # Explicit mesh assembly keeps material regions and per-face smooth flags.
    vertices, faces, assignments, smooth, mats = [], [], [], [], []
    for obj in parts:
        mesh = obj.data
        mesh.calc_loop_triangles()
        offset = len(vertices)
        vertices.extend(tuple(v.co) for v in mesh.vertices)
        for tri in mesh.loop_triangles:
            faces.append(tuple(offset+i for i in tri.vertices))
            material = mesh.materials[tri.material_index]
            if material not in mats:
                mats.append(material)
            assignments.append(mats.index(material))
            smooth.append(mesh.polygons[tri.polygon_index].use_smooth)
    mesh = bpy.data.meshes.new(name + '.Mesh')
    mesh.from_pydata(vertices, [], faces)
    for mat in mats:
        mesh.materials.append(mat)
    for face, index, sm in zip(mesh.polygons, assignments, smooth):
        face.material_index, face.use_smooth = index, sm
    mesh.update()
    obj = bpy.data.objects.new(name + '.Surface', mesh)
    bpy.context.scene.collection.objects.link(obj)
    for part in parts:
        bpy.data.objects.remove(part, do_unlink=True)
    return obj

def bounds(mesh):
    return [[round(f(v.co[i] for v in mesh.vertices), 7) for i in range(3)] for f in (min,max)]

def material_roles():
    for mat in bpy.data.materials:
        name = mat.name
        role = name[2:] if name[:2] in ('B.', 'C.') else name
        mat['role'] = role
        mat['family'] = ('skin' if role.startswith('Skin') else 'hair' if role.startswith('Hair') else
                         'face' if role.startswith('Eye') else 'clothes')
        mat['variant'] = name[0] if name[:2] in ('B.', 'C.') else ('shared' if role.startswith('Eye') else 'A')

def build(source, output, glb):
    protected(source)
    new_output(output, '.blend'); new_output(glb, '.glb')
    assert bpy.app.version[:3] == (5,2,1), 'Recheck reduction/export with another Blender version'
    print('CROWD READ', source, flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(source))
    original_objects = list(bpy.data.objects)
    products = []
    for cid in 'ABC':
        for name in POSES:
            pose(cid, name)
            parts = frozen_parts(cid)
            before = sum(triangles(o.data) for o in parts)
            for obj in parts:
                reduce_part(obj)
            pid = 'Crowd.' + cid + '.' + name
            surface = merge(parts, pid)
            # Preserve original foot plane exactly; collapse may move sole vertices.
            floor = min(v.co.z for v in surface.data.vertices)
            for v in surface.data.vertices:
                v.co.z -= floor
            root = bpy.data.objects.new(pid, None)
            bpy.context.scene.collection.objects.link(root)
            root['pose_id'] = pid
            root['variant_id'] = cid
            root['pose'] = name
            root['static_review_only'] = True
            root['forward_gltf'] = [0.,0.,1.]
            root['up_gltf'] = [0.,1.,0.]
            root['source_triangles'] = before
            root['triangles'] = triangles(surface.data)
            root['bounds_blender'] = json.dumps(bounds(surface.data))
            surface.parent = root
            surface.matrix_parent_inverse = Matrix.Identity(4)
            surface['pose_id'] = pid
            products += [root, surface]
            print('CROWD REDUCE', pid, before, root['triangles'], flush=True)
    for obj in original_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    for armature in list(bpy.data.armatures):
        bpy.data.armatures.remove(armature)
    material_roles()
    scene = bpy.context.scene
    for key in list(scene.keys()):
        del scene[key]
    scene['source_sha256'] = SOURCE_SHA
    scene['status'] = 'Reduced static pose bank for combined production review; not runtime acceptance'
    scene['motion_scope'] = 'Static review only; original detailed rigs and actions untouched'
    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active = products[-1]
    protected(source)
    print('CROWD SAVE ATTEMPT', output, glb, flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_selection=True,
        export_yup=True, export_apply=False, export_animations=False, export_skins=False,
        export_morph=False, export_cameras=False, export_lights=False, export_extras=True,
        export_materials='EXPORT', export_texcoords=False, export_normals=True,
        export_tangents=False, export_gpu_instances=False, export_use_gltfpack=False,
        export_meshopt_compression_enable=False, export_draco_mesh_compression_enable=False)
    protected(source)
    print('CROWD SAVE SUCCESS', output, glb, flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--glb', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    build(args.source.resolve(), args.output.resolve(), args.glb.resolve())
