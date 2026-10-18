"""Exact-surface repartition from retained optimized GLB, using source-range sidecar.

Blender Python supplies installed NumPy; no native evaluation or exporter call.
"""
import argparse,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from glb_checks import sha,read_glb,write_glb,count_scene,check_contract,semantic_hash
from spatial_core import recover_pieces,partition,pack,geometry_digest
source_native=ROOT.parents[1]/'authoring/brightvale-city/city.blend'
p=argparse.ArgumentParser();p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--config',type=Path,required=True);p.add_argument('--optimized',type=Path,required=True);p.add_argument('--batch-coverage',type=Path,required=True);p.add_argument('--full-baseline',type=Path,required=True);args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=args.output_dir.resolve();optimized=args.optimized.resolve();batch_coverage=args.batch_coverage.resolve();full_baseline=args.full_baseline.resolve();target=out/'city-optimized-spatial.glb';assert out.is_dir();assert not target.exists(),'Refusing to overwrite spatial candidate';assert bpy.app.version_string=='5.2.1 LTS'
config=json.loads(args.config.read_text());protected={optimized:config['source_optimized_sha256'],batch_coverage:config['source_batch_coverage_sha256'],full_baseline:config['full_baseline_sha256'],source_native:config['source_native_sha256']}
assert all(sha(path)==value for path,value in protected.items())
doc,binary=read_glb(optimized);check_contract(doc);pieces=recover_pieces(doc,binary,json.loads(batch_coverage.read_text()));assert len(pieces)==6644 and len({p['source_object'] for p in pieces})==5368
print('SPATIAL_PACK_ATTEMPT',len(pieces),config,flush=True);groups=partition(pieces,config['cell_size_BU'],config['max_group_axis_span_BU']);result,payload,coverage=pack(doc,groups);check_contract(result);assert result['materials']==doc['materials'];counts=count_scene(result)
assert counts['placed_triangles']==2589764 and counts['materials']==107 and counts['gpu_instanced_nodes']==0
write_glb(target,result,payload);written,blob=read_glb(target);assert all(sha(path)==value for path,value in protected.items())
manifest=dict(status='Batching-only candidate; actual consumer comparison pending',artifact=target.name,artifact_sha256=sha(target),artifact_bytes=target.stat().st_size,semantic_sha256=semantic_hash(written,blob),source_geometry_sha256=geometry_digest(pieces),config=config,config_sha256=sha(args.config),counts=counts,original_source_objects=5368,recovered_reduced_material_primitives=len(pieces),oversized_original_primitives_isolated=sum(g['oversized_original_piece'] for g in groups),material_map='material-map.json',all_107_materials_exactly_unchanged=True,source_inputs_unchanged=True,blender_version=bpy.app.version_string,method='Read preserved reduced GLB and original source index-range coverage. Regroup only; no native reevaluation, decimation, vertex modification, normal normalization, UV change, triangle splitting, material remapping, game placement bake or axis conversion. Identity Y-up output. Exact bitwise attribute-tuple indexing.',placement='Accepted gameplay .35/(0,3.9,-55), camera/highway/cropping unchanged; Observatory consumer also unchanged.',scope='Offline proxy guided grouping; no measured renderer/performance success claim.')
(out/'spatial-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');(out/'spatial-coverage.json').write_text(json.dumps(coverage,indent=2)+'\n');print('SPATIAL_PACK_OUTCOME',json.dumps(manifest),flush=True)
