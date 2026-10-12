"""Inspect uncompressed GLB and reimport it; no source/artifact saves.

Triangle/corner-normal comparison is against the original evaluated modifiers,
not against another export. Useful negative tests mutate only in-memory data.
"""
import argparse
import collections
import itertools
import json
import math
from pathlib import Path
import struct
import sys
sys.dont_write_bytecode = True
import bpy
import io_scene_gltf2
import numpy as np
from mathutils import Matrix, Quaternion, Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
import export as E

AXES = Matrix(((1,0,0),(0,0,1),(0,-1,0)))


def snapshot(objects):
    graph = bpy.context.evaluated_depsgraph_get(); result = {}
    for o in objects:
        ev = o.evaluated_get(graph); mesh = ev.to_mesh(); mesh.calc_loop_triangles()
        normals = mesh.corner_normals; normal_matrix = ev.matrix_world.to_3x3().inverted().transposed()
        triangles = []
        for t in mesh.loop_triangles:
            points = [list(ev.matrix_world @ mesh.vertices[mesh.loops[i].vertex_index].co) for i in t.loops]
            ns = [list((normal_matrix @ normals[i].vector).normalized()) for i in t.loops]
            triangles.append((o.material_slots[t.material_index].material.name, np.array(points), np.array(ns)))
        result[o.name] = {'triangles': triangles, 'origin': list(o.matrix_world.translation),
                          'editable_vertices': len(o.data.vertices), 'evaluated_vertices': len(mesh.vertices)}
        ev.to_mesh_clear()
    return result


def read_glb(path):
    payload = Path(path).read_bytes()
    assert len(payload) >= 20
    magic, version, length = struct.unpack_from('<4sII', payload)
    assert magic == b'glTF' and version == 2 and length == len(payload), 'Invalid GLB header'
    chunks = []; offset = 12
    while offset < length:
        size, kind = struct.unpack_from('<II', payload, offset); offset += 8
        assert size % 4 == 0 and offset+size <= length
        chunks.append((kind,payload[offset:offset+size])); offset += size
    assert [k for k,_ in chunks] == [0x4E4F534A,0x004E4942], 'Expected JSON/BIN only'
    return json.loads(chunks[0][1]), chunks[1][1]


def accessor(doc, binary, index):
    a = doc['accessors'][index]; assert 'sparse' not in a
    v = doc['bufferViews'][a['bufferView']]; assert v['buffer'] == 0
    types = {5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}
    widths = {'SCALAR':1,'VEC3':3}
    dtype = np.dtype(types[a['componentType']]); width = widths[a['type']]
    stride = v.get('byteStride', width*dtype.itemsize)
    start = v.get('byteOffset',0)+a.get('byteOffset',0)
    end = start+(a['count']-1)*stride+width*dtype.itemsize
    assert end <= v.get('byteOffset',0)+v['byteLength'] <= len(binary)
    value = np.ndarray((a['count'],width),dtype=dtype,buffer=binary,offset=start,strides=(stride,dtype.itemsize)).copy()
    assert np.isfinite(value).all()
    return value


def compare_triangles(expected, actual, normal_tolerance=2e-4):
    """Match material + oriented triangles within tolerance, retaining normals."""
    assert len(actual) == len(expected), 'Triangle count changed'
    cell = .001; bins = collections.defaultdict(list)
    def bucket(p): return tuple(math.floor(float(x)/cell) for x in p)
    for i,(role,p,n) in enumerate(expected): bins[(role,bucket(p.mean(axis=0)))].append(i)
    used = set(); max_position = 0.; max_normal = 0.; changed_normals = 0; changed_degenerate = 0
    for role,p,n in actual:
        center = bucket(p.mean(axis=0)); matches = []
        for delta in itertools.product((-1,0,1),repeat=3):
            for i in bins[(role,tuple(a+b for a,b in zip(center,delta)))]:
                if i in used: continue
                _,q,m = expected[i]
                for shift in range(3):
                    error = float(np.max(np.abs(p-np.roll(q,shift,axis=0))))
                    if error < 2e-6:
                        normal_error = float(np.max(np.abs(n-np.roll(m,shift,axis=0))))
                        # Very small/coincident source bevel triangles need the
                        # best exact-position match, not the first close one.
                        matches.append((error,normal_error,i))
        assert matches, ('Triangle/material/winding mismatch',role,p.tolist())
        error,normal_error,match = min(matches)
        if normal_tolerance is not None:
            assert normal_error < normal_tolerance, ('Corner normals changed',role,normal_error)
        if normal_error >= .001:
            changed_normals += 1
            if np.linalg.norm(np.cross(p[1]-p[0],p[2]-p[0])) <= 1e-10: changed_degenerate += 1
        max_position = max(max_position,error); max_normal = max(max_normal,normal_error)
        used.add(match)
    return {'triangles':len(actual),'maximum_position_error':max_position,'maximum_corner_normal_error':max_normal,
            'triangles_with_normal_component_error_ge_0_001':changed_normals,
            'of_those_near_zero_area':changed_degenerate}


