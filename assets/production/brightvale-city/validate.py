"""Read-only direct source/GLB and native reimport checks. Run in Blender."""
import argparse,json,sys,math
from collections import Counter
from pathlib import Path
sys.dont_write_bytecode=True
import bpy,numpy as np
from mathutils.kdtree import KDTree
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from glb_checks import sha,read_glb,count_scene,check_contract
SOURCE=ROOT.parents[1]/'authoring/brightvale-city/city.blend';EXPECTED='edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff'
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,default=ROOT);args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);out=args.output_dir.resolve()
assert sha(SOURCE)==EXPECTED and Path(bpy.data.filepath).resolve()==SOURCE.resolve()
manifest=json.loads((out/'manifest.json').read_text());mapping=json.loads((out/'material-map.json').read_text());glb=out/'city.glb';assert sha(glb)==manifest['artifact_sha256']
doc,binary=read_glb(glb);check_contract(doc);counts=count_scene(doc);errors=[]
assert counts['placed_triangles']==2946548 and counts['mesh_nodes']==5368 and counts['materials']==107
DT={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1',5122:'<i2',5120:'i1'};SIZE={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def access(index):
    a=doc['accessors'][index];assert 'sparse' not in a and not a.get('normalized',False)
    view=doc['bufferViews'][a['bufferView']];dtype=np.dtype(DT[a['componentType']]);size=SIZE[a['type']]
    return np.ndarray((a['count'],size),dtype=dtype,buffer=binary,offset=view.get('byteOffset',0)+a.get('byteOffset',0),strides=(view.get('byteStride',size*dtype.itemsize),dtype.itemsize))
def matrix(node):
    if 'matrix' in node:return np.array(node['matrix'],dtype=np.float64).reshape(4,4).T
    x,y,z,w=node.get('rotation',[0,0,0,1]);m=np.eye(4)
    m[:3,:3]=[[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]]
    m[:3,:3]*=np.array(node.get('scale',[1,1,1]))[None,:];m[:3,3]=node.get('translation',[0,0,0]);return m
node_world={}
def visit(i,parent):
    node_world[i]=parent@matrix(doc['nodes'][i])
    for child in doc['nodes'][i].get('children',[]):visit(child,node_world[i])
for i in doc['scenes'][doc.get('scene',0)]['nodes']:visit(i,np.eye(4))
C=np.array([[1,0,0],[0,0,1],[0,-1,0]],dtype=np.float64)
def positions(v,m):return np.asarray(v,dtype=np.float64)@m[:3,:3].T+m[:3,3]
def normals(v,m):
    n=np.asarray(v,dtype=np.float64)@np.linalg.inv(m[:3,:3]);return n/np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-30)
source_objects={o.name:o for o in bpy.context.scene.objects if o.type=='MESH' and any(c.name.startswith(tuple(f'{j:02} |' for j in range(1,8))) for c in o.users_collection)}
default_material=bpy.data.materials.new('Validation.default.only');default_material.use_nodes=True
default_bsdf=next(n for n in default_material.node_tree.nodes if n.type=='BSDF_PRINCIPLED');changed_inputs={};legacy_inputs={}
def socket_value(s):return tuple(s.default_value) if hasattr(s.default_value,'__len__') else s.default_value
for material in {s.material for o in source_objects.values() for s in o.material_slots if s.material}:
    bsdf=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    for socket in bsdf.inputs:
        if not hasattr(socket,'default_value'):continue
        if socket.is_unavailable:
            legacy_inputs.setdefault(socket.name,set()).add(socket_value(socket));continue
        assert socket.name in default_bsdf.inputs
        if socket_value(socket)!=socket_value(default_bsdf.inputs[socket.name]):changed_inputs[socket.name]=changed_inputs.get(socket.name,0)+1
