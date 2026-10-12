"""Read-only joins and exact current-study reconstruction from exported artifacts.

Includes the EXISTING endcaps artifact, never re-exports or changes it. Tests
assembled wall solids, not just matching bounding boxes or idealized proxies.
"""
import argparse, copy, json, math, sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'brightvale-platform'))
import structural as S
PACKAGE=Path(__file__).resolve().parent

def import_snapshot(path):
 bpy.ops.wm.read_factory_settings(use_empty=True)
 assert bpy.ops.import_scene.gltf(filepath=str(path),import_shading='NORMALS',merge_vertices=False)=={'FINISHED'}
 bpy.context.view_layer.update()
 return S.snapshot(bpy.context.scene.objects)

def transformed(records,m):
 normal=m.to_3x3().inverted().transposed()
 return [(role,np.array([list(m @ Vector(v)) for v in ps]),
   np.array([list((normal @ Vector(v)).normalized()) for v in ns])) for role,ps,ns in records]

def find(data,text):return next(v['triangles'] for k,v in data.items() if text in k)

def tree(records):
 points=[Vector(p) for role,ps,ns in records for p in ps]
 return BVHTree.FromPolygons(points,[list(range(i,i+3)) for i in range(0,len(points),3)],all_triangles=True)

def ray(t,x,y,up=False):
 hit,normal,index,distance=t.ray_cast(Vector((x,y,-2 if up else 3)),Vector((0,0,1 if up else -1)),10)
 return hit.z if hit else None

def joins(platform,highway,caps):
 pc=S.bounds(find(platform,'continuous sculpted chassis'));hc=S.bounds(find(highway,'four-channel profiled chassis'))
 assert abs(hc['min'][1]-pc['max'][1])<2e-6,'Chassis junction gap'
 assert abs(hc['max'][1]-44.7)<2e-6,'Not 42-unit highway'
 pt=[tree(v['triangles']) for v in platform.values()];clearances=[];lanes=[]
 for i,cx in enumerate((-4.5,-1.5,1.5,4.5),1):
  panel=S.bounds(find(platform,f'Inset lane {i} |'));bed=find(highway,f'lane {i} | continuous inset bed');b=S.bounds(bed)
  assert abs((b['max'][0]+b['min'][0])/2-cx)<1e-6,'Lane center mismatch'
  assert abs(b['dimensions'][0]-panel['dimensions'][0])<1e-6,'Lane width mismatch'
  bt=tree(bed);frame=S.bounds(find(platform,f'Lane {i} | substantial continuous profiled border'))
  travel=ray(bt,cx,4);nose=ray(bt,cx,2.54);under=ray(bt,cx,2.54,True)
  assert abs(travel-.44)<2e-5 and abs(nose-.502)<2e-5 and abs(under-.492)<2e-5
  assert abs(under-frame['max'][2]-.002)<2e-5,'Lost frame clearance'
  assert abs(nose-frame['max'][2]-.012)<2e-5,'Lost terminal step'
  for x in (cx-1.30,cx,cx+1.30):
   for y in (2.54,2.56,2.58,2.60,2.64,2.68,2.699):
    bottom=ray(bt,x,y,True);assert bottom is not None
    surfaces=[h for t in pt if (h:=ray(t,x,y)) is not None]
    if surfaces:
     gap=bottom-max(surfaces);assert gap>=.0017,'Junction intersects platform';clearances.append(gap)
  lanes.append({'index':i-1,'center':cx,'width':b['dimensions'][0],'travel_top':travel,
   'terminal_top':nose,'terminal_under':under,'nominal_clearance':under-frame['max'][2]})
 for side in ('left','right'):
  cb=S.bounds(find(caps,'Endcap | '+side+' |'))
  assert abs(cb['max'][1]-hc['min'][1])<2e-6,'Endcap rear mismatch'
  assert abs((cb['max'][0] if side=='left' else cb['min'][0])-(-6 if side=='left' else 6))<1e-6
 for name,v in highway.items():
  b=S.bounds(v['triangles'])
  assert b['min'][0]>=-6.000001 and b['max'][0]<=6.000001,'Road overlaps outside caps'
  if b['min'][1]<2.699999:assert b['min'][0]>=-5.875001 and b['max'][0]<=5.875001,'Nose lacks cap clearance'
 return {'lanes':lanes,'chassis_gap':hc['min'][1]-pc['max'][1],
   'sampled_junction_min_clearance':min(clearances),'sampled_junction_clearance_count':len(clearances),
   'endcap_boundary_contact_only':True,'outer_nose_lateral_clearance':.125}