def inspect(doc, binary, expected):
    assert doc['asset']['version'] == '2.0'
    assert len(doc.get('nodes',[])) == len(doc.get('meshes',[])) == 2, 'Unexpected object scope'
    assert len(doc['scenes']) == 1 and sorted(doc['scenes'][0]['nodes']) == [0,1]
    assert not doc.get('extensionsUsed') and not doc.get('extensionsRequired'), 'Non-core/compressed GLB'
    for key in ('cameras','skins','animations','images','textures','samplers'): assert not doc.get(key), ('Unexpected payload',key)
    assert len(doc['buffers']) == 1 and 'uri' not in doc['buffers'][0]
    assert len(doc['materials']) == 2 and {m['name'] for m in doc['materials']} == E.MATERIALS
    material_values = {}
    expected_pbr = {'Endcap body | midnight-blue enamel':([.015,.028,.065,1],.45,.32),
                    'Endcap edging | warm brushed gold':([.72,.36,.075,1],.82,.25)}
    for m in doc['materials']:
        pbr = m['pbrMetallicRoughness']; color,metal,rough = expected_pbr[m['name']]
        assert np.allclose(pbr['baseColorFactor'],color,atol=1e-7,rtol=0)
        assert abs(pbr['metallicFactor']-metal)<1e-7 and abs(pbr['roughnessFactor']-rough)<1e-7
        assert m.get('alphaMode','OPAQUE') == 'OPAQUE' and not m.get('extensions')
        assert m.get('doubleSided') is True, 'Source backface-culling behavior changed'
        assert not m.get('emissiveFactor') or max(m['emissiveFactor']) == 0
        material_values[m['name']] = {**pbr,'doubleSided':m['doubleSided']}
    all_points = []; meshes = {}; decoded_vertices = 0; primitives = 0
    assert {n['name'] for n in doc['nodes']} == E.NAMES
    for node in doc['nodes']:
        assert set(node) <= {'name','mesh','translation','rotation','scale'}
        assert np.allclose(node.get('scale',[1,1,1]),[1,1,1])
        translation = Vector(node.get('translation',[0,0,0])); rotation = node.get('rotation',[0,0,0,1])
        matrix = Matrix.Translation(translation) @ Quaternion((rotation[3],*rotation[:3])).to_matrix().to_4x4()
        origin = AXES @ Vector(expected[node['name']]['origin'])
        assert (translation-origin).length < 2e-6, 'Seated origin changed'
        triangles = []; points = []
        for primitive in doc['meshes'][node['mesh']]['primitives']:
            assert primitive.get('mode',4) == 4 and set(primitive['attributes']) == {'POSITION','NORMAL'}
            assert not primitive.get('extensions') and not primitive.get('targets')
            p = accessor(doc,binary,primitive['attributes']['POSITION']); n = accessor(doc,binary,primitive['attributes']['NORMAL'])
            indices = accessor(doc,binary,primitive['indices']).reshape(-1)
            assert len(indices)%3 == 0 and int(indices.max()) < len(p) and len(p) == len(n)
            assert np.max(np.abs(np.linalg.norm(n,axis=1)-1)) < 2e-5, 'Non-unit normals'
            p = np.array([list(matrix @ Vector(row)) for row in p]); n = np.array([list(matrix.to_3x3() @ Vector(row)) for row in n])
            role = doc['materials'][primitive['material']]['name']
            for tri in indices.reshape((-1,3)):
                q = p[tri]
                triangles.append((role,q,n[tri]))
            points.extend(p); decoded_vertices += len(p); primitives += 1
        source = [(role,np.array([list(AXES @ Vector(x)) for x in p]),np.array([list(AXES @ Vector(x)) for x in n])) for role,p,n in expected[node['name']]['triangles']]
        check = compare_triangles(source,triangles)
        def zero_area(records):
            return sum(np.linalg.norm(np.cross(p[1]-p[0],p[2]-p[0])) <= 1e-10 for role,p,n in records)
        inherited = int(zero_area(source)); exported = int(zero_area(triangles))
        assert exported == inherited, 'New degenerate triangles introduced'
        meshes[node['name']] = {**check,'origin_gltf':list(translation),'triangles_by_material':dict(collections.Counter(t[0] for t in triangles)),
                               'inherited_near_zero_area_triangles':inherited}
        all_points.extend(points)
    points = np.array(all_points); low = points.min(axis=0); high = points.max(axis=0)
    assert np.allclose(low,[-6.98,-.65,-2.7],atol=2e-6,rtol=0) and np.allclose(high,[6.98,1.15,2.8],atol=2e-6,rtol=0), 'Bounds/orientation changed'
    return {'nodes':2,'meshes':meshes,'materials':material_values,'primitives':primitives,
            'triangles':sum(m['triangles'] for m in meshes.values()),'decoded_primitive_vertices':decoded_vertices,
            'bounds_gltf':{'min':low.tolist(),'max':high.tolist(),'dimensions':(high-low).tolist()},
            'extensions':doc.get('extensionsUsed',[])}