assert set(changed_inputs)<={'Base Color','Metallic','Roughness','IOR','Emission Color','Emission Strength'},changed_inputs
graph_audit=dict(nondefault_active_input_material_counts=changed_inputs,unavailable_legacy_sockets={k:sorted(v) for k,v in legacy_inputs.items()},unsupported_active_surface_variation=False)
bpy.data.materials.remove(default_material)
nodes={n.get('extras',{}).get('source_object'):(i,n) for i,n in enumerate(doc['nodes']) if 'mesh' in n}
assert set(nodes)==set(source_objects)
dg=bpy.context.evaluated_depsgraph_get();max_pos=0.;max_normal=0.;max_uv=0.;corners=0;uv_source=0;uv_exported=0;lo=np.full(3,np.inf);hi=-lo;source_lo=np.full(3,np.inf);source_hi=-source_lo;source_triangle_counts={};degenerate_counts={};duplicate_counts={};water_keys=None
for counter,(name,o) in enumerate(source_objects.items()):
    ni,node=nodes[name];world=node_world[ni];e=o.evaluated_get(dg);m=e.to_mesh(preserve_all_data_layers=True,depsgraph=dg);m.calc_loop_triangles()
    xyz=np.empty((len(m.vertices),3),dtype=np.float32);m.vertices.foreach_get('co',xyz.ravel());sw=np.array(e.matrix_world,dtype=np.float64);srcpos=positions(xyz,sw)@C.T
    source_lo=np.minimum(source_lo,srcpos.min(axis=0));source_hi=np.maximum(source_hi,srcpos.max(axis=0))
    tris=np.empty((len(m.loop_triangles),3),dtype=np.int32);m.loop_triangles.foreach_get('vertices',tris.ravel())
    loops=np.empty_like(tris);m.loop_triangles.foreach_get('loops',loops.ravel())
    mi=np.empty(len(tris),dtype=np.int32);m.loop_triangles.foreach_get('material_index',mi)
    source_triangle_counts[name]=len(tris)
    degenerate_counts[name]=int(np.count_nonzero(np.linalg.norm(np.cross(srcpos[tris[:,1]]-srcpos[tris[:,0]],srcpos[tris[:,2]]-srcpos[tris[:,0]]),axis=1)<1e-12))
    keys=Counter(tuple(sorted(tuple(p) for p in triangle)) for triangle in srcpos[tris]);duplicate_counts[name]=sum(v-1 for v in keys.values())
    if name=='Ravine water | unified connected routes':water_keys=keys
    cn=np.empty((len(m.corner_normals),3),dtype=np.float32);m.corner_normals.foreach_get('vector',cn.ravel());srcnorm=normals(cn,sw)@C.T
    mats=[s.material.name if s.material else None for s in e.material_slots];used_names={mats[i] for i in set(mi.tolist())};export_names=set();triangle_total=0
    uv_source+=bool(m.uv_layers)
    source_uv=None
    if m.uv_layers:
        source_uv=np.empty((len(m.loops),2),dtype=np.float32);m.uv_layers.active.data.foreach_get('uv',source_uv.ravel());source_uv[:,1]=1-source_uv[:,1]
    for primitive in doc['meshes'][node['mesh']]['primitives']:
        material=doc['materials'][primitive['material']];original=material['extras']['source_material'];export_names.add(original)
        slot=mats.index(original);mask=mi==slot;expected=srcpos[tris[mask]];expected_n=srcnorm[loops[mask]]
        inds=access(primitive['indices'])[:,0].reshape(-1,3);gp=positions(access(primitive['attributes']['POSITION']),world);gn=normals(access(primitive['attributes']['NORMAL']),world)
        lo=np.minimum(lo,gp.min(axis=0));hi=np.maximum(hi,gp.max(axis=0));actual=gp[inds];actual_n=gn[inds];triangle_total+=len(inds);corners+=inds.size
        if expected.shape!=actual.shape:errors.append(dict(object=name,error='triangle/material grouping mismatch'));continue
        # Exporter emits each material's source loop triangles in stable order.
        ep=float(np.max(np.abs(expected-actual))) if len(inds) else 0.;en=float(np.max(np.abs(expected_n-actual_n))) if len(inds) else 0.
        max_pos=max(max_pos,ep);max_normal=max(max_normal,en)
        if source_uv is not None:
            assert 'TEXCOORD_0' in primitive['attributes']
            uv_error=float(np.max(np.abs(source_uv[loops[mask]]-access(primitive['attributes']['TEXCOORD_0'])[inds])))
            max_uv=max(max_uv,uv_error)
            if uv_error>1e-6:errors.append(dict(object=name,max_uv_error=uv_error))
        if ep>1e-4 or en>2e-4:errors.append(dict(object=name,material=original,max_position_error=ep,max_normal_error=en))
    if any('TEXCOORD_0' in p['attributes'] for p in doc['meshes'][node['mesh']]['primitives']):uv_exported+=1
    if triangle_total!=len(tris) or export_names!=used_names:errors.append(dict(object=name,error='lost triangles or material assignments'))
    e.to_mesh_clear()
    if counter%1000==0:print('DIRECT_COMPARE',counter,flush=True)