def inside(t,point,inverse):
 # Evaluate parity in each original module's local space. A common world ray
 # can graze a rotated wall's triangulated bevel/stone reveals.
 direction=Vector((.013,1,0)).normalized();start=inverse @ point;count=0
 for _ in range(40):
  hit,normal,index,distance=t.ray_cast(start,direction,100)
  if hit is None:return count%2==1
  count+=1;start=hit+direction*.00001
 raise AssertionError('Wall parity overflow')

def framing(data,long,post):
 roots=data['framing_instances'];posts=sorted((r for r in roots if r['module']=='post'),key=lambda r:r['index'])
 sections=sorted((r for r in roots if r['module']=='long'),key=lambda r:r['index'])
 assert len(posts)==27 and len(sections)==26 and len(post)==3
 assert {k.split('.')[0] for k in post}=={'Framing | post stone pier','Framing | post warm metal bezel','Framing | post inset amber lens'}
 radius=3.26/(2*math.sin(math.pi/52));center=Vector((0,20,8.25));samples=0;residual=[]
 for i,p in enumerate(posts):
  m=Matrix(p['blender_matrix_rows']);radial=m.translation-center;residual.append(abs(radial.length-radius))
  assert residual[-1]<1e-5 and abs(radial.z)<1e-6,'Not circular'
  assert abs(math.atan2(radial.y,radial.x)-i*math.pi/26)<1e-6,'Not semicircle'
  assert (m.to_3x3() @ Vector((0,-1,0))).dot(-radial.normalized())>.99999,'Lens not inward'
 for i,s in enumerate(sections):
  m=Matrix(s['blender_matrix_rows']);a=Vector(posts[i]['blender_matrix_rows'][j][3] for j in range(3));b=Vector(posts[i+1]['blender_matrix_rows'][j][3] for j in range(3))
  assert (m.translation-(a+b)/2).length<1e-5,'Wrong section chord'
  assert abs((a-b).length-3.26)<1e-5,'Wrong pitch'
  direction=m.to_3x3() @ Vector((1,0,0));normal=m.to_3x3() @ Vector((0,1,0))
  wt=tree(find(long,'long masonry'));wi=m.inverted()
  for p,sign in ((posts[i],1),(posts[i+1],-1)):
   pt=tree(find(post,'stone pier'));pi=Matrix(p['blender_matrix_rows']).inverted()
   joint=m.translation+sign*1.4*direction
   for along in (-.24,-.12,-.06,0,.04):
    for across in (-.22,-.11,0,.11,.22):
     for height in (.20,.40,.75,.95):
      point=joint+sign*along*direction+across*normal+Vector((0,0,height))
      assert inside(wt,point,wi) or inside(pt,point,pi),('Open section-post joint',i,sign,along,across,height)
      samples+=1
 return {'sections':26,'complete_posts':27,'actual_exported_solid_joint_samples':samples,
  'maximum_radius_residual':max(residual),'nominal_body_overlap_each_joint':.12}

