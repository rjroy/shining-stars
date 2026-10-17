"""Shared, source-preserving structural export checks; Blender 5.2.1 only.

Used by the three sibling production packages. No authoring generator is run.
All file writes require NEW production-root files or /tmp/opencode scratch.
"""
import argparse, collections, copy, hashlib, itertools, json, math, shutil, struct, sys, tempfile
from pathlib import Path
sys.dont_write_bytecode = True
import bpy
import io_scene_gltf2
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parent
AUTHORING = ROOT.parents[1] / 'authoring'
SOURCES = {
 'platform': ('neon-twilight-platform/platform-slot-cues.blend','72ba506b25c7ddfc61541dc9cc54bd65880fa112ad1e51dd839a0fa794befe26'),
 'highway': ('brightvale-scene-review/scene-review.blend','fb630ac23fc576c42ebe4961b917b207fefb4894f9bbfc0b812bb6bf7329046b'),
 'framing': ('brightvale-outer-framing/framing.blend','cd17e3162c434ce4054f6c32d86d4b6a885e9dbad44c1841b563513fffd75542')}
AXES = Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
SETTINGS = dict(export_format='GLB',use_selection=True,use_active_scene=True,
 export_apply=True,export_normals=True,export_yup=True,export_materials='EXPORT',
 export_animations=False,export_cameras=False,export_lights=False,export_extras=False,
 export_texcoords=False,export_tangents=False,export_vertex_color='NONE',export_attributes=False,
 export_gpu_instances=False,export_hierarchy_full_collections=False,
 export_draco_mesh_compression_enable=False,export_meshopt_compression_enable=False,export_image_format='NONE')

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def new_output(path, package, suffix):
 p = Path(path).resolve(); package=Path(package).resolve()
 if p.is_relative_to(AUTHORING) or (p.is_relative_to(package) and p.parent!=package):
  raise ValueError('Source packages and nested production directories are read-only')
 if p.parent != package and not p.is_relative_to(Path('/tmp/opencode')):
  raise ValueError('Only package root files or /tmp/opencode scratch allowed')
 if p.suffix != suffix or not p.parent.is_dir(): raise ValueError('New file in existing directory required')
 if p.exists(): raise FileExistsError(p)
 return p

def snapshot(objects):
 graph=bpy.context.evaluated_depsgraph_get(); result={}
 for o in sorted(objects,key=lambda o:o.name):
  ev=o.evaluated_get(graph); mesh=ev.to_mesh(); mesh.calc_loop_triangles()
  normal=ev.matrix_world.to_3x3().inverted().transposed(); records=[]
  for t in mesh.loop_triangles:
   points=np.array([list(ev.matrix_world @ mesh.vertices[mesh.loops[i].vertex_index].co) for i in t.loops])
   ns=np.array([list((normal @ mesh.corner_normals[i].vector).normalized()) for i in t.loops])
   records.append((mesh.materials[t.material_index].name,points,ns))
  result[o.name]={'triangles':records,'matrix':o.matrix_world.copy(),
    'vertices':len(mesh.vertices),'source_type':o.type,
    'modifiers':[m.type for m in o.modifiers], 'uv_layers':len(mesh.uv_layers),
    'color_attributes':len(mesh.color_attributes)}
  ev.to_mesh_clear()
 return result

def bounds(records):
 p=np.concatenate([p for role,p,n in records]); lo=p.min(axis=0);hi=p.max(axis=0)
 return {'min':lo.tolist(),'max':hi.tolist(),'dimensions':(hi-lo).tolist()}

