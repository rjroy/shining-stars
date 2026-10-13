"""Read-only saved model tests against approved highway.blend and its measured fit.
--compare can select an independently rebuilt saved source. --negative-test
temporarily shifts a lane in memory and requires the alignment invariant to reject it.
Never saves or modifies either approved reference or the loaded highway file.
"""
import argparse, hashlib, json, sys
from pathlib import Path
import bpy, bmesh
from mathutils import Vector
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import (ROOT,PLATFORM,ENDCAPS,CANDIDATE,PLATFORM_REF,ENDCAP_REF,
                   bounds,measure,output_path,sha,source_integrity,lane_profile)

def snapshot(objects):
    result={}; dg=bpy.context.evaluated_depsgraph_get()
    def mat(m):
        tree=m.node_tree
        return {'name':m.name,'diffuse':list(m.diffuse_color),
          'nodes':[[n.name,n.bl_idname,[(i.name,list(i.default_value)
                    if hasattr(i.default_value,'__len__') and not isinstance(i.default_value,str)
                    else i.default_value) for i in n.inputs if hasattr(i,'default_value')]] for n in tree.nodes] if tree else [],
          'links':[[l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name] for l in tree.links] if tree else []}
    for o in objects:
        ev=o.evaluated_get(dg); me=ev.to_mesh()
        value={'matrix':[list(r) for r in o.matrix_world],
               'verts':[list(v.co) for v in me.vertices],
               'faces':[[list(p.vertices),p.material_index,p.use_smooth] for p in me.polygons],
               'materials':[mat(s.material) for s in o.material_slots]}
        result[o.name]=hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
        ev.to_mesh_clear()
    return result

def ray(o,x,y,up=False):
    start=o.matrix_world.inverted()@Vector((x,y,-2 if up else 3))
    hit,loc,normal,index=o.ray_cast(start,Vector((0,0,1 if up else -1)))
    return (float((o.matrix_world@loc).z),list(normal)) if hit else None

def alignment(candidate,platform,length):
    m=measure(platform); chassis=next(o for o in candidate if o.name=='Highway | continuous four-channel profiled chassis')
    b=bounds([chassis]); front=m['chassis']['max'][1]; back=front+length
    assert abs(b['min'][1]-front)<2e-6,('Chassis junction gap',b)
    assert abs(b['max'][1]-back)<2e-6
    assert abs(b['min'][0]+6)<1e-6 and abs(b['max'][0]-6)<1e-6
    results=[]; all_surface_clearances=[]
    for l in m['lanes']:
        i=l['index']; bed=next(o for o in candidate if o.name=='Highway lane %d | continuous inset bed and terminal ramp'%(i+1))
        b=bounds([bed]); cx=(b['min'][0]+b['max'][0])/2
        assert abs(cx-l['x'])<1e-6,('Lane center mismatch',i,cx,l['x'])
        assert bed['lane_index']==i
        assert abs(b['dimensions'][0]-l['width'])<1e-6,('Lane width mismatch',i,b)
        assert abs(b['min'][1]-2.535)<2e-6 and abs(b['max'][1]-back)<2e-6
        # Every base station uses the same left/right coordinates: no perspective taper.
        base_x={round((bed.matrix_world@v.co).x,6) for v in bed.data.vertices}
        assert base_x=={round(l['x']-l['width']/2,6),round(l['x']+l['width']/2,6)}
        top=ray(bed,cx,4.0)
        assert top and abs(top[0]-l['surface_z'])<2e-5 and top[1][2]>.99,('Lane travel height',i,top)
        nose=ray(bed,cx,2.54); underside=ray(bed,cx,2.54,True)
        assert nose and abs(nose[0]-.502)<2e-5
        assert underside and abs(underside[0]-.492)<2e-5
        frame=next(o for o in platform if o.name=='Lane %d | substantial continuous profiled border'%(i+1))
        # Nominal crown clearance and tiny terminal top step, not a fictitious flat join.
        fb=bounds([frame]); nominal_clearance=underside[0]-fb['max'][2]
        assert abs(nominal_clearance-.002)<2e-5
        samples=[]
        for x in (cx-1.30,cx,cx+1.30):
            for y in (2.54,2.56,2.58,2.60,2.64,2.68,2.699):
                bottom=ray(bed,x,y,True)
                assert bottom,('Missing continuous junction underside',i,x,y)
                surfaces=[v[0] for o in platform if o.type=='MESH' and (v:=ray(o,x,y))]
                if surfaces:
                    gap=bottom[0]-max(surfaces)
                    assert gap>=.0017,('Junction intersects approved platform',i,x,y,gap)
                    samples.append(gap); all_surface_clearances.append(gap)
        results.append({'lane_index':i,'center_x':cx,'bed_bounds':b,'width':l['width'],
                        'travel_height_z':top[0],'terminal_top_z':nose[0],
                        'nominal_frame_underside_clearance':nominal_clearance,
                        'terminal_top_step_above_frame':nose[0]-fb['max'][2],
                        'sampled_junction_clearance_min':min(samples),
                        'nose_reach_from_chassis_rear':front-b['min'][1]})
    shoulder_fit=[]
    for side,label in ((-1,'left shoulder'),(1,'right shoulder')):
        cap=next(o for o in candidate if o.name=='Highway | slim muted metal '+label)
        for x in (5.92,5.95,5.98):
            body_top=ray(chassis,side*x,4.0); cap_top=ray(cap,side*x,4.0); cap_bottom=ray(cap,side*x,4.0,True)
            assert body_top and cap_top and cap_bottom,('Missing fitted shoulder coverage',label,x)
            assert abs(cap_top[0]-body_top[0]-.002)<.0002,('Floating shoulder cap',label,x,body_top,cap_top)
            assert cap_bottom[0]<body_top[0]-.005,('Shoulder not embedded',label,x)
            shoulder_fit.append({'side':label,'x':side*x,'top_relief_above_chamfer':cap_top[0]-body_top[0],
                                 'underside_embed_depth':body_top[0]-cap_bottom[0]})
    return {'measured_platform':m,'lanes':results,'chassis_bounds':bounds([chassis]),'fitted_shoulder_samples':shoulder_fit,
            'sampled_junction_min_clearance':min(all_surface_clearances),
            'straight_parallel_axes':True,'chassis_junction_gap':bounds([chassis])['min'][1]-front}

