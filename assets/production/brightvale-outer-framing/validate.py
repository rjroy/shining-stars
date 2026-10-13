from pathlib import Path
import sys
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'brightvale-platform'))
import structural as S
from structural import validate_main

def validate_all(package):
 import argparse,json
 p=argparse.ArgumentParser();p.add_argument('--report',type=Path,required=True)
 p.add_argument('--input-dir',type=Path,default=package);p.add_argument('--source',type=Path)
 p.add_argument('--negative-test',action='store_true')
 args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=S.new_output(args.report,package,'.json');result={};materials={}
 for kind in ('long','short','post'):
  source,objects,expected,values=S.load(kind,args.source);before=S.sha(source)
  artifact=args.input_dir/(kind+'.glb');doc,binary=S.read_glb(artifact);g=S.inspect(doc,binary,expected,values)
  result[kind]={'sha256':S.sha(artifact),'bytes':artifact.stat().st_size,'nodes':g['nodes'],'triangles':g['triangles'],
   'primitives':g['primitives'],'bounds_gltf':g['bounds_gltf'],
   'components':list(g['meshes']),'max_position_error':max(m['max_position_error'] for m in g['meshes'].values()),
   'max_normal_error':max(m['max_corner_normal_error'] for m in g['meshes'].values()),
   'inherited_near_zero_area_triangles':sum(m['inherited_near_zero_area_triangles'] for m in g['meshes'].values())}
  if args.negative_test:result[kind]['negative_tests']=S.negative_tests(doc,binary,expected,values,package,artifact)
  materials.update(values);assert S.sha(source)==before
 with out.open('x') as f:json.dump({'pass':True,'source_sha256':before,'blender':'5.2.1 LTS','exporter':'5.2.40',
  'modules':result,'material_roles':materials,'geometry_simplified':False,
  'assembly_and_relocated_proof':'../brightvale-platform/verification.json',
  'browser_runtime_approval':'PENDING; parent/designer combined review'},f,indent=2);f.write('\n')
 print('ALL REUSABLE FRAMING MODULES PASS',out,flush=True)
if __name__=='__main__':
 i=sys.argv.index('--kind');kind=sys.argv[i+1];del sys.argv[i:i+2]
 assert kind in ('long','short','post','all')
 if kind=='all':validate_all(Path(__file__).resolve().parent)
 else:validate_main(kind,Path(__file__).resolve().parent)