material_checks=[];byoriginal={m['extras']['source_material']:m for m in doc['materials']}
for src in mapping:
    m=byoriginal[src['source_material']];pbr=m.get('pbrMetallicRoughness',{});ext=m.get('extensions',{});em=np.array(m.get('emissiveFactor',[0,0,0]))*ext.get('KHR_materials_emissive_strength',{}).get('emissiveStrength',1)
    emission_error=float(np.max(np.abs(em-np.array(src['emission_color'])*src['emission_strength'])))
    if src['emission_strength']>0:
        assert m['emissiveFactor']==src['emission_color'] and ext['KHR_materials_emissive_strength']['emissiveStrength']==src['emission_strength']
    scalar_errors={key:abs(value-expected) for key,value,expected in [('metallic',pbr.get('metallicFactor',1),src['metallic']),('roughness',pbr.get('roughnessFactor',1),src['roughness']),('ior',ext.get('KHR_materials_ior',{}).get('ior',1.5),src['ior'])]}
    base_error=float(np.max(np.abs(np.array(pbr.get('baseColorFactor',[1,1,1,1]))-src['base_color'])))
    valid=emission_error<1e-6 and base_error<1e-6 and max(scalar_errors.values())<1e-6 and m.get('alphaMode','OPAQUE')=='OPAQUE' and m.get('doubleSided',False)==src['double_sided'] and m['extras']['city_role']==src['city_role'] and m['name']==src['export_material']
    if not valid:errors.append(dict(material=src['source_material'],base_error=base_error,emission_error=emission_error,scalar_errors=scalar_errors))
    material_checks.append(dict(source_material=src['source_material'],export_material=m['name'],city_role=m['extras']['city_role'],base_error=base_error,effective_emission_error=emission_error,scalar_errors=scalar_errors,passed=valid))