def load(kind, source=None):
 family='framing' if kind in ('long','short','post') else kind
 rel,expected=SOURCES[family]; source=Path(source or AUTHORING/rel).resolve()
 assert sha(source)==expected,'Source checksum mismatch'
 assert bpy.app.version_string=='5.2.1 LTS'
 assert io_scene_gltf2.get_version_string()=='5.2.40'
 assert all(k in bpy.ops.export_scene.gltf.get_rna_type().properties for k in SETTINGS)
 print('SOURCE READ ATTEMPT',kind,source,flush=True)
 bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.view_layer.update()
 if kind=='platform':
  objects=[o for o in bpy.context.scene.objects if o.type in ('MESH','CURVE') and not o.name.startswith('Studio')]
  assert len(objects)==52 and not any(o.parent for o in objects)
  assert 'Timing | thin transverse light rule' not in {o.name for o in objects},'False timing cue restored'
  borders={f'Lane {i} | substantial continuous profiled border':f'Slot border | {color} 75 lane 25 gold'
           for i,color in enumerate(('cyan','magenta','amber','green'),1)}
  for name,role in borders.items():
   obj=bpy.data.objects[name]
   assert len(obj.data.materials)==1 and obj.data.materials[0].name==role,'Dedicated slot tint lost'
   assert [o.name for o in objects if role in [m.name for m in o.data.materials]]==[name],'Slot tint leaked to protected geometry'
  assert sum(o.name.startswith('Hit bar ') for o in objects)==12,'Actual hit target component lost'
 elif kind=='highway':
  objects=[o for o in bpy.context.scene.objects if o.get('review_asset')=='highway']
  assert len(objects)==14 and all(o.type=='MESH' for o in objects)
  root=bpy.data.objects['COMPOSITION.Playfield.ForegroundPivot']
  assert abs(root.rotation_euler.x-math.radians(14))<1e-7
  for o in objects:
   assert o.parent==root and np.allclose(o.matrix_parent_inverse,Matrix.Identity(4),atol=1e-7)
   local=o.matrix_basis.copy();o.parent=None;o.matrix_world=local
   o.name=o['source_object']
 else:
  root=bpy.data.objects['Framing | left '+kind+' | floor origin']
  objects=list(root.children)
  assert len(objects)==(3 if kind=='post' else 1)
  for o in objects:
   local=o.matrix_basis.copy();o.parent=None;o.matrix_world=local
   o.name=o.data.name.removesuffix('.001')
 assert all(o.matrix_world.determinant()>0 and not o.animation_data for o in objects)
 bpy.context.view_layer.update(); expected_geometry=snapshot(objects)
 b=bounds([t for v in expected_geometry.values() for t in v['triangles']])
 expected_dimensions={'platform':[12,5.5,1.145],'highway':[12,42.165,.805],
                      'long':[2.92,.68,1.15],'short':[1.92,.68,1.15],'post':[.94,.84,1.35]}
 assert np.allclose(b['dimensions'],expected_dimensions[kind],atol=8e-6,rtol=0),('Dimensions changed',kind,b)
 if kind=='highway':assert np.allclose(b['min'],[-6,2.535,-.3],atol=8e-6)
 if family=='framing':assert abs(b['min'][2])<1e-7,'Floor origin lost'
 materials={m.name:m for o in objects for m in o.data.materials}; values={}
 for name,m in sorted(materials.items()):
  assert m.use_nodes and not any(n.type=='TEX_IMAGE' for n in m.node_tree.nodes)
  bs=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
  emit=next((n for n in m.node_tree.nodes if n.type=='EMISSION'),None)
  if bs:
   v={'base':list(bs.inputs['Base Color'].default_value),'metallic':bs.inputs['Metallic'].default_value,
      'roughness':bs.inputs['Roughness'].default_value,
      'emission':list(bs.inputs['Emission Color'].default_value)[:3],
      'strength':bs.inputs['Emission Strength'].default_value,
      'procedural_fallback':bs.inputs['Base Color'].is_linked or bs.inputs['Roughness'].is_linked}
  else:
   assert emit
   v={'base':[0,0,0,1],'metallic':0.,'roughness':1.,'emission':list(emit.inputs['Color'].default_value)[:3],
      'strength':emit.inputs['Strength'].default_value,'pure_emitter':True,'procedural_fallback':False}
  v['role_color']=list(m.diffuse_color);v['double_sided']=not m.use_backface_culling;values[name]=v
 print('SOURCE READ SUCCESS',len(objects),'geometry objects',flush=True)
 return source,objects,expected_geometry,values

