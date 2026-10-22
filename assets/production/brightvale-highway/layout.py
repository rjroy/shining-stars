"""Extract shared playfield, framing, city and camera data; never save Blender."""
import argparse, ast, json, math, sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
import numpy as np
from mathutils import Matrix, Vector
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'brightvale-platform'))
import structural as S
PACKAGE=Path(__file__).resolve().parent

def matrix(m):
 t,r,s=m.decompose()
 return {'translation':list(t),'quaternion_xyzw':[r.x,r.y,r.z,r.w],'scale':list(s),
         'matrix_column_major':[float(m[row][col]) for col in range(4) for row in range(4)]}

def transform(o):
 return {'blender_matrix_rows':[list(r) for r in o.matrix_world],
         'gltf':matrix(S.AXES @ o.matrix_world @ S.AXES.inverted())}

def material(m):
 bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 return {'name':m.name,'base_color_linear':list(bs.inputs['Base Color'].default_value),
         'metallic':bs.inputs['Metallic'].default_value,'roughness':bs.inputs['Roughness'].default_value,
         'double_sided':not m.use_backface_culling}

def extract(source):
 assert S.sha(source)==S.SOURCES['highway'][1],'Study checksum mismatch'
 bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.view_layer.update();scene=bpy.context.scene
 group=bpy.data.objects['COMPOSITION.Playfield.ForegroundPivot']
 assert abs(group.rotation_euler.x-math.radians(14))<1e-7
 roots=[]
 for o in sorted(scene.objects,key=lambda o:o.name):
  if o.name.startswith('framing-arch.') and o.type=='EMPTY':
   role=o['arc_role'];roots.append({'name':o.name,'asset':'framing','module':'long' if role=='section' else 'post',
    'file':'brightvale-outer-framing/'+('long' if role=='section' else 'post')+'.glb',
    'index':int(o['arc_index']),'components':len(o.children),**transform(o)})
 assert sum(r['module']=='long' for r in roots)==26 and sum(r['module']=='post' for r in roots)==27
 assert all(r['components']==(3 if r['module']=='post' else 1) for r in roots)
 city=next(o for o in scene.objects if o.get('source_object')=='CITY.ProvisionalLayout')
 planes=[]
 for name in ('Review.Ground','Review.LocalGround.Circle'):
  o=bpy.data.objects[name];o.data.calc_loop_triangles()
  planes.append({'name':name,**transform(o),
    'positions_local_gltf':[list(S.AXES @ v.co) for v in o.data.vertices],
    'triangle_indices':[list(t.vertices) for t in o.data.loop_triangles],
    'material':material(o.data.materials[0]),'single_surface':True,'solid_support_claim':False})
 camera=scene.camera;cm=S.AXES @ camera.matrix_world
 aspect=scene.render.resolution_x*scene.render.pixel_aspect_x/(scene.render.resolution_y*scene.render.pixel_aspect_y)
 assert camera.data.sensor_fit=='AUTO' and aspect>1 and camera.data.type=='PERSP'
 hfov=2*math.atan(camera.data.sensor_width/(2*camera.data.lens));vfov=2*math.atan(math.tan(hfov/2)/aspect)
 p=cm.translation;forward=cm.to_3x3() @ Vector((0,0,-1));up=cm.to_3x3() @ Vector((0,1,0))
 lights=[]
 for o in sorted(scene.objects,key=lambda o:o.name):
  if o.type!='LIGHT':continue
  lm=S.AXES @ o.matrix_world
  lights.append({'name':o.name,'type':o.data.type,'transform_gltf_camera_basis':matrix(lm),
   'position_gltf':list(lm.translation),'direction_gltf':list(lm.to_3x3() @ Vector((0,0,-1))),
   'color_linear':list(o.data.color),'blender_energy':o.data.energy,
   'size':o.data.size if o.data.type=='AREA' else None,
   'shape':o.data.shape if o.data.type=='AREA' else None,
   'angle_radians':o.data.angle if o.data.type=='SUN' else None})
 assert len(lights)==4
 # Read constant presets as DATA; no authoring script is imported or executed.
 presets_path=source.parent/'assemble.py';tree=ast.parse(presets_path.read_text())
 modes=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='MODES' for t in n.targets))
 result={'schema':'brightvale-structure-layout-v1','source':'../authoring/brightvale-scene-review/scene-review.blend',
  'source_sha256':S.sha(source),'units':'provisional authoring units; NOT approved meters',
  'axis_mapping':'Blender (x,y,z) -> glTF/Three (x,z,-y). Loaded GLB is already Y-up; no second axis conversion.',
  'matrix_contract':'gltf.matrix_column_major is Matrix4.fromArray compatible. Transform the LOADED glTF scene as a whole; preserve all internal node origins. No automatic recentering.',
  'playfield':{'source_root':group.name,'tilt_degrees':14,'source_rotation_pivot_blender':[0,-2.8,-.65],
   'assets':['brightvale-platform/platform.glb','brightvale-highway/highway.glb','brightvale-platform-endcaps/endcaps.glb'],
   'root_mapping':'Apply this SAME matrix to each whole loaded GLB, or one common parent. Highway asset retains original local Y 2.7 origin; do NOT translate it again.',**transform(group)},
  'city':{'source_root':city.name,**transform(city),
    'root_mapping':'Study source-layout root mapping only. City production lane owns derived-local-origin/instance contracts; do not apply its root transform twice.'},
  'framing_instances':roots,
  'ground_surfaces':planes,
  'camera':{'name':camera.name,'type':camera.data.type,'lens_mm':camera.data.lens,
   'sensor_width_mm':camera.data.sensor_width,'sensor_fit':camera.data.sensor_fit,
   'aspect':aspect,'horizontal_fov_degrees':math.degrees(hfov),'vertical_fov_degrees':math.degrees(vfov),
   'clip_near':camera.data.clip_start,'clip_far':camera.data.clip_end,
   'position_gltf':list(p),'forward_gltf':list(forward),'up_gltf':list(up),
   'look_at_one_unit_gltf':list(p+forward),'transform_gltf_camera_basis':matrix(cm),
   'resolution':[scene.render.resolution_x,scene.render.resolution_y],
   'shift':[camera.data.shift_x,camera.data.shift_y]},
  'lights':lights,'lighting_presets':modes,'lighting_presets_source_sha256':S.sha(presets_path),
  'lighting_limit':'Blender AREA wattage/world strength/AgX are not Three.js intensity/tone-map equivalents. These data describe the study, not a browser shader/lighting implementation.',
  'world_saved':{'color_linear':list(scene.world.node_tree.nodes['Background'].inputs['Color'].default_value),
   'strength':scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value},
  'render_reference':{'engine':scene.render.engine,'samples':scene.cycles.samples,'denoise':scene.cycles.use_denoising,
   'view_transform':scene.view_settings.view_transform,'look':scene.view_settings.look,'exposure':scene.view_settings.exposure},
  'evidence':['../authoring/brightvale-scene-review/preview-audience.webp','../authoring/brightvale-scene-review/preview-twilight.webp'],
  'browser_runtime_approval':'PENDING; combined browser end review by parent/designer'}
 # Literal authoring presets contain tuples. Compare their serialized pure-data
 # form, so validation of an existing JSON is as strict as fresh extraction.
 return json.loads(json.dumps(result))

