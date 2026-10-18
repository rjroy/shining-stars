"""Full-geometry, material-preserving GLB conversion from the immutable authoring master."""
import argparse,json,sys,hashlib,time
from pathlib import Path
sys.dont_write_bytecode=True
import bpy,io_scene_gltf2
from mathutils import Matrix
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from glb_checks import sha,read_glb,count_scene,check_contract,semantic_hash,write_glb,finalize_material_contract
SOURCE=ROOT.parents[1]/'authoring/brightvale-city/city.blend'
EXPECTED='edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff'
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,default=ROOT);args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=args.output_dir.resolve();assert out.is_dir();target=out/'city.glb'
assert not target.exists(),'Refusing to overwrite existing derivative'
assert Path(bpy.data.filepath).resolve()==SOURCE.resolve() and sha(SOURCE)==EXPECTED
assert bpy.app.version_string=='5.2.1 LTS' and tuple(io_scene_gltf2.bl_info['version'])==(5,2,40)
inventory=json.loads((ROOT/'source-inventory.json').read_text());mapping={m['source_material']:m for m in inventory['materials']['source_material_mapping']}
city=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(c.name.startswith(tuple(f'{i:02} |' for i in range(1,8))) for c in o.users_collection)]
assert len(city)==5368 and not bpy.data.objects.get('CITY.ProvisionalLayout')
used={slot.material for o in city for slot in o.material_slots if slot.material}
assert {m.name for m in used}==set(mapping), 'Unexpected material stock'
material_map=[]
for m in sorted(used,key=lambda m:m.name):
    original=m.name;rec=mapping[original]
    assert len(m.node_tree.nodes)==2 and {n.bl_idname for n in m.node_tree.nodes}=={'ShaderNodeBsdfPrincipled','ShaderNodeOutputMaterial'}
    assert len(m.node_tree.links)==1 and next(iter(m.node_tree.links)).to_socket.name=='Surface'
    bsdf=next(n for n in m.node_tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled')
    assert not any(i.is_linked for i in bsdf.inputs)
    assert bsdf.inputs['Alpha'].default_value==1 and bsdf.inputs['Transmission Weight'].default_value==0
    assert abs(bsdf.inputs['Emission Strength'].default_value-rec['emission_strength'])<1e-7
    role='emissive_window' if rec['emission_strength']>0 else rec['proposed_semantic_role']
    if role=='emissive_window':assert rec['proposed_semantic_role']=='city.glazing'
    for key in list(m.keys()):del m[key]
    m['city_role']=role;m['source_material']=original;m['surface_role']=rec['proposed_semantic_role']
    if original=='Citadel detail | amber glazing 0':m.name='Window'
    material_map.append(dict(rec,export_material=m.name,city_role=role))
assert sum(m['city_role']=='emissive_window' for m in material_map)==9
root=bpy.data.objects.new('CITY.ProvisionalLayout',None);bpy.context.scene.collection.objects.link(root);root.matrix_world=Matrix.Identity(4)
root['asset_id']='brightvale-city';root['source_sha256']=EXPECTED;root['units']='provisional Blender units; no agreed physical scale'
root['layout_transform']='identity; game placement is external and not baked'
for o in city:
    world=o.matrix_world.copy();family=next(c.name[:2] for c in o.users_collection if c.name[:2].isdigit())
    for key in list(o.keys()):del o[key]
    o['source_object']=o.name;o['city_family']=family
    o.parent=root;o.matrix_parent_inverse=Matrix.Identity(4);o.matrix_world=world
bpy.ops.object.select_all(action='DESELECT')
for o in city+[root]:o.select_set(True)
bpy.context.view_layer.objects.active=root;bpy.context.view_layer.update()
options=dict(filepath=str(target),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_apply=True,export_materials='EXPORT',export_normals=True,export_texcoords=True,export_tangents=False,export_vertex_color='NONE',export_extras=True,export_cameras=False,export_lights=False,export_animations=False,export_skins=False,export_morph=False,export_gpu_instances=False,export_draco_mesh_compression_enable=False,export_meshopt_compression_enable=False,export_use_gltfpack=False,export_unused_images=False,export_unused_textures=False,at_collection_center=False,will_save_settings=False)
rna=bpy.ops.export_scene.gltf.get_rna_type();assert all(k in rna.properties for k in options)
print('EXPORT_ATTEMPT',target,EXPECTED,len(city),len(used),flush=True);start=time.monotonic()
result=bpy.ops.export_scene.gltf(**options);assert result=={'FINISHED'} and target.is_file()
assert sha(SOURCE)==EXPECTED
doc,binary=read_glb(target);binary_hash=hashlib.sha256(binary).hexdigest()
ior_materials=finalize_material_contract(doc,material_map);write_glb(target,doc,binary)
doc,binary=read_glb(target);assert hashlib.sha256(binary).hexdigest()==binary_hash
check_contract(doc);counts=count_scene(doc)
assert counts['placed_triangles']==2946548 and counts['materials']==107 and counts['mesh_nodes']==5368
assert not doc.get('images') and not doc.get('textures')
manifest=dict(status='Candidate; structural/Blender transfer review only; consumer visual approval pending',source_path='../../authoring/brightvale-city/city.blend',source_sha256=EXPECTED,blender_version=bpy.app.version_string,exporter_version=list(io_scene_gltf2.bl_info['version']),artifact='city.glb',artifact_sha256=sha(target),artifact_bytes=target.stat().st_size,semantic_sha256=semantic_hash(doc,binary),counts=counts,extensions_used=doc.get('extensionsUsed',[]),export_options={k:v for k,v in options.items() if k!='filepath'},assembly_root='CITY.ProvisionalLayout',root_transform='identity',axes='glTF +Y up, one exporter axis conversion',game_transform_baked=False,materials='material-map.json',excluded='30 studio/inspection cameras,18 lights,world shaders,and Low.ravine.mist.volume. Physical families01-07 complete.',scope='Full evaluated geometry. No reduction, baking, compression, instancing claim, destructive merge, runtime substitution or source save.')
manifest['material_finalization']=dict(whitelisted_extras='Reasserted for every source material; exporter omitted extras for two evaluated material copies on first inspection.',ior_preserved=ior_materials,reason='Installed exporter gates IOR on other material extensions and dropped three opaque-water IOR values. Emit supported KHR_materials_ior directly; no surface or transparency change.',binary_geometry_buffer_sha256=binary_hash,binary_buffer_unchanged_by_finalization=True)
manifest['material_finalization']['emission']='Retain original RGB and original sub-unit strength separately using KHR_materials_emissive_strength for all nine emitting materials; same effective emission, no clamp.'
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');(out/'material-map.json').write_text(json.dumps(material_map,indent=2)+'\n')
print('EXPORT_OUTCOME',json.dumps(manifest), 'seconds',round(time.monotonic()-start,2),flush=True)
