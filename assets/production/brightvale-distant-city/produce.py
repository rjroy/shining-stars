"""Full-city source-preserving derivative. Never executes the authoring generator."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import sys
sys.dont_write_bytecode = True
import bpy
import io_scene_gltf2
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parents[1] / 'authoring/brightvale-distant-city/city.blend'
SOURCE_SHA = '4beb993e9b580bb0b6dd47e5523a0ad9aecc8c26804a4b4cbdc42cc5488caa2c'
GENERATOR_SHA = 'c44934cbf1c4064a320a3dd5caaa3c880ddbd9f211bfb5c8846d6b0b29c0a29d'
SOURCE_COUNTS = dict(objects=221, mesh_objects=196, unique_meshes=64,
                     unique_vertices=87554, unique_triangles=149012, placed_triangles=500928)
ROLES = {'Limestone':'body', 'Recess':'recess', 'Slate':'roof',
         'Cornice':'stone_trim', 'Gilt':'gold', 'Window':'emissive_window'}
SETTINGS = dict(export_format='GLB', use_selection=True, use_active_scene=True,
                export_apply=False, export_normals=True, export_yup=True,
                export_materials='EXPORT', export_animations=False,
                export_cameras=False, export_lights=False, export_extras=True,
                export_texcoords=False, export_tangents=False, export_vertex_color='NONE',
                export_attributes=False, export_gpu_instances=False,
                export_hierarchy_full_collections=False,
                export_draco_mesh_compression_enable=False,
                export_meshopt_compression_enable=False, export_image_format='NONE')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def output(path, suffix):
    p = Path(path).resolve()
    if not (p.parent == ROOT or p.is_relative_to('/tmp/opencode')):
        raise ValueError('Output must be production-package root or /tmp/opencode scratch')
    if p.suffix != suffix or not p.parent.is_dir():
        raise ValueError('Expected new '+suffix+' in existing directory')
    if p.exists():
        raise FileExistsError(p)
    return p


def inventory(objects):
    meshes = [o for o in objects if o.type == 'MESH']
    data = {o.data for o in meshes}
    def tris(m):
        m.calc_loop_triangles()
        return len(m.loop_triangles)
    points = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
    return dict(objects=len(objects), mesh_objects=len(meshes), unique_meshes=len(data),
                linked_additional_placements=len(meshes)-len(data),
                unique_vertices=sum(len(m.vertices) for m in data),
                unique_triangles=sum(tris(m) for m in data),
                placed_triangles=sum(tris(o.data) for o in meshes),
                bounds_blender=[[min(p[i] for p in points) for i in range(3)],
                                [max(p[i] for p in points) for i in range(3)]],
                repeats={m.name:sorted(o.name for o in meshes if o.data == m)
                         for m in sorted(data, key=lambda m:m.name)
                         if sum(o.data == m for o in meshes)>1})


def load_source(path=SOURCE):
    assert sha(path) == SOURCE_SHA, 'Approved source checksum mismatch'
    generator=Path(path).parent/'build.py'
    if generator.exists(): assert sha(generator)==GENERATOR_SHA, 'Authoring generator changed'
    print('CITY SOURCE READ ATTEMPT', path, flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(path))
    assert set(bpy.data.collections.keys()) == {'CITY_ASSET'}
    assert all(o.type in {'MESH','EMPTY'} and not o.modifiers for o in bpy.data.objects)
    assert set(bpy.data.materials.keys()) == set(ROLES)
    bpy.context.view_layer.update()
    whole = inventory(list(bpy.context.scene.objects))
    assert all(whole[k] == v for k,v in SOURCE_COUNTS.items()), 'Full source scope changed'
    print('CITY SOURCE READ SUCCESS', whole['placed_triangles'], 'placed triangles', flush=True)
    return whole


def components(mesh):
    """Source construction consists of disconnected closed component shells."""
    links = [[] for _ in mesh.vertices]
    for e in mesh.edges:
        a,b = e.vertices; links[a].append(b); links[b].append(a)
    owner = {}; groups = []
    for i in range(len(links)):
        if i in owner: continue
        index = len(groups); owner[i] = index; stack = [i]; vertices = []
        while stack:
            v = stack.pop(); vertices.append(v)
            for near in links[v]:
                if near not in owner: owner[near] = index; stack.append(near)
        groups.append([sorted(vertices), []])
    for p in mesh.polygons:
        groups[owner[p.vertices[0]]][1].append(p.index)
    return groups


def detail_cap(mesh, vertices, faces):
    """Recognize the actual two-ring window recipe, not merely similar dimensions.

    Shape, material names, ordered cap/side connectivity and extrusion must all
    agree. Affine vertical shear admits the source's taper-aligned tower lancets.
    Unknown shapes conservatively remain closed and unchanged.
    """
    n = len(vertices)//2
    if n not in (4,7) or len(vertices) != 2*n or len(faces) != n+2: return None
    materials = {mesh.materials[mesh.polygons[f].material_index].name for f in faces}
    if len(materials) != 1: return None
    if n == 7 and not materials <= {'Recess','Cornice','Window'}: return None
    if n == 4 and materials != {'Cornice'}: return None
    first, second = vertices[:n], vertices[n:]
    co = [mesh.vertices[i].co for i in first]
    delta = mesh.vertices[second[0]].co-co[0]
    depth = .07 if n == 7 else .09
    if abs(delta.length-depth)>1e-5 or abs(delta.z)>1e-5: return None
    if any((mesh.vertices[b].co-mesh.vertices[a].co-delta).length>1e-5
           for a,b in zip(first,second)): return None
    required = {frozenset(first),frozenset(second)} | {
        frozenset((first[i],first[(i+1)%n],second[(i+1)%n],second[i])) for i in range(n)}
    if {frozenset(mesh.polygons[f].vertices) for f in faces} != required: return None
    caps = [f for f in faces if set(mesh.polygons[f].vertices) == set(first)]
    if len(caps)!=1 or mesh.polygons[caps[0]].normal.dot(delta)>-depth*.95: return None
    width = co[1]-co[0]; base=(co[0]+co[1])*.5
    if abs(width.z)>1e-5 or abs(width.normalized().dot(delta.normalized()))>1e-4: return None
    if n==7:
        shape=((-0.5,0),(.5,0),(.5,.69),(.34,.83),(0,1),(-.34,.83),(-.5,.69))
        rise=co[4]-base
        if not (.1<width.length<4 and .5<rise.z<13): return None
    else:
        shape=((-0.5,0),(.5,0),(.5,1),(-.5,1))
        rise=co[3]-co[0]
        if not (.01<width.length<.5 and .5<rise.z<10): return None
    if abs(rise.dot(width.normalized()))>2e-5: return None
    if any((p-(base+width*u+rise*z)).length>2e-5 for p,(u,z) in zip(co,shape)): return None
    return caps[0], 'lancet' if n==7 else 'mullion'


def family(mesh):
    users=[o for o in bpy.data.objects if o.type=='MESH' and o.data==mesh]
    assert users, 'Unused source data'
    if all(str(o.get('library_variant','')).startswith('P') for o in users): return 'palazzo'
    if all(str(o.get('library_variant','')).startswith('T') for o in users): return 'tower'
    if all(o.name.startswith('Landmark.') for o in users): return 'landmark'
    assert all(o.name.endswith('.Terrace') or o.name.startswith('Connector.') or
               o.name=='Infrastructure.MasonryAndStreets' for o in users), 'Unclassified architecture'
    return 'protected_structure'


def flatten_reveals(mesh):
    """Keep exact outward-facing cap of shallow lancets/mullions; no decimation.

    This recognizer is pinned to the immutable source generator's shell recipe:
    two ordered rings; lancet depth .07 or narrow mullion depth .09. Other shells
    (including arch .20 surrounds, .27 ribs and .42 webs) cannot enter this path.
    """
    remove = set(); kinds = collections.Counter()
    for vertices, faces in components(mesh):
        match=detail_cap(mesh,vertices,faces)
        if match is None: continue
        cap,kind=match
        remove.update(f for f in faces if f != cap)
        kinds[kind] += 1
    if not remove: return dict(removed_faces=0)
    # Rebuild only this mesh, once; object links and original origins remain intact.
    kept = [p for p in mesh.polygons if p.index not in remove]
    used = sorted({v for p in kept for v in p.vertices}); remap = {v:i for i,v in enumerate(used)}
    coords = [tuple(mesh.vertices[v].co) for v in used]
    polys = [tuple(remap[v] for v in p.vertices) for p in kept]
    roles = [p.material_index for p in kept]
    mesh.clear_geometry(); mesh.from_pydata(coords, [], polys)
    for p,m in zip(mesh.polygons,roles): p.material_index = m
    mesh.update()
    return dict(kinds, removed_faces=len(remove))


def derive():
    changes = {}
    for mesh in sorted({o.data for o in bpy.data.objects if o.type=='MESH'}, key=lambda m:m.name):
        kind=family(mesh)
        changes[mesh.name] = dict(family=kind, **flatten_reveals(mesh))
        if kind=='protected_structure':
            assert changes[mesh.name]['removed_faces']==0, 'Structural shell misclassified'
        else: assert changes[mesh.name].get('lancet',0)>0, 'Building family unrecognized'
    stamp_metadata()
    bpy.context.view_layer.update()
    return changes


def stamp_metadata():
    master = bpy.data.objects['CITY.ProvisionalLayout']
    master['status'] = 'full-city production candidate; assembled browser and integration acceptance pending'
    master['production_scope'] = 'complete existing city; all districts and infrastructure'
    master['source_sha256'] = SOURCE_SHA
    for obj in bpy.data.objects:
        obj['source_object'] = obj.name
        if obj.type == 'MESH': obj['shared_geometry_id'] = obj.data.name
    for name,role in ROLES.items():
        bpy.data.materials[name]['city_role'] = role
        bpy.data.materials[name]['source_material'] = name
    bpy.context.scene['approval'] = 'production derivative candidate, not runtime integration'


def export_glb(path):
    assert bpy.app.version_string == '5.2.1 LTS'
    assert io_scene_gltf2.get_version_string() == '5.2.40'
    assert all(k in bpy.ops.export_scene.gltf.get_rna_type().properties for k in SETTINGS)
    bpy.ops.object.select_all(action='SELECT')
    print('CITY EXPORT ATTEMPT', path, flush=True)
    assert bpy.ops.export_scene.gltf(filepath=str(path), **SETTINGS) == {'FINISHED'}
    assert path.stat().st_size > 0
    print('CITY EXPORT SUCCESS', path.stat().st_size, 'bytes', flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--source', type=Path, default=SOURCE)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--blend', type=Path, required=True)
    p.add_argument('--report', type=Path, required=True)
    a = p.parse_args(sys.argv[sys.argv.index('--')+1:])
    glb = output(a.output,'.glb'); blend = output(a.blend,'.blend'); report = output(a.report,'.json')
    try:
        whole = load_source(a.source); changes = derive()
        derived = inventory(list(bpy.context.scene.objects))
        print('CITY SAVE DERIVATIVE ATTEMPT', blend, flush=True)
        assert bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True) == {'FINISHED'}
        print('CITY SAVE DERIVATIVE SUCCESS', flush=True)
        export_glb(glb)
        report.write_text(json.dumps(dict(source_sha256=SOURCE_SHA, blender=bpy.app.version_string,
            exporter=io_scene_gltf2.get_version_string(), source=whole,
            derived=derived, reductions=changes, export_settings=SETTINGS), indent=2)+'\n')
    finally:
        assert sha(a.source) == SOURCE_SHA, 'Approved source changed'


if __name__ == '__main__': main()
