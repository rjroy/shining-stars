"""Pinned targeted reduction then independently checked lossless spatial batching.

Run Blender opened on approved authoring city.blend. Never saves a .blend.
"""
import argparse,copy,json,math,sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy,io_scene_gltf2,numpy as np
from mathutils import Matrix
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from glb_checks import sha,read_glb,write_glb,count_scene,check_contract,finalize_material_contract,semantic_hash
from optimization_core import policy,components,component_triangle_counts,component_reduction_safe,batch_glb,accessor,world_matrices
SOURCE=ROOT.parents[1]/'authoring/brightvale-city/city.blend'
SOURCE_HASH='edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff'
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--scratch',type=Path,required=True);p.add_argument('--baseline',type=Path,required=True);p.add_argument('--material-map',type=Path,required=True);args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=args.output_dir.resolve();scratch=args.scratch.resolve();BASE=args.baseline.resolve();BASE_HASH=sha(BASE)
assert out.is_dir() and scratch.is_dir();target=out/'city-optimized.glb';stage=scratch/'city-reduced-unbatched.glb';assert not target.exists() and not stage.exists()
assert Path(bpy.data.filepath).resolve()==SOURCE.resolve() and sha(SOURCE)==SOURCE_HASH
baseline_manifest=json.loads((BASE.parent/'manifest.json').read_text());assert baseline_manifest['source_sha256']==SOURCE_HASH and baseline_manifest['artifact_sha256']==BASE_HASH
assert bpy.app.version_string=='5.2.1 LTS' and tuple(io_scene_gltf2.bl_info['version'])==(5,2,40)
mapping=json.loads(args.material_map.resolve().read_text());byoriginal={m['source_material']:m for m in mapping}
city=sorted([o for o in bpy.context.scene.objects if o.type=='MESH' and any(c.name.startswith(tuple(f'{i:02} |' for i in range(1,8))) for c in o.users_collection)],key=lambda o:o.name);assert len(city)==5368
dg=bpy.context.evaluated_depsgraph_get();records=[];family_totals={}
def triangle_count(m):m.calc_loop_triangles();return len(m.loop_triangles)
def distance_check(a,b,world):
    points_a=[world@v.co for v in a.vertices];points_b=[world@v.co for v in b.vertices]
    tree_a=BVHTree.FromPolygons(points_a,[tuple(t.vertices) for t in a.loop_triangles],all_triangles=True)
    tree_b=BVHTree.FromPolygons(points_b,[tuple(t.vertices) for t in b.loop_triangles],all_triangles=True)
    return max(tree_b.find_nearest(v)[3] for v in points_a),max(tree_a.find_nearest(v)[3] for v in points_b)