direct=dict(compared_objects=len(source_objects),compared_triangle_corners=corners,max_position_component_error_BU=max_pos,max_world_normal_component_error=max_normal,source_y_up_bounds=[source_lo.tolist(),source_hi.tolist()],glb_y_up_bounds=[lo.tolist(),hi.tolist()],source_meshes_with_uv=uv_source,glb_mesh_nodes_with_uv=uv_exported,method='Every triangle corner compared in source material-group order after full world transforms and one Z-up to Y-up conversion. Every corresponding normal compared using inverse-transpose and normalization. Not a sampled or silhouette-only check.')
print('DIRECT_OUTCOME',json.dumps(direct),flush=True)
direct['max_uv_component_error']=max_uv;direct['uv_method']='Every UV-bearing triangle corner compared after the standard glTF V-coordinate flip.'
# Independently open the artifact with Blender's installed importer, without a source save.
bpy.ops.wm.read_factory_settings(use_empty=True)
print('REIMPORT_ATTEMPT',glb,flush=True);assert bpy.ops.import_scene.gltf(filepath=str(glb))=={'FINISHED'}
imported=[o for o in bpy.context.scene.objects if o.type=='MESH'];tri=0;points=[];triangle_differences=[]
for o in imported:
    o.data.calc_loop_triangles();tri+=len(o.data.loop_triangles);points.extend(o.matrix_world@v.co for v in o.data.vertices)
    name=o.get('source_object');difference=source_triangle_counts[name]-len(o.data.loop_triangles)
    if difference:
        assert name=='Ravine water | unified connected routes' and difference==4 and duplicate_counts[name]==4
        xyz=np.array([tuple(o.matrix_world@v.co) for v in o.data.vertices])@C.T
        unique=sorted({p for triangle in water_keys for p in triangle});tree=KDTree(len(unique))
        for i,p in enumerate(unique):tree.insert(p,i)
        tree.balance();matched=[];max_distance=0.
        for p in xyz:
            _,i,distance=tree.find(p);matched.append(unique[i]);max_distance=max(max_distance,distance)
        assert max_distance<1e-4
        keys=Counter(tuple(sorted(matched[i] for i in t.vertices)) for t in o.data.loop_triangles)
        print('WATER_UNIQUE_COMPARE',len(keys),len(water_keys),'missing',len(set(water_keys)-set(keys)),'added',len(set(keys)-set(water_keys)),flush=True)
        assert set(keys)==set(water_keys) and all(v==1 for v in keys.values()),'Importer removed nonduplicate geometry'
        triangle_differences.append(dict(object=name,source_triangles=source_triangle_counts[name],reimport_triangles=len(o.data.loop_triangles),removed=difference,source_zero_area_triangles=degenerate_counts[name],source_duplicate_triangles=duplicate_counts[name],unique_triangle_coordinate_sets_preserved=True,max_matched_vertex_distance_BU=max_distance,reason='Installed Blender importer mesh.validate() removes duplicate faces; GLB retains all source triangles.'))
native_bounds=[[min(p[k] for p in points) for k in range(3)],[max(p[k] for p in points) for k in range(3)]];del points
inv=json.loads((ROOT/'source-inventory.json').read_text());expected_bounds=np.array(inv['assembly']['bounds_native_BU']);bound_error=float(np.max(np.abs(np.array(native_bounds)-expected_bounds)))
print('REIMPORT_COUNTS',json.dumps(dict(meshes=len(imported),triangles=tri,bounds=native_bounds,bound_error=bound_error,direct_errors=errors[:10],triangle_differences=triangle_differences)),flush=True)
assert len(imported)==5368 and tri==2946544 and bound_error<1e-4
assert {o.get('source_object') for o in imported}==set(source_objects)
reimport=dict(mesh_objects=len(imported),triangles=tri,triangle_differences=triangle_differences,materials=len({s.material.name for o in imported for s in o.material_slots if s.material}),native_z_up_bounds=native_bounds,max_bound_error_BU=bound_error,root_present=bpy.data.objects.get('CITY.ProvisionalLayout') is not None,linked_libraries=len(bpy.data.libraries),cameras=len(bpy.data.cameras),lights=len(bpy.data.lights))
assert reimport['root_present'] and reimport['linked_libraries']==0 and reimport['cameras']==0 and reimport['lights']==0
assert sha(SOURCE)==EXPECTED
report=dict(source_sha256=EXPECTED,artifact_sha256=sha(glb),counts=counts,assembly_contract_passed=True,direct_geometry=direct,active_material_graph_audit=graph_audit,material_checks=material_checks,reimport=reimport,errors=errors,source_unchanged=True,scope='Blender/static glTF transfer integrity. Not browser appearance, game camera fit or runtime performance approval.')
(out/'validation.json').write_text(json.dumps(report,indent=2)+'\n');print('VALIDATION_OUTCOME',len(errors),'errors',flush=True)
assert not errors,errors[:10]