def prepare(objects, values):
 """Convert only evaluated curves; translate unsupported material graphs in memory."""
 for index,o in enumerate(objects):
  if o.type=='CURVE':
   mesh=bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()),preserve_all_data_layers=True,depsgraph=bpy.context.evaluated_depsgraph_get())
   name=o.name;matrix=o.matrix_world.copy();bpy.data.objects.remove(o,do_unlink=True)
   replacement=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(replacement)
   replacement.matrix_world=matrix;objects[index]=replacement
 for o in objects:
  for m in o.data.materials:
   v=values[m.name]
   if not (v['procedural_fallback'] or v.get('pure_emitter')):continue
   nodes=m.node_tree.nodes;nodes.clear();bs=nodes.new('ShaderNodeBsdfPrincipled');out=nodes.new('ShaderNodeOutputMaterial')
   m.node_tree.links.new(bs.outputs['BSDF'],out.inputs['Surface'])
   for socket,key in [('Base Color','base'),('Metallic','metallic'),('Roughness','roughness'),('Emission Strength','strength')]:bs.inputs[socket].default_value=v[key]
   bs.inputs['Emission Color'].default_value=(*v['emission'],1)
 for o in list(bpy.data.objects):
  if o not in objects:bpy.data.objects.remove(o,do_unlink=True)
 bpy.context.scene.camera=None;bpy.context.view_layer.update()
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0]

def read_glb(path):
 payload=Path(path).read_bytes();magic,version,length=struct.unpack_from('<4sII',payload)
 assert magic==b'glTF' and version==2 and length==len(payload),'Bad GLB header'
 chunks=[];offset=12
 while offset<length:
  size,kind=struct.unpack_from('<II',payload,offset);offset+=8
  assert size%4==0 and offset+size<=length
  chunks.append((kind,payload[offset:offset+size]));offset+=size
 assert [k for k,_ in chunks]==[0x4E4F534A,0x004E4942]
 return json.loads(chunks[0][1]),chunks[1][1]

