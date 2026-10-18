"""Independent all-corner exact equivalence, bounds/coverage and clean reimport."""
import argparse,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy,numpy as np
from mathutils.kdtree import KDTree
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from glb_checks import sha,read_glb,count_scene,check_contract,identity
from optimization_core import accessor
from spatial_core import recover_pieces,geometry_digest
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,default=ROOT);args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);out=args.output_dir.resolve()
m=json.loads((out/'spatial-manifest.json').read_text());config=m['config'];target=out/'city-optimized-spatial.glb';assert sha(target)==m['artifact_sha256']
protected={ROOT/'city-optimized.glb':config['source_optimized_sha256'],ROOT/'batch-coverage.json':config['source_batch_coverage_sha256'],ROOT/'city.glb':config['full_baseline_sha256'],ROOT.parents[1]/'authoring/brightvale-city/city.blend':config['source_native_sha256']};assert all(sha(p)==h for p,h in protected.items())
source,sbin=read_glb(ROOT/'city-optimized.glb');pieces=recover_pieces(source,sbin,json.loads((ROOT/'batch-coverage.json').read_text()));assert geometry_digest(pieces)==m['source_geometry_sha256'];doc,binary=read_glb(target);check_contract(doc);counts=count_scene(doc);assert counts==m['counts'];assert doc['materials']==source['materials'] and len(doc['materials'])==107
assert all(identity(n) for n in doc['nodes']);coverage=json.loads((out/'spatial-coverage.json').read_text());nodes={n['name']:n for n in doc['nodes'] if 'mesh' in n};assert set(nodes)=={g['batch'] for g in coverage['groups']};seen=[];corners=0;lo=np.full(3,np.inf);hi=-lo
for group in coverage['groups']:
    n=nodes[group['batch']];prims=doc['meshes'][n['mesh']]['primitives'];assert len(prims)==1;p=prims[0];ii=accessor(doc,binary,p['indices'])[:,0];attrs={k:accessor(doc,binary,a) for k,a in p['attributes'].items()};offset=0
    assert doc['materials'][p['material']]['name']==group['material'];xyz=attrs['POSITION'];gl=xyz.min(axis=0);gh=xyz.max(axis=0);assert np.array_equal(gl,group['bounds'][0]) and np.array_equal(gh,group['bounds'][1]);lo=np.minimum(lo,gl);hi=np.maximum(hi,gh)
    if group['oversized_original_piece']:assert len(group['members'])==1 and float((gh-gl).max())>config['max_group_axis_span_BU']
    else:assert float((gh-gl).max())<=config['max_group_axis_span_BU']
    for member in group['members']:
        piece=pieces[member['piece_id']];seen.append(piece['id']);length=len(piece['indices']);assert length==member['triangles']*3 and piece['source_object']==member['source_object'] and piece['family']==group['family'] and piece['material']==p['material'] and set(piece['attrs'])==set(attrs)
        for key,v in piece['attrs'].items():
            a=np.ascontiguousarray(v[piece['indices']]);b=np.ascontiguousarray(attrs[key][ii[offset:offset+length]]);assert a.dtype==b.dtype and a.shape==b.shape and a.tobytes()==b.tobytes(),(piece['id'],key,'surface bytes changed')
        offset+=length;corners+=length
    assert offset==len(ii) and offset==group['triangles']*3
assert sorted(seen)==list(range(6644)) and len({p['source_object'] for p in pieces})==5368 and corners==2589764*3
expected=np.array(json.loads((ROOT/'optimized-validation.json').read_text())['glb_y_up_bounds']);assert np.array_equal(np.array([lo,hi]),expected)
print('SPATIAL_EXACT_SURFACE_PASS',corners,counts,flush=True)
bpy.ops.wm.read_factory_settings(use_empty=True);assert bpy.ops.import_scene.gltf(filepath=str(target))=={'FINISHED'};objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];assert len(objects)==counts['mesh_nodes'];triangles=0;cleanup=[];max_distance=0.;C=np.array([[1,0,0],[0,0,1],[0,-1,0]])
for o in objects:
    n=nodes[o.name];p=doc['meshes'][n['mesh']]['primitives'][0];xyz=accessor(doc,binary,p['attributes']['POSITION']);ii=accessor(doc,binary,p['indices'])[:,0].reshape(-1,3);unique,inverse=np.unique(xyz,axis=0,return_inverse=True);expected_tris=np.unique(np.sort(inverse[ii],axis=1),axis=0);tree=KDTree(len(unique))
    for i,v in enumerate(unique):tree.insert(v,i)
    tree.balance();mapped=[]
    for vertex in o.data.vertices:
        _,i,d=tree.find(np.array(o.matrix_world@vertex.co)@C.T);assert d<1e-4;mapped.append(i);max_distance=max(max_distance,d)
    o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles);imported=np.array([[mapped[i] for i in t.vertices] for t in o.data.loop_triangles]);actual=np.unique(np.sort(imported,axis=1),axis=0);assert np.array_equal(actual,expected_tris),(o.name,'unique geometry lost')
    removed=len(ii)-len(imported)
    if removed:assert 0<removed<=len(ii)-len(expected_tris);cleanup.append(dict(batch=o.name,duplicate_faces_removed=removed))
assert len({s.material for o in objects for s in o.material_slots if s.material})==107 and not bpy.data.libraries and not bpy.data.cameras and not bpy.data.lights
assert all(sha(p)==h for p,h in protected.items()) and sha(target)==m['artifact_sha256']
r=dict(status='PASS; not actual consumer appearance/performance approval',artifact_sha256=m['artifact_sha256'],source_optimized_sha256=config['source_optimized_sha256'],source_geometry_sha256=m['source_geometry_sha256'],counts=counts,complete_triangle_corners_byte_compared=corners,source_material_primitives_accounted=6644,source_objects_accounted=5368,all_material_dictionaries_exactly_equal=True,normals_and_uvs_and_winding_exactly_equal=True,all_nodes_identity=True,glb_y_up_bounds=[lo.tolist(),hi.tolist()],bounds_exactly_equal=True,max_nonoversized_group_span_BU=config['max_group_axis_span_BU'],oversized_original_pieces_isolated=m['oversized_original_primitives_isolated'],clean_reimport_meshes=len(objects),clean_reimport_triangles=triangles,reimport_duplicate_face_cleanup=cleanup,reimport_all_unique_triangle_coordinate_sets_preserved=True,reimport_max_matched_vertex_distance_BU=max_distance,protected_source_inputs_unchanged=True)
(out/'spatial-validation.json').write_text(json.dumps(r,indent=2)+'\n');print('SPATIAL_VALIDATION_OUTCOME',len(objects),triangles,'cleanup',sum(c['duplicate_faces_removed'] for c in cleanup),'PASS',flush=True)