def check(path, expected):
    before = E.sha(path); doc,binary = read_glb(path); result = inspect(doc,binary,expected)
    print('REIMPORT GLB ATTEMPT', path, flush=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    status = bpy.ops.import_scene.gltf(filepath=str(path),import_shading='NORMALS',merge_vertices=False)
    assert status == {'FINISHED'} and len(bpy.context.scene.objects) == 2
    assert all(o.type == 'MESH' for o in bpy.context.scene.objects)
    bpy.context.view_layer.update(); imported = snapshot(bpy.context.scene.objects)
    assert imported.keys() == expected.keys()
    reimport = {}
    for name in expected:
        assert np.allclose(imported[name]['origin'],expected[name]['origin'],atol=2e-6,rtol=0)
        # Blender importer writes normals through
        # normals_split_custom_set_from_vertices (installed imp/mesh.py:658),
        # which changes some corner normals around very small source bevel
        # triangles. Measure/disclose that importer difference, not require a
        # falsely exact normal roundtrip. The direct GLB check remains strict.
        reimport[name] = compare_triangles(expected[name]['triangles'],imported[name]['triangles'],normal_tolerance=None)
    assert E.sha(path) == before
    print('REIMPORT GLB SUCCESS; geometry/material regions match; normal deviations measured', flush=True)
    return {'pass':True,'blender':bpy.app.version_string,'gltf_exporter':io_scene_gltf2.get_version_string(),
            'source_sha256':E.SOURCE_SHA,'glb_sha256':before,'transfer_bytes':Path(path).stat().st_size,
            'export_settings':E.SETTINGS,'glb':result,'reimport_vs_source_evaluated':reimport,
            'limitations':['Fourteen near-zero-area triangles already exist in evaluated source triangulation; preserved without geometry cleanup.',
                           'Blender reimport custom-normal reconstruction is not exact; separate per-mesh normal errors are reported. Direct GLB corner normals are checked against source.',
                           'No official Khronos validator was installed/run; these are explicit structural/geometric checks.',
                           'Blender AgX, Principled BRDF and source studio presentation are not portable pixel appearance.'],
            'browser_runtime_approval':'PENDING; separate validation lane, not integration'}


def negative_tests(doc,binary,expected):
    import copy
    result = {}
    for name,modify in [('extra_reference_object',lambda d:d['nodes'].append({'name':'Reference platform'})),
                        ('material_role_loss',lambda d:d['materials'][0].update(name='Wrong role')),
                        ('origin_drift',lambda d:d['nodes'][0].update(translation=[0,0,0])),
                        ('compression_added',lambda d:d.update(extensionsUsed=['KHR_draco_mesh_compression']))]:
        bad = copy.deepcopy(doc); modify(bad)
        try: inspect(bad,binary,expected)
        except AssertionError: result[name+'_rejected'] = True
        else: raise AssertionError('Negative test accepted: '+name)
    triangles = next(iter(expected.values()))['triangles']; bad = list(triangles)
    role,p,n = bad[0]; bad[0] = (role,p,-n)
    try: compare_triangles(triangles,bad)
    except AssertionError: result['flipped_normals_rejected'] = True
    else: raise AssertionError('Negative normal test accepted')
    return result


def guard_tests(existing):
    import tempfile
    result = {}
    for name,path,message in [('existing_output',existing,None),
                              ('browser_directory_output',E.ROOT/'validation/forbidden.glb','Only production root'),
                              ('outside_output',Path('/tmp/endcap-outside-allowed.glb'),'Only production root'),
                              ('source_package_output',E.SOURCE.parent/'forbidden.glb','Only production root')]:
        try: E.new_output(path,'.glb')
        except (ValueError,FileExistsError) as error:
            assert message is None or message in str(error)
            result[name+'_rejected'] = True
        else: raise AssertionError('Output guard accepted '+name)
    # Corrupt only an owned scratch copy; verify rejection occurs before open.
    with tempfile.TemporaryDirectory(prefix='endcap-negative-',dir='/tmp/opencode') as scratch:
        data=bytearray(E.SOURCE.read_bytes()); data[-1] ^= 1
        bad=Path(scratch)/'wrong-source.blend'; bad.write_bytes(data)
        try: E.source_objects(bad)
        except AssertionError as error:
            assert 'checksum mismatch' in str(error); result['changed_source_rejected'] = True
        else: raise AssertionError('Changed source accepted')
    assert E.sha(E.SOURCE) == E.SOURCE_SHA
    return result


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True); parser.add_argument('--negative-test',action='store_true')
    parser.add_argument('--compare',type=Path,help='Independently reproduced GLB; exact bytes must match')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:]); out = E.new_output(args.report,'.json')
    expected = snapshot(E.source_objects()); report = check(args.input,expected)
    if args.compare:
        assert args.input.read_bytes() == args.compare.read_bytes(), 'Independent export bytes differ'
        report['independent_reproduction_byte_identical'] = True
    if args.negative_test:
        report['negative_tests'] = negative_tests(*read_glb(args.input),expected)
        report['negative_tests'].update(guard_tests(args.input))
    assert E.sha(E.SOURCE) == E.SOURCE_SHA
    with out.open('x') as stream: json.dump(report,stream,indent=2); stream.write('\n')
    print('TECHNICAL VALIDATION PASS',out,flush=True)


if __name__ == '__main__': main()