def main():
 p=argparse.ArgumentParser();p.add_argument('--report',type=Path,required=True);p.add_argument('--production-root',type=Path,default=PACKAGE.parent)
 p.add_argument('--layout',type=Path,default=PACKAGE.parent/'brightvale-structure-layout.json');p.add_argument('--source',type=Path,default=S.AUTHORING/S.SOURCES['highway'][0]);p.add_argument('--negative-test',action='store_true')
 args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=S.new_output(args.report,PACKAGE,'.json')
 source=args.source.resolve();assert S.sha(source)==S.SOURCES['highway'][1];before=S.sha(source)
 bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.view_layer.update()
 originals=[o for o in bpy.context.scene.objects if o.get('review_asset') in ('platform','highway','endcaps','framing') and o.type in ('MESH','CURVE')]
 expected=S.snapshot(originals);metadata={o.name:(o.get('review_asset'),o.get('source_object'),o.parent.name if o.parent else None) for o in originals}
 data=json.loads(args.layout.read_text());assert data['source_sha256']==before
 root=args.production_root.resolve();paths={'platform':root/'brightvale-platform/platform.glb','highway':root/'brightvale-highway/highway.glb',
  'endcaps':root/'brightvale-platform-endcaps/endcaps.glb','long':root/'brightvale-outer-framing/long.glb','post':root/'brightvale-outer-framing/post.glb'}
 artifact_hashes={k:S.sha(v) for k,v in paths.items()};assets={k:import_snapshot(v) for k,v in paths.items()}
 join=joins(assets['platform'],assets['highway'],assets['endcaps']);arc=framing(data,assets['long'],assets['post'])
 pm=Matrix(data['playfield']['blender_matrix_rows']);roots={r['name']:r for r in data['framing_instances']};comparison={}
 for name,v in expected.items():
  asset,source_object,parent=metadata[name]
  if asset=='framing':
   r=roots[parent];prototype=assets['post' if r['module']=='post' else 'long']
   role=next(k for k in prototype if k in source_object)
   records=transformed(prototype[role]['triangles'],Matrix(r['blender_matrix_rows']))
  else:records=transformed(assets[asset][source_object]['triangles'],pm)
  source_records=v['triangles']
  if asset=='framing':
   # Study replacement appended a second copy of the same original material
   # datablocks. The .001 suffix is a Blender collision name, not a new role.
   source_records=[(role.removesuffix('.001'),p,n) for role,p,n in source_records]
  comparison[name]=S.compare_triangles(source_records,records,normals=False)
 negative={}
 if args.negative_test:
  bad=copy.deepcopy(assets['highway']);k=next(k for k in bad if 'lane 2 | continuous' in k)
  bad[k]['triangles']=transformed(bad[k]['triangles'],Matrix.Translation(Vector((.125,0,0))))
  try:joins(assets['platform'],bad,assets['endcaps'])
  except AssertionError as e:assert 'Lane center mismatch' in str(e);negative['shifted_lane_rejected']=True
  else:raise AssertionError('Shifted lane accepted')
  bad=copy.deepcopy(data);r=next(r for r in bad['framing_instances'] if r['module']=='long' and r['index']==13);r['blender_matrix_rows'][0][3]+=.6
  try:framing(bad,assets['long'],assets['post'])
  except AssertionError:negative['shifted_section_rejected']=True
  else:raise AssertionError('Shifted section accepted')
  bad=copy.deepcopy(assets['long']);k=next(iter(bad))
  bad[k]['triangles']=transformed(bad[k]['triangles'],Matrix.Translation(Vector((.6,0,0))))
  try:framing(data,bad,assets['post'])
  except AssertionError as e:
   assert 'Open section-post joint' in str(e);negative['actual_solid_joint_gap_rejected']=True
  else:raise AssertionError('Open solid joint accepted')
  bad=copy.deepcopy(assets['post']);del bad[next(k for k in bad if 'bezel' in k)]
  try:framing(data,assets['long'],bad)
  except AssertionError:negative['missing_post_bezel_rejected']=True
  else:raise AssertionError('Incomplete post accepted')
 assert S.sha(source)==before and {k:S.sha(v) for k,v in paths.items()}==artifact_hashes
 with out.open('x') as f:json.dump({'pass':True,'source_sha256':before,'artifact_hashes':artifact_hashes,
  'joins':join,'framing':arc,'study_object_geometry_matches':len(comparison),
  'study_assembled_triangle_matches':sum(v['triangles'] for v in comparison.values()),
  'max_study_assembled_position_error':max(v['max_position_error'] for v in comparison.values()),
  'negative_tests':negative,'study_framing_material_collision_suffix_normalized':'.001',
  'limitations':['Blender importer normal reconstruction is not exact; strict original-normal checks apply to GLB directly in per-package validators.',
   'Intentional inlay embedding retained; no exhaustive self-intersection or physical support/collision claim.','No browser/game integration.']},f,indent=2);f.write('\n')
 print('EXPORTED ASSEMBLY EXACT STUDY / JOINS / WALL SOLIDS PASS',out,flush=True)

if __name__=='__main__':main()