for i,o in enumerate(city):
    family=next(c.name[:2] for c in o.users_collection if c.name.startswith(tuple(f'{j:02} |' for j in range(1,8))))
    e=o.evaluated_get(dg);original=bpy.data.meshes.new_from_object(e,preserve_all_data_layers=True,depsgraph=dg);before=triangle_count(original)
    roles={byoriginal[s.material.name]['proposed_semantic_role'] for s in o.material_slots if s.material};choice=policy(family,roles,bool(original.uv_layers),original.has_custom_normals)
    rec=dict(source_object=o.name,family=family,policy=choice,before=before,after=before)
    if choice!='protected':
        old_components=components(original);o.data=original.copy();o.modifiers.clear();mod=o.modifiers.new('Authorized bounded reduction','DECIMATE')
        if choice=='leaf-collapse-0.5':mod.decimate_type='COLLAPSE';mod.ratio=.5;mod.use_collapse_triangulate=True
        else:mod.decimate_type='DISSOLVE';mod.angle_limit=math.radians(2);mod.delimit={'NORMAL','MATERIAL','SEAM','SHARP','UV'};mod.use_dissolve_boundaries=False
        bpy.context.view_layer.update();e=o.evaluated_get(dg);reduced=bpy.data.meshes.new_from_object(e,preserve_all_data_layers=True,depsgraph=dg);raw_count=triangle_count(reduced)
        # The exporter runs Mesh.validate(). Do it explicitly before counting,
        # then reject any collapse that loses a leaf or flattens a solid leaflet.
        cleaned=reduced.validate();after=triangle_count(reduced);parts=component_triangle_counts(reduced)
        unsafe=not component_reduction_safe(original,reduced,choice=='leaf-collapse-0.5')
        rec.update(raw_reduced_triangles=raw_count,derived_mesh_cleanup=cleaned,cleanup_triangles=raw_count-after)
        if unsafe:
            bpy.data.meshes.remove(reduced);reduced=original.copy();after=before;rec['policy']='protected-safety-fallback';rec['fallback_reason']='Global collapse would remove or flatten a disconnected leaflet; retain original geometry.'
        assert after<=before and after>0 and components(reduced)==old_components,(o.name,'component/count loss')
        assert {p.material_index for p in original.polygons}=={p.material_index for p in reduced.polygons},(o.name,'material region loss')
        forward,reverse=distance_check(original,reduced,o.matrix_world)
        rec.update(after=after,components_before=old_components,components_after=components(reduced),source_vertex_to_reduced_surface_max_BU=forward,reduced_vertex_to_source_surface_max_BU=reverse)
        previous=o.data;o.data=reduced;o.modifiers.clear();bpy.data.meshes.remove(previous)
    bpy.data.meshes.remove(original);records.append(rec);family_totals.setdefault(family,dict(before=0,after=0));family_totals[family]['before']+=before;family_totals[family]['after']+=rec['after']
    if i%1000==0:print('REDUCTION_PROGRESS',i,flush=True)
assert sum(r['before'] for r in records)==2946548
used={s.material for o in city for s in o.material_slots if s.material};assert {m.name for m in used}==set(byoriginal)
for m in used:
    source=m.name;rec=byoriginal[source]
    for key in list(m.keys()):del m[key]
    m.name=rec['export_material'];m['city_role']=rec['city_role'];m['source_material']=source;m['surface_role']=rec['proposed_semantic_role']
root=bpy.data.objects.new('CITY.ProvisionalLayout',None);bpy.context.scene.collection.objects.link(root);root.matrix_world=Matrix.Identity(4);root['source_sha256']=SOURCE_HASH;root['baseline_sha256']=BASE_HASH;root['game_transform']='external, unchanged .35 / (0,3.9,-55)';root['units']='provisional BU'
for o,rec in zip(city,records):
    world=o.matrix_world.copy()
    for key in list(o.keys()):del o[key]
    o['source_object']=rec['source_object'];o['city_family']=rec['family'];o.parent=root;o.matrix_parent_inverse=Matrix.Identity(4);o.matrix_world=world