def check(data,reference):
 assert data==reference,'Layout differs from exact saved study data'
 for r in data['framing_instances']:
  assert min(r['gltf']['scale'])>0 and r['components']==(3 if r['module']=='post' else 1)
 return True

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path);p.add_argument('--input',type=Path)
 p.add_argument('--report',type=Path,required=True);p.add_argument('--source',type=Path,default=S.AUTHORING/S.SOURCES['highway'][0]);p.add_argument('--negative-test',action='store_true')
 args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);report=S.new_output(args.report,PACKAGE,'.json')
 if bool(args.output)==bool(args.input):raise ValueError('Use output (extract) OR input (validate)')
 if args.output:
  out=args.output.resolve()
  if out != PACKAGE.parent/'brightvale-structure-layout.json':out=S.new_output(out,PACKAGE,'.json')
  elif out.exists():raise FileExistsError(out)
 reference=extract(args.source);before=S.sha(args.source)
 data=json.loads(args.input.read_text()) if args.input else reference
 check(data,reference);results={}
 if args.negative_test:
  import copy
  for name,mutate in [('tilt_loss',lambda d:d['playfield'].update(tilt_degrees=0)),
   ('post_component_loss',lambda d:d['framing_instances'][0].update(components=1)),
   ('ground_level_change',lambda d:d['ground_surfaces'][0]['positions_local_gltf'][0].__setitem__(1,0)),
   ('camera_change',lambda d:d['camera'].update(vertical_fov_degrees=60)),
   ('missing_section',lambda d:d['framing_instances'].pop())]:
   bad=copy.deepcopy(data);mutate(bad)
   try:check(bad,reference)
   except AssertionError:results[name+'_rejected']=True
   else:raise AssertionError('Bad layout accepted '+name)
 if args.output:
  with out.open('x') as f:json.dump(data,f,indent=2);f.write('\n')
 assert S.sha(args.source)==before
 report_data={'pass':True,'source_sha256':before,'section_count':26,'complete_post_count':27,
  'negative_tests':results}
 with report.open('x') as f:
  json.dump(report_data,f,indent=2);f.write('\n')
 print('LAYOUT EXACT EXTRACTION/VALIDATION SUCCESS',flush=True)

if __name__=='__main__':main()
