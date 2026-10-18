"""Independent staged/batched triangle-attribute and clean Blender reimport checks."""
import argparse,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy,numpy as np
from mathutils.kdtree import KDTree
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from glb_checks import sha,read_glb,count_scene,check_contract,identity
from optimization_core import accessor,world_matrices,transform_attributes
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,default=ROOT);p.add_argument('--stage',type=Path,required=True);args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=args.output_dir.resolve()
manifest=json.loads((out/'optimized-manifest.json').read_text());coverage=json.loads((out/'batch-coverage.json').read_text());records=json.loads((out/'reduction-coverage.json').read_text());source=ROOT.parents[1]/'authoring/brightvale-city/city.blend';base=ROOT/'city.glb';target=out/'city-optimized.glb'
assert sha(source)==manifest['source_sha256'] and sha(base)==manifest['baseline_sha256'] and sha(target)==manifest['artifact_sha256'] and sha(args.stage)==manifest['reduced_unbatched_sha256']
doc,binary=read_glb(target);stage,sbin=read_glb(args.stage);baseline,bbin=read_glb(base);check_contract(doc);counts=count_scene(doc);assert counts==manifest['counts']
assert {m['name']:m for m in doc['materials']}=={m['name']:m for m in baseline['materials']};assert len(doc['materials'])==107
assert all(identity(n) for n in doc['nodes']) and not doc.get('images') and not doc.get('textures')
assert len(records)==5368 and sum(r['before'] for r in records)==2946548 and sum(r['after'] for r in records)==counts['placed_triangles']
assert {m['source_object'] for g in coverage['groups'] for m in g['members']}=={r['source_object'] for r in records}
stage_nodes={n['extras']['source_object']:(i,n) for i,n in enumerate(stage['nodes']) if 'mesh' in n};worlds=world_matrices(stage);batch_nodes={n['name']:n for n in doc['nodes'] if 'mesh' in n};corners=0;lo=np.full(3,np.inf);hi=-lo
base_nodes={n['extras']['source_object']:(i,n) for i,n in enumerate(baseline['nodes']) if 'mesh' in n};base_world=world_matrices(baseline);protected_corners=0
for record in records:
    name=record['source_object'];si,sn=stage_nodes[name];bi,bn=base_nodes[name];assert np.allclose(worlds[si],base_world[bi],atol=1e-7,rtol=0)
    if not record['policy'].startswith('protected'):continue
    def by_material(d,n):return {d['materials'][p['material']]['name']:p for p in d['meshes'][n['mesh']]['primitives']}
    expected=by_material(baseline,bn);actual=by_material(stage,sn);assert set(expected)==set(actual)
    for material,part in expected.items():
        other=actual[material];ii=accessor(baseline,bbin,part['indices'])[:,0];jj=accessor(stage,sbin,other['indices'])[:,0];assert set(part['attributes'])==set(other['attributes'])
        for attr,index in part['attributes'].items():
            left=np.ascontiguousarray(accessor(baseline,bbin,index)[ii]);right=np.ascontiguousarray(accessor(stage,sbin,other['attributes'][attr])[jj]);assert left.dtype==right.dtype and left.shape==right.shape and left.tobytes()==right.tobytes(),(name,attr,'protected bytes changed')
        protected_corners+=len(ii)
for group in coverage['groups']:
    node=batch_nodes[group['batch']];primitive=doc['meshes'][node['mesh']]['primitives'][0];inds=accessor(doc,binary,primitive['indices'])[:,0];attrs={k:accessor(doc,binary,i) for k,i in primitive['attributes'].items()};offset=0
    assert doc['materials'][primitive['material']]['name']==group['material']
    for member in group['members']:
        i,n=stage_nodes[member['source_object']];parts=[p for p in stage['meshes'][n['mesh']]['primitives'] if stage['materials'][p['material']]['name']==group['material']];assert len(parts)==1
        part=parts[0];si=accessor(stage,sbin,part['indices'])[:,0];expected=transform_attributes({k:accessor(stage,sbin,j) for k,j in part['attributes'].items()},worlds[i]);assert len(si)==member['triangles']*3
        for k,v in expected.items():assert np.array_equal(v[si],attrs[k][inds[offset:offset+len(si)]]),(group['batch'],member['source_object'],k)
        offset+=len(si);corners+=len(si)
    assert offset==len(inds);lo=np.minimum(lo,attrs['POSITION'].min(axis=0));hi=np.maximum(hi,attrs['POSITION'].max(axis=0))