def camera_snapshot(c):
    return {'name':c.name,'matrix':[list(r) for r in c.matrix_world],
            'type':c.data.type,'lens':c.data.lens,'sensor_width':c.data.sensor_width}

def main():
    p=argparse.ArgumentParser(); p.add_argument('--report',type=Path,required=True)
    p.add_argument('--compare',type=Path,default=ROOT/'highway.blend',
                   help='Geometry/material comparison; defaults to approved highway.blend')
    p.add_argument('--negative-test',action='store_true')
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:]); out=output_path(a.report)
    if out.exists(): raise FileExistsError(out)
    source=Path(bpy.data.filepath).resolve(); before=sha(source); input_hashes=source_integrity()
    scene=bpy.context.scene; contract=json.loads(scene['highway_contract']); length=contract['length']
    candidate=list(bpy.data.collections[CANDIDATE].objects)
    platform=list(bpy.data.collections[PLATFORM_REF].objects)
    endcaps=list(bpy.data.collections[ENDCAP_REF].objects)
    assert len(candidate)==14 and all(o.type=='MESH' for o in candidate)
    assert len(endcaps)==2 and len(platform)==53
    materials={s.material.name for o in candidate for s in o.material_slots}
    assert len(materials)==8 and all(n.startswith('Highway ') for n in materials)
    assert not bpy.data.libraries and not bpy.utils.blend_paths(absolute=True,packed=False,local=True)
    assert all(not o.animation_data and all(abs(s-1)<1e-7 for s in o.scale) for o in candidate)
    fit=alignment(candidate,platform,length)
    negative=None
    if a.negative_test:
        bed=next(o for o in candidate if 'lane 2 | continuous inset bed' in o.name)
        x=bed.location.x; bed.location.x+=.125; bpy.context.view_layer.update()
        try:
            alignment(candidate,platform,length)
        except AssertionError as e:
            assert 'Lane center mismatch' in str(e),str(e)
            negative={'pass':True,'in_memory_x_displacement':.125,'rejected_invariant':'Lane center mismatch'}
        else: raise AssertionError('Alignment invariant accepted shifted lane')
        finally:
            bed.location.x=x; bpy.context.view_layer.update()
        alignment(candidate,platform,length)
    topo=[]
    for o in candidate:
        for evaluated in (False,True):
            ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get()) if evaluated else o
            me=ev.to_mesh() if evaluated else o.data
            bm=bmesh.new(); bm.from_mesh(me); bm.normal_update()
            bad=sum(not e.is_manifold for e in bm.edges)
            winding=sum(e.is_manifold and not e.is_contiguous for e in bm.edges)
            deg=sum(f.calc_area()<1e-10 for f in bm.faces); volume=bm.calc_volume(signed=True)
            assert bad==0 and winding==0 and deg==0 and volume>0,(o.name,evaluated,bad,winding,deg,volume)
            topo.append({'object':o.name,'evaluated':evaluated,'verts':len(bm.verts),'faces':len(bm.faces),
                         'triangles':sum(len(f.verts)-2 for f in bm.faces),'nonmanifold':bad,
                         'inconsistent_winding':winding,'degenerate':deg,'signed_volume':volume})
            bm.free()
            if evaluated: ev.to_mesh_clear()
    highway_state=snapshot(candidate); platform_state=snapshot(platform); endcap_state=snapshot(endcaps)
    highway_bounds=bounds(candidate); camera=camera_snapshot(scene.camera)
    endcap_bounds=bounds(endcaps)
    assert highway_bounds['min'][0]>=-6.000001 and highway_bounds['max'][0]<=6.000001
    assert abs(endcap_bounds['max'][1]-fit['chassis_bounds']['min'][1])<2e-6
    # Highway is entirely beyond caps' rear extent except separated lane noses X<=5.875.
    assert all(bounds([o])['min'][1]>=2.699999 or bounds([o])['min'][0]>=-5.875001 and bounds([o])['max'][0]<=5.875001 for o in candidate)
    if a.compare:
        bpy.ops.wm.open_mainfile(filepath=str(a.compare.resolve()))
        assert highway_state==snapshot(list(bpy.data.collections[CANDIDATE].objects)), 'Regeneration geometry/material mismatch'
        assert platform_state==snapshot(list(bpy.data.collections[PLATFORM_REF].objects))
        assert endcap_state==snapshot(list(bpy.data.collections[ENDCAP_REF].objects))
        assert camera==camera_snapshot(bpy.context.scene.camera)
    bpy.ops.wm.open_mainfile(filepath=str(PLATFORM))
    actual=[o for o in bpy.context.scene.objects if o.type in {'MESH','CURVE'} and not o.name.startswith('Studio')]
    assert platform_state==snapshot(actual),'Imported platform changed'
    assert camera==camera_snapshot(bpy.context.scene.camera),'Accepted reference camera changed'
    bpy.ops.wm.open_mainfile(filepath=str(ENDCAPS))
    assert endcap_state==snapshot([o for o in bpy.context.scene.objects if o.name.startswith('Endcap |')]),'Imported endcaps changed'
    assert sha(source)==before and source_integrity()==input_hashes
    report={'pass':True,'blender':bpy.app.version_string,'highway_sha256_before_after':before,
            'immutable_sources_sha256_before_after':input_hashes,'highway_bounds':highway_bounds,
            'candidate_objects':len(candidate),'candidate_materials':sorted(materials),
            'candidate_material_count':len(materials),'candidate_evaluated_triangles':sum(t['triangles'] for t in topo if t['evaluated']),
            'fit':fit,'topology_checks':topo,'negative_alignment_test':negative,
            'independent_rebuild_exact_geometry_and_material_match':bool(a.compare),
            'approved_reference_geometry_materials_camera_unchanged':True,'accepted_camera':camera,
            'endcap_bounds':endcap_bounds,'length':length,
            'provisional_runtime_mapping':{'scale':4/3,'far_authoring_y':14.575,'far_overscan_authoring_y':17.725,
                                           'overscan_covered':highway_bounds['max'][1]>=17.725},
            'intentional_intra_asset_overlap':['Colored edge inlays embedded in lane enamel; slim metal embedded in deck lands'],
            'not_validated':['Exhaustive self/intersection tests','Physical attachment/collision','Runtime transforms and shaders',
                             'Game-camera/responsive visibility','Approved performance budgets']}
    out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(report,indent=2)+'\n')
    print('VALIDATION_PASS',str(out),'triangles',report['candidate_evaluated_triangles'],flush=True)

if __name__=='__main__': main()
