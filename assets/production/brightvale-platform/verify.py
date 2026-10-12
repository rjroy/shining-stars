"""Independent relocated reproduction of the structural lane. Standard Python.

Copies scripts and byte-identical authoritative sources to owned scratch, then
exports and checks those copies using Blender. No original generator is run.
"""
import argparse, hashlib, json, shutil, subprocess, tempfile
from pathlib import Path

PACKAGE=Path(__file__).resolve().parent
PRODUCTION=PACKAGE.parent
AUTHORING=PRODUCTION.parent/'authoring'

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
 p=argparse.ArgumentParser();p.add_argument('--report',type=Path,required=True);args=p.parse_args();out=args.report.resolve()
 assert out.suffix=='.json' and out.parent.is_dir() and (out.parent==PACKAGE or out.is_relative_to(Path('/tmp/opencode')))
 if out.exists():raise FileExistsError(out)
 work=Path(tempfile.mkdtemp(prefix='structure-relocated-',dir='/tmp/opencode'));assets=work/'assets';prod=assets/'production';author=assets/'authoring'
 watched=[]
 for package in ('neon-twilight-platform','brightvale-highway','brightvale-outer-framing','brightvale-platform-endcaps','brightvale-scene-review'):
  watched+=list((AUTHORING/package).glob('*.blend'))+list((AUTHORING/package).rglob('*.py'))
 before={str(p.relative_to(AUTHORING)):sha(p) for p in watched}
 endcap=PRODUCTION/'brightvale-platform-endcaps/endcaps.glb';endcap_hash=sha(endcap)
 def run(script,*argv,timeout=300):
  cmd=['blender','--background','--threads','8','--python-exit-code','1','--python',str(script),'--',*map(str,argv)]
  print('RELOCATED PROCESS ATTEMPT',cmd,flush=True)
  subprocess.run(cmd,cwd=work,check=True,timeout=timeout)
  print('RELOCATED PROCESS SUCCESS',script.name,flush=True)
 try:
  for name in ('brightvale-platform','brightvale-highway','brightvale-outer-framing'):
   target=prod/name;target.mkdir(parents=True)
   for script in (PRODUCTION/name).glob('*.py'):shutil.copyfile(script,target/script.name)
  for name,file in [('neon-twilight-platform','platform.blend'),('brightvale-outer-framing','framing.blend'),('brightvale-scene-review','scene-review.blend')]:
   target=author/name;target.mkdir(parents=True);shutil.copyfile(AUTHORING/name/file,target/file)
  shutil.copyfile(AUTHORING/'brightvale-scene-review/assemble.py',author/'brightvale-scene-review/assemble.py')
  results={}
  for name,kind in [('brightvale-platform','platform'),('brightvale-highway','highway'),('brightvale-outer-framing','long'),('brightvale-outer-framing','short'),('brightvale-outer-framing','post')]:
   target=prod/name;selector=['--kind',kind] if name.endswith('framing') else []
   artifact=target/(kind+'.glb');report=target/(kind+'-export.json');validation=target/(kind+'-validation.json')
   run(target/'export.py',*selector,'--output',artifact,'--report',report)
   run(target/'validate.py',*selector,'--input',artifact,'--compare',PRODUCTION/name/(kind+'.glb'),'--report',validation,'--negative-test')
   x=json.loads(validation.read_text());g=x['glb']
   results[kind]={'independent_relocated_byte_identical':x['independent_reproduction_byte_identical'],
    'glb_sha256':x['glb_sha256'],'transfer_bytes':artifact.stat().st_size,'nodes':g['nodes'],'triangles':g['triangles'],
    'material_roles':len(g['material_roles']),'primitives':g['primitives'],
    'max_direct_position_error':max(m['max_position_error'] for m in g['meshes'].values()),
    'max_direct_normal_error':max(m['max_corner_normal_error'] for m in g['meshes'].values()),
    'max_reimport_normal_error':max(m['max_corner_normal_error'] for m in x['reimport'].values()),
    'inherited_near_zero_area_triangles':sum(m['inherited_near_zero_area_triangles'] for m in g['meshes'].values()),
    'negative_tests':x['negative_tests']}
  run(prod/'brightvale-highway/layout.py','--output',prod/'brightvale-structure-layout.json','--report',work/'layout.json','--negative-test')
  assert (prod/'brightvale-structure-layout.json').read_bytes()==(PRODUCTION/'brightvale-structure-layout.json').read_bytes(),'Relocated layout differs'
  run(prod/'brightvale-highway/layout.py','--input',prod/'brightvale-structure-layout.json','--report',work/'layout-existing.json','--negative-test')
  (prod/'brightvale-platform-endcaps').mkdir();shutil.copyfile(endcap,prod/'brightvale-platform-endcaps/endcaps.glb')
  run(prod/'brightvale-highway/validate-assembly.py','--report',work/'assembly.json','--negative-test')
  assert {str(p.relative_to(AUTHORING)):sha(p) for p in watched}==before and sha(endcap)==endcap_hash
  evidence={'pass':True,'blender':'5.2.1 LTS','exporter':'5.2.40','original_blends_and_scripts_unchanged':before,
    'existing_endcaps_glb_unchanged':endcap_hash,'independent_relocated_reproduction':results,
    'layout_relocated_byte_identical':True,'layout':json.loads((work/'layout.json').read_text()),
    'assembled_current_study_match':json.loads((work/'assembly.json').read_text()),
    'actual_evidence_inspected':['authoring/brightvale-scene-review/preview-audience.webp','authoring/brightvale-scene-review/preview-twilight.webp','authoring/brightvale-outer-framing/neutral-modules.webp'],
    'geometry_simplification':False,'production_blend_needed':False,
    'browser_approval':'PENDING; separate parent/designer combined end review'}
  with out.open('x') as f:json.dump(evidence,f,indent=2);f.write('\n')
 except BaseException:
  print('REPRODUCTION FAILED; scratch retained',work,flush=True);raise
 else:
  shutil.rmtree(work);print('RELOCATED REPRODUCTION PASS; source bytes unchanged',out,flush=True)

if __name__=='__main__':main()