def accessor(doc, binary, index):
 a=doc['accessors'][index];assert 'sparse' not in a
 v=doc['bufferViews'][a['bufferView']];assert v['buffer']==0
 dtype=np.dtype({5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']]);width={'SCALAR':1,'VEC3':3}[a['type']]
 stride=v.get('byteStride',width*dtype.itemsize);start=v.get('byteOffset',0)+a.get('byteOffset',0)
 assert start+(a['count']-1)*stride+width*dtype.itemsize<=v.get('byteOffset',0)+v['byteLength']<=len(binary)
 data=np.ndarray((a['count'],width),dtype=dtype,buffer=binary,offset=start,strides=(stride,dtype.itemsize)).copy()
 assert np.isfinite(data).all();return data

def compare_triangles(expected, actual, normals=True):
 assert len(expected)==len(actual),'Triangle count changed'
 bins=collections.defaultdict(list);cell=.001
 def bucket(p):return tuple(math.floor(float(x)/cell) for x in p)
 for i,(role,p,n) in enumerate(expected):bins[(role,bucket(p.mean(axis=0)))].append(i)
 used=set();pe=ne=0.
 for role,p,n in actual:
  center=bucket(p.mean(axis=0));matches=[]
  for delta in itertools.product((-1,0,1),repeat=3):
   for i in bins[(role,tuple(a+b for a,b in zip(center,delta)))]:
    if i in used:continue
    _,q,m=expected[i]
    for shift in range(3):
     error=float(np.max(np.abs(p-np.roll(q,shift,axis=0))))
     if error<8e-6:matches.append((error,float(np.max(np.abs(n-np.roll(m,shift,axis=0)))),i))
  assert matches,('Triangle/material/winding mismatch',role,p.tolist())
  e,f,i=min(matches)
  if normals:assert f<2e-4,('Corner normals changed',role,f)
  used.add(i);pe=max(pe,e);ne=max(ne,f)
 return {'triangles':len(actual),'max_position_error':pe,'max_corner_normal_error':ne}

def mapped(records):
 return [(role,np.array([list(AXES @ Vector(p)) for p in ps]),np.array([list(AXES.to_3x3() @ Vector(n)) for n in ns])) for role,ps,ns in records]

def inspect(doc, binary, expected, values):
 assert doc['asset']['version']=='2.0'
 assert len(doc.get('nodes',[]))==len(doc.get('meshes',[]))==len(expected),'Unexpected object scope'
 assert {n['name'] for n in doc['nodes']}==expected.keys(),'Unexpected object names'
 assert len(doc['scenes'])==1 and sorted(doc['scenes'][0]['nodes'])==list(range(len(expected)))
 assert set(doc.get('extensionsUsed',[]))<= {'KHR_materials_emissive_strength'} and not doc.get('extensionsRequired')
 for key in ('cameras','skins','animations','images','textures','samplers'):assert not doc.get(key),('Unexpected payload',key)
 assert len(doc['buffers'])==1 and 'uri' not in doc['buffers'][0]
 assert {m['name'] for m in doc['materials']}==values.keys() and len(doc['materials'])==len(values),'Material roles changed'
 for m in doc['materials']:
  v=values[m['name']];pbr=m.get('pbrMetallicRoughness',{})
  assert np.allclose(pbr.get('baseColorFactor',[1,1,1,1]),v['base'],atol=1e-7,rtol=0),('Base changed',m['name'],pbr,v)
  assert abs(pbr.get('metallicFactor',1)-v['metallic'])<1e-7
  assert abs(pbr.get('roughnessFactor',1)-v['roughness'])<1e-7
  assert m.get('doubleSided',False)==v['double_sided'] and m.get('alphaMode','OPAQUE')=='OPAQUE'
  strength=m.get('extensions',{}).get('KHR_materials_emissive_strength',{}).get('emissiveStrength',1)
  assert np.allclose(np.array(m.get('emissiveFactor',[0,0,0]))*strength,np.array(v['emission'])*v['strength'],atol=5e-7,rtol=0),'Emission changed'
 all_records=[];meshes={};vertices=primitives=0
 for node in doc['nodes']:
  assert set(node)<={'name','mesh','translation','rotation','scale'}
  assert np.allclose(node.get('scale',[1,1,1]),[1,1,1],atol=1e-7),'Scale changed'
  r=node.get('rotation',[0,0,0,1]);matrix=Matrix.Translation(Vector(node.get('translation',[0,0,0]))) @ Quaternion((r[3],*r[:3])).to_matrix().to_4x4()
  expect_matrix=AXES @ expected[node['name']]['matrix'] @ AXES.inverted()
  assert np.allclose(matrix,expect_matrix,atol=3e-6,rtol=0),'Local origin/rotation changed'
  records=[]
  for p in doc['meshes'][node['mesh']]['primitives']:
   assert p.get('mode',4)==4 and set(p['attributes'])=={'POSITION','NORMAL'}
   assert not p.get('extensions') and not p.get('targets')
   ps=accessor(doc,binary,p['attributes']['POSITION']);ns=accessor(doc,binary,p['attributes']['NORMAL']);ix=accessor(doc,binary,p['indices']).reshape(-1)
   assert len(ix)%3==0 and int(ix.max())<len(ps) and len(ps)==len(ns)
   assert np.max(np.abs(np.linalg.norm(ns,axis=1)-1))<2e-5,'Non-unit normals'
   ps=np.array([list(matrix @ Vector(v)) for v in ps]);ns=np.array([list(matrix.to_3x3() @ Vector(v)) for v in ns])
   role=doc['materials'][p['material']]['name']
   records.extend((role,ps[t],ns[t]) for t in ix.reshape((-1,3)))
   vertices+=len(ps);primitives+=1
  source=mapped(expected[node['name']]['triangles']);comparison=compare_triangles(source,records)
  def zero(ts):return sum(np.linalg.norm(np.cross(p[1]-p[0],p[2]-p[0]))<=1e-10 for _,p,n in ts)
  assert zero(source)==zero(records),'New degenerate triangles'
  meshes[node['name']]={**comparison,'inherited_near_zero_area_triangles':int(zero(source)),
   'triangles_by_role':dict(collections.Counter(t[0] for t in records)),
   'source_type':expected[node['name']]['source_type'],'source_evaluated_vertices':expected[node['name']]['vertices'],
   'source_modifiers':expected[node['name']]['modifiers'],'origin_gltf':list(matrix.translation)}
  all_records.extend(records)
 return {'nodes':len(expected),'triangles':len(all_records),'primitives':primitives,
  'decoded_primitive_vertices':vertices,'bounds_gltf':bounds(all_records),'meshes':meshes,
  'material_roles':values,'extensions':doc.get('extensionsUsed',[])}

def negative_tests(doc,binary,expected,values,package,existing):
 result={}
 tests=[('extra_reference',lambda d:d['nodes'].append({'name':'Studio ground'})),
        ('role_loss',lambda d:d['materials'][0].update(name='Wrong role')),
        ('origin_drift',lambda d:d['nodes'][0].update(translation=[.125,0,0])),
        ('negative_scale',lambda d:d['nodes'][0].update(scale=[-1,1,1])),
        ('base_change',lambda d:d['materials'][0].setdefault('pbrMetallicRoughness',{}).update(baseColorFactor=[.9,.9,.9,1])),
        ('compression',lambda d:d.update(extensionsUsed=['KHR_draco_mesh_compression']))]
 for name,mutate in tests:
  bad=copy.deepcopy(doc);mutate(bad)
  try:inspect(bad,binary,expected,values)
  except AssertionError:result[name+'_rejected']=True
  else:raise AssertionError('Negative test accepted '+name)
 if 'Lane 1 | substantial continuous profiled border' in expected:
  bad=copy.deepcopy(doc);bad['nodes'].append({'name':'Timing | thin transverse light rule'})
  try:inspect(bad,binary,expected,values)
  except AssertionError:result['restored_false_timing_cue_rejected']=True
  else:raise AssertionError('Restored timing cue accepted')
  for role in ('Slot border | cyan 75 lane 25 gold','Gold | brushed warm alloy'):
   bad=copy.deepcopy(doc)
   material=next(m for m in bad['materials'] if m['name']==role)
   material['pbrMetallicRoughness']['baseColorFactor']=[.1,.1,.1,1]
   try:inspect(bad,binary,expected,values)
   except AssertionError:result[role+'_retint_rejected']=True
   else:raise AssertionError('Incorrect slot/shared-gold tint accepted')
  bad=copy.deepcopy(doc);bad['nodes']=[n for n in bad['nodes'] if n['name']!='Hit bar 1 | flush machined gold bezel']
  try:inspect(bad,binary,expected,values)
  except AssertionError:result['missing_real_hit_bezel_rejected']=True
  else:raise AssertionError('Missing actual hit bezel accepted')
 records=next(iter(expected.values()))['triangles'];bad=list(records);role,p,n=bad[0];bad[0]=(role,p,-n)
 try:compare_triangles(records,bad)
 except AssertionError:result['flipped_normals_rejected']=True
 else:raise AssertionError('Flipped normals accepted')
 for name,p in [('existing',existing),('source',AUTHORING/'forbidden.glb'),('outside',Path('/tmp/forbidden-structure.glb')),('nested',package/'validation/forbidden.glb')]:
  try:new_output(p,package,'.glb')
  except (ValueError,FileExistsError):result[name+'_output_rejected']=True
  else:raise AssertionError('Unsafe output accepted '+name)
 return result

def export_main(kind,package):
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--source',type=Path)
 args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=new_output(args.output,package,'.glb');report=new_output(args.report,package,'.json')
 source,objects,expected,values=load(kind,args.source);before=sha(source);prepare(objects,values)
 converted=snapshot(objects)
 for name in expected:compare_triangles(expected[name]['triangles'],converted[name]['triangles'])
 work=Path(tempfile.mkdtemp(prefix='structural-export-',dir='/tmp/opencode'))
 try:
  temp=work/'asset.glb';print('GLB EXPORT ATTEMPT',kind,temp,flush=True)
  assert bpy.ops.export_scene.gltf(filepath=str(temp),**SETTINGS)=={'FINISHED'} and temp.stat().st_size>0
  print('GLB EXPORT SUCCESS; EXACT TRANSFER CHECK ATTEMPT',flush=True)
  result=inspect(*read_glb(temp),expected,values)
  assert sha(source)==before
  evidence={'pass':True,'kind':kind,'blender':bpy.app.version_string,'exporter':io_scene_gltf2.get_version_string(),
   'source':SOURCES['framing' if kind in ('long','short','post') else kind][0],'source_sha256':before,
   'glb_sha256':sha(temp),'transfer_bytes':temp.stat().st_size,'geometry_simplified':False,'glb':result,
   'settings':SETTINGS,'negative_tests':negative_tests(*read_glb(temp),expected,values,package,temp),
   'limitations':['Provisional authoring units, not approved meters.','No official Khronos validator run.',
    'Unsupported platform mineral noise uses the authored constant base/roughness; no texture bake.',
    'Pure platform emission uses black-base Principled emission; portable intensity preserved, runtime appearance pending.',
    'Inherited near-zero-area triangles, if any, are measured per mesh and preserved.','Browser review/appearance/performance and integration approval belong to the parent lane.']}
  print('TRANSFER CHECK SUCCESS; EXCLUSIVE COPY ATTEMPT',out,flush=True)
  with out.open('xb') as d,temp.open('rb') as s:shutil.copyfileobj(s,d)
  assert sha(out)==evidence['glb_sha256']
  with report.open('x') as f:json.dump(evidence,f,indent=2);f.write('\n')
  print('EXPORT COPY SUCCESS',out,flush=True)
 except BaseException:
  print('EXPORT FAILED; owned scratch retained',work,flush=True);raise
 else:shutil.rmtree(work)
 finally:assert sha(source)==before,'Source changed'

def validate_main(kind,package):
 p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--source',type=Path);p.add_argument('--compare',type=Path);p.add_argument('--negative-test',action='store_true')
 args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=new_output(args.report,package,'.json')
 source,objects,expected,values=load(kind,args.source);before=sha(source);artifact=sha(args.input)
 print('GLB VALIDATION ATTEMPT',args.input,flush=True);result=inspect(*read_glb(args.input),expected,values)
 report={'pass':True,'kind':kind,'glb_sha256':artifact,'source_sha256':before,'glb':result}
 if args.compare:
  assert args.input.read_bytes()==args.compare.read_bytes(),'Independent export bytes differ'
  report['independent_reproduction_byte_identical']=True
 if args.negative_test:
  report['negative_tests']=negative_tests(*read_glb(args.input),expected,values,package,args.input)
  with tempfile.TemporaryDirectory(prefix='structural-source-guard-',dir='/tmp/opencode') as work:
   bad=Path(work)/'wrong-source.blend';payload=bytearray(source.read_bytes());payload[-1]^=1;bad.write_bytes(payload)
   try:load(kind,bad)
   except AssertionError as e:
    assert 'Source checksum mismatch' in str(e);report['negative_tests']['changed_source_rejected']=True
   else:raise AssertionError('Corrupt source accepted')
 bpy.ops.wm.read_factory_settings(use_empty=True)
 print('GLB REIMPORT ATTEMPT',args.input,flush=True)
 assert bpy.ops.import_scene.gltf(filepath=str(args.input),import_shading='NORMALS',merge_vertices=False)=={'FINISHED'}
 bpy.context.view_layer.update();reimport=snapshot(bpy.context.scene.objects)
 assert expected.keys()==reimport.keys() and all(o.type=='MESH' for o in bpy.context.scene.objects)
 report['reimport']={name:compare_triangles(expected[name]['triangles'],reimport[name]['triangles'],normals=False) for name in expected}
 assert sha(source)==before and sha(args.input)==artifact
 with out.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
 print('VALIDATION/REIMPORT SUCCESS',out,flush=True)