expected_bounds=np.array(json.loads((ROOT/'validation.json').read_text())['direct_geometry']['glb_y_up_bounds']);error=float(np.max(np.abs(np.array([lo,hi])-expected_bounds)));assert error<1e-4
print('OPTIMIZED_DIRECT_VALIDATION',counts,'corners',corners,'bound_error',error,flush=True)
bpy.ops.wm.read_factory_settings(use_empty=True);assert bpy.ops.import_scene.gltf(filepath=str(target))=={'FINISHED'}
objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];assert len(objects)==counts['mesh_nodes'];triangles=0;duplicate_cleanup=[];max_nearest=0.
C=np.array([[1,0,0],[0,0,1],[0,-1,0]])
for o in objects:
    n=batch_nodes[o.name];p=doc['meshes'][n['mesh']]['primitives'][0];xyz=accessor(doc,binary,p['attributes']['POSITION']);ii=accessor(doc,binary,p['indices'])[:,0].reshape(-1,3);o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles)
    # Compare all unique triangle-coordinate sets, not just totals or bounds.
    unique,inverse=np.unique(xyz,axis=0,return_inverse=True);expected=np.unique(np.sort(inverse[ii],axis=1),axis=0);tree=KDTree(len(unique))
    for i,point in enumerate(unique):tree.insert(point,i)
    tree.balance();mapped=[]
    for v in o.data.vertices:
        point=np.array(o.matrix_world@v.co)@C.T;_,i,d=tree.find(point);assert d<1e-4;(mapped.append(i));max_nearest=max(max_nearest,d)
    imported=np.array([[mapped[i] for i in t.vertices] for t in o.data.loop_triangles]);actual=np.unique(np.sort(imported,axis=1),axis=0);assert np.array_equal(actual,expected),(o.name,'unique triangles lost')
    difference=len(ii)-len(o.data.loop_triangles)
    if difference:
        # Blender removes duplicate index-faces, not every coordinate duplicate:
        # identical positions may deliberately retain different normals/UVs.
        assert 0<difference<=len(ii)-len(expected)
        duplicate_cleanup.append(dict(batch=o.name,glb_triangles=len(ii),imported_triangles=len(o.data.loop_triangles),removed_duplicate_triangles=difference,coordinate_duplicate_triangles_available=len(ii)-len(expected)))
assert len({s.material for o in objects for s in o.material_slots if s.material})==107
assert not bpy.data.libraries and not bpy.data.cameras and not bpy.data.lights
assert sha(source)==manifest['source_sha256'] and sha(base)==manifest['baseline_sha256'] and sha(target)==manifest['artifact_sha256']
report=dict(artifact_sha256=manifest['artifact_sha256'],source_sha256=manifest['source_sha256'],baseline_sha256=manifest['baseline_sha256'],counts=counts,all_107_materials_exactly_unchanged=True,all_source_objects_accounted_for=True,protected_triangle_corners_byte_compared=protected_corners,batch_triangle_corners_exactly_compared=corners,glb_y_up_bounds=[lo.tolist(),hi.tolist()],max_bound_error_BU=error,reimport_meshes=len(objects),reimport_triangles=triangles,reimport_duplicate_cleanup=duplicate_cleanup,reimport_all_unique_triangle_coordinate_sets_preserved=True,reimport_max_matched_vertex_distance_BU=max_nearest,source_and_baseline_unchanged=True,status='PASS; geometric transfer/reimport only, not consumer appearance or performance acceptance')
(out/'optimized-validation.json').write_text(json.dumps(report,indent=2)+'\n');print('OPTIMIZED_VALIDATION_OUTCOME',json.dumps(report),flush=True)