bpy.ops.object.select_all(action='DESELECT')
for o in city+[root]:o.select_set(True)
bpy.context.view_layer.objects.active=root;bpy.context.view_layer.update()
options=json.loads((ROOT/'manifest.json').read_text())['export_options'];options['filepath']=str(stage)
(scratch/'reduction-records.json').write_text(json.dumps(records,indent=2)+'\n')
print('REDUCED_EXPORT_ATTEMPT',stage,flush=True);assert bpy.ops.export_scene.gltf(**options)=={'FINISHED'}
doc,binary=read_glb(stage);finalize_material_contract(doc,mapping);write_glb(stage,doc,binary);check_contract(doc);stage_counts=count_scene(doc)
from glb_checks import mesh_triangles
actual_by_name={n['extras']['source_object']:mesh_triangles(doc,n['mesh']) for n in doc['nodes'] if 'mesh' in n}
mismatches=[dict(source_object=r['source_object'],expected=r['after'],actual=actual_by_name[r['source_object']]) for r in records if r['after']!=actual_by_name[r['source_object']]]
print('STAGE_TRIANGLE_COUNTS',stage_counts['placed_triangles'],sum(r['after'] for r in records),'mismatches',json.dumps(mismatches),flush=True)
assert not mismatches
# Independently compare every protected primitive and every node world transform
# against the retained full GLB, before batching makes source ownership indirect.
baseline,basebin=read_glb(BASE);base_nodes={n['extras']['source_object']:(i,n) for i,n in enumerate(baseline['nodes']) if 'mesh' in n};nodes={n['extras']['source_object']:(i,n) for i,n in enumerate(doc['nodes']) if 'mesh' in n};bw=world_matrices(baseline);rw=world_matrices(doc);assert set(nodes)==set(base_nodes)
protected_corners=0
for rec in records:
    name=rec['source_object'];bi,bn=base_nodes[name];ri,rn=nodes[name];assert np.allclose(bw[bi],rw[ri],rtol=0,atol=1e-7),(name,'placement changed')
    if not rec['policy'].startswith('protected'):continue
    def primitives(d,n):return {d['materials'][p['material']]['extras']['source_material']:p for p in d['meshes'][n['mesh']]['primitives']}
    bp=primitives(baseline,bn);rp=primitives(doc,rn);assert set(bp)==set(rp)
    for mat,primitive in bp.items():
        other=rp[mat];ii=accessor(baseline,basebin,primitive['indices'])[:,0];jj=accessor(doc,binary,other['indices'])[:,0];assert set(primitive['attributes'])==set(other['attributes']) and len(ii)==len(jj)
        for attr,index in primitive['attributes'].items():assert np.array_equal(accessor(baseline,basebin,index)[ii],accessor(doc,binary,other['attributes'][attr])[jj]),(name,attr,'protected attributes changed')
        protected_corners+=len(ii)
print('BATCH_ATTEMPT',stage_counts,flush=True);batched,payload,coverage=batch_glb(doc,binary);check_contract(batched);assert batched['materials']==doc['materials'];counts=count_scene(batched);assert counts['placed_triangles']==stage_counts['placed_triangles'];write_glb(target,batched,payload)
assert sha(SOURCE)==SOURCE_HASH and sha(BASE)==BASE_HASH
manifest=dict(status='Reduced + spatially batched candidate; independent visual/consumer acceptance pending',source_sha256=SOURCE_HASH,baseline_sha256=BASE_HASH,artifact='city-optimized.glb',artifact_sha256=sha(target),artifact_bytes=target.stat().st_size,semantic_sha256=semantic_hash(batched,payload),baseline_bytes=BASE.stat().st_size,baseline_triangles=2946548,counts=counts,reduced_unbatched_counts=stage_counts,reduced_unbatched_sha256=sha(stage),reduced_unbatched_bytes=stage.stat().st_size,family_totals=family_totals,protected_triangle_corners_bitwise_verified=protected_corners,all_source_object_transforms_verified=True,materials_exactly_unchanged=True,source_and_baseline_unchanged=True,blender_version=bpy.app.version_string,exporter_version=list(io_scene_gltf2.bl_info['version']),policy='Only UV-free/custom-normal-free foliage surfaces collapse to 0.5; district/skyline trim limited dissolve 2 degrees with boundary/normal/material/seam/sharp/UV delimiters. All other geometry protected. No component or material region may disappear.',batching='Exact original material + family + 32-BU 3D cell + UV layout. All transformed triangle attributes checked exactly; normals inverse-transpose. No game transform baked, no axis conversion after the one exporter conversion.',placement_approval='User: The placement is perfect, but I agree that the geometry reduction needs to occur. Existing .35/(0,3.9,-55), game camera/highway, cropping and occlusion accepted; not broader appearance/performance acceptance.',loss_caveat='Leaf octahedra become tetrahedra without dropping connected components; subtle leaflet shape/facet loss. Trim curvature within limited-dissolve threshold coarsens. Culling granularity becomes spatial batches, not individual pieces. No shipping/performance claim.')
(out/'optimized-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');(out/'reduction-coverage.json').write_text(json.dumps(records,indent=2)+'\n');(out/'batch-coverage.json').write_text(json.dumps(coverage,indent=2)+'\n')
print('OPTIMIZED_EXPORT_OUTCOME',json.dumps(manifest),flush=True)
