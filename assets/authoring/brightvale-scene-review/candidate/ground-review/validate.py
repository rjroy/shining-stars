"""Read-only common-translation, two ground levels, circle fit and defects."""
import argparse,importlib.util,json,math,sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
from mathutils import Vector
PACKAGE=Path(__file__).resolve().parent
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
G=module('_ground_builder',PACKAGE/'build.py');A,V=G.A,G.V
O=module('_old_candidate_validator',PACKAGE.parent/'validate.py')

def placement_checks(measurements):
    scene=bpy.context.scene;plaza=bpy.data.objects[G.PLAZA];world=bpy.data.objects['Review.Ground']
    city=[o for o in scene.objects if o.get('review_asset')=='city']
    city_bounds=G.bounds(city);lower_z=G.bounds([world])[0][2]
    assert abs(city_bounds[0][2]-lower_z)<2e-6,'City base not on lower world ground'
    floor_objects=[o.name for o in city if o.type=='MESH' and abs(G.bounds([o])[0][2]-city_bounds[0][2])<2e-6]
    assert any('Infrastructure.MasonryAndStreets' in name for name in floor_objects),'Foundation datum not verified'
    assert abs(lower_z-measurements['world_ground_z'])<1e-8,'World ground moved'
    assert tuple(plaza.rotation_euler)==(0,0,0) and tuple(plaza.scale)==(1,1,1),'Disk rotation/scale changed'
    expected=(*measurements['plaza_center_xy'],measurements['plaza_elevation'])
    assert max(abs(a-b) for a,b in zip(plaza.location,expected))<2e-6,'Wrong local-ground elevation or center'
    assert len(plaza.data.materials)==1 and plaza.data.materials[0]==world.data.materials[0],'Ground material not reused'
    assert not plaza.modifiers and len(plaza.data.vertices)==G.SEGMENTS+1 and len(plaza.data.polygons)==G.SEGMENTS,'New structural geometry'
    assert all(len(p.vertices)==3 and p.normal.z>.99999 and p.area>0 for p in plaza.data.polygons),'Disk triangles invalid'
    assert all(abs(v.co.z)<1e-8 for v in plaza.data.vertices),'Disk thickness introduced'
    radius=measurements['plaza_radius']
    radii=[math.hypot(v.co.x,v.co.y) for v in list(plaza.data.vertices)[1:]]
    assert max(abs(r-radius) for r in radii)<2e-6,'Disk extends beyond frame radius'
    frame=[o for o in scene.objects if o.get('review_asset')=='framing']
    frame_bounds=G.bounds(frame)
    crowd_bounds=G.bounds([o for o in scene.objects if o.get('review_asset')=='crowd'])
    assert abs(frame_bounds[0][2]-plaza.location.z)<2e-6,'Frame interior ground changed'
    assert abs(crowd_bounds[0][2]-plaza.location.z)<2e-6,'Crowd interior ground changed'
    footprints={}
    for asset in ('platform','endcaps','highway','crowd'):
        points=G.evaluated_points([o for o in scene.objects if o.get('review_asset')==asset])
        maximum=max(math.hypot(p[0]-plaza.location.x,p[1]-plaza.location.y) for p in points)
        assert maximum<radius-.05,('Disk fails to cover footprint',asset,maximum)
        footprints[asset]={'maximum_plan_radius':maximum,'margin_inside_disk':radius-maximum}
    assert city_bounds[0][1]>plaza.location.y+radius,'New disk intersects city footprint'
    # The disk ends within the approved frame's foot band along the rear arc.
    # Test solid geometry just above contact, not coincident bottom surfaces.
    stone=[o for o in frame if o.type=='MESH' and ('masonry section' in o['source_object'] or 'stone pier' in o['source_object'])]
    trees={o:O.make_tree(o) for o in stone};covered=0
    for i in range(G.SEGMENTS//2+1):
        angle=2*math.pi*i/G.SEGMENTS
        p=Vector((plaza.location.x+radius*math.cos(angle),plaza.location.y+radius*math.sin(angle),plaza.location.z+.02))
        nearby=[o for o in stone if math.hypot(o.parent.location.x-p.x,o.parent.location.y-p.y)<2.1]
        assert any(O.inside(trees[o],p) for o in nearby),('Circle edge escapes existing frame foot',i)
        covered+=1
    # Plane/foot underside contact is intended. No old upward-facing surface
    # is coincident with the plaza at exposed interior points.
    minimum_city_gap=city_bounds[0][1]-(plaza.location.y+radius)
    return {'city_bounds_after':city_bounds,'city_ground_contact_error':city_bounds[0][2]-lower_z,
        'foundation_objects_at_datum':floor_objects,'lower_ground_z':lower_z,'local_ground_z':plaza.location.z,
        'two_level_separation':plaza.location.z-lower_z,'circle_center':list(plaza.location),'circle_radius':radius,
        'circle_triangles':len(plaza.data.polygons),'radius_error_max':max(abs(r-radius) for r in radii),
        'grounded_frame_contact_error':frame_bounds[0][2]-plaza.location.z,'grounded_crowd_contact_error':crowd_bounds[0][2]-plaza.location.z,
        'footprints':footprints,'rear_perimeter_foot_overlap_samples':covered,'circle_to_city_plan_gap':minimum_city_gap,
        'z_fighting':'Lower plane separated by translation; new plane touches downward-facing frame feet only, not an exposed coincident floor'}

def lane_checks():
    scene=bpy.context.scene;graph=bpy.context.evaluated_depsgraph_get();camera=scene.camera
    group=bpy.data.objects['COMPOSITION.Playfield.ForegroundPivot'];count=0
    for center in (-4.5,-1.5,1.5,4.5):
        for offset in (-1.2,-.6,0,.6,1.2):
            for i in range(41):
                target=group.matrix_world@Vector((center+offset,3.2+i*(44.7-3.4)/40,.445))
                hit,point,normal,index,o,matrix=scene.ray_cast(graph,camera.location,(target-camera.location).normalized())
                assert hit and o.get('review_asset')=='highway',('Lane occluded by ground',center,offset,i,o.name if o else None)
                count+=1
    return count

def defects(baseline,measurements):
    result={};scene=bpy.context.scene
    city=bpy.data.objects['city::CITY.ProvisionalLayout'];saved=city.location.copy();city.location.z-=.1;bpy.context.view_layer.update()
    try:placement_checks(measurements)
    except AssertionError as e:
        assert 'City base not on lower' in str(e);result['buried_city_rejected']=True
    else:raise AssertionError('Buried-city defect accepted')
    finally:city.location=saved;bpy.context.view_layer.update()
    plaza=bpy.data.objects[G.PLAZA];saved=plaza.location.copy();plaza.location.z+=.1;bpy.context.view_layer.update()
    try:placement_checks(measurements)
    except AssertionError as e:
        assert 'Wrong local-ground' in str(e);result['wrong_plaza_height_rejected']=True
    else:raise AssertionError('Wrong-height defect accepted')
    finally:plaza.location=saved;bpy.context.view_layer.update()
    saved=plaza.scale.copy();plaza.scale=(1.02,1.02,1);bpy.context.view_layer.update()
    try:placement_checks(measurements)
    except AssertionError as e:
        assert 'Disk rotation/scale' in str(e);result['oversized_disk_rejected']=True
    else:raise AssertionError('Oversized disk accepted')
    finally:plaza.scale=saved;bpy.context.view_layer.update()
    camera=scene.camera;saved=camera.location.copy();camera.location.z-=.1;bpy.context.view_layer.update()
    try:G.verify_translation(baseline,measurements['translation_z'])
    except AssertionError as e:
        assert 'Common translation' in str(e);result['untranslated_camera_rejected']=True
    else:raise AssertionError('Camera offset defect accepted')
    finally:camera.location=saved;bpy.context.view_layer.update()
    return result

def run(report,negative):
    source=Path(bpy.data.filepath).resolve();before=A.sha(source);G.protected()
    bpy.ops.wm.open_mainfile(filepath=str(G.REFERENCE));bpy.context.view_layer.update()
    measurements=G.measure();baseline=G.state();baseline_digest=V.digest(baseline)
    bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.view_layer.update()
    assert not bpy.data.libraries and not bpy.data.images
    error=G.verify_translation(baseline,measurements['translation_z'])
    saved=json.loads(bpy.context.scene['ground_revision'])
    assert all(saved[k]==measurements[k] for k in measurements),'Recorded derivation differs from actual checkpoint'
    result={'pass':True,'blender':bpy.app.version_string,'scene_sha256':before,'checkpoint_sha256':G.REFERENCE_SHA,
        'derivation':measurements,'checks':placement_checks(measurements),'maximum_common_translation_matrix_error':error,
        'old_object_data_and_relative_transform_checks':len(baseline['objects']),'checkpoint_semantic_fingerprint':baseline_digest,
        'unobstructed_lane_rays':lane_checks(),'geometry_fingerprint':V.digest(V.geometry()),
        'source_sha256':{k:v[1] for k,v in A.SOURCES.items()}}
    restored_state=V.digest(G.state())
    if negative:
        result['negative_tests']=defects(baseline,measurements)
        assert V.digest(G.state())==restored_state and V.digest(V.geometry())==result['geometry_fingerprint'],'Defect restoration drift'
        assert placement_checks(measurements)==result['checks'] and lane_checks()==result['unobstructed_lane_rays']
    assert A.sha(source)==before;G.protected()
    report.write_text(json.dumps(result,indent=2)+'\n');print('GROUND VALIDATION SUCCESS',report,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--report',type=Path,required=True);p.add_argument('--negative-test',action='store_true')
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);print('GROUND VALIDATION ATTEMPT',bpy.data.filepath,flush=True)
    run(G.output(args.report,'.json'),args.negative_test)
