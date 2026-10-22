"""One ground-only revision of the immutable framing checkpoint. No exports."""
import argparse,importlib.util,json,math,sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
from mathutils import Matrix,Vector
PACKAGE=Path(__file__).resolve().parent
SCENE_PACKAGE=PACKAGE.parent
REFERENCE=None
INPUT_SHA=None
REFERENCE_SHA='59af1409cedd26a792007df8c857feb08aed3c3f4fc3f6c0838ed10699b92849'
PLAZA='Review.LocalGround.Circle'
SEGMENTS=520  # ten edge subdivisions per existing section/post interval
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
F=module('_ground_framing_helpers',PACKAGE/'framing.py')
A,V=F.A,F.V

def output(path,suffix):
    p=Path(path).resolve()
    assert p.suffix==suffix and p.parent.is_dir(),'New output in existing directory required'
    assert p.is_relative_to(SCENE_PACKAGE) or p.is_relative_to(Path('/tmp/opencode')),'Output outside authorized package/scratch'
    if p.exists():raise FileExistsError(p)
    return p

def protected():
    A.check_sources();assert A.sha(REFERENCE)==INPUT_SHA,'Scratch framing input changed'

def evaluated_points(objects):
    graph=bpy.context.evaluated_depsgraph_get()
    for o in objects:
        if o.type not in ('MESH','CURVE'):continue
        ev=o.evaluated_get(graph);mesh=ev.to_mesh()
        try:
            # Accumulate in Python double precision from the actual saved
            # float mesh/matrix fields; avoid an extra Vector float rounding.
            for v in mesh.vertices:
                yield tuple(sum(float(ev.matrix_world[i][j])*float(v.co[j]) for j in range(3))+float(ev.matrix_world[i][3]) for i in range(3))
        finally:ev.to_mesh_clear()

def bounds(objects):
    points=list(evaluated_points(objects));assert points
    return [[min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)]]

def measure():
    scene=bpy.context.scene;ground=bpy.data.objects['Review.Ground']
    heights=[p[2] for p in evaluated_points([ground])]
    assert max(heights)-min(heights)<1e-8,'World ground is not horizontal'
    world_z=heights[0]
    city=[o for o in scene.objects if o.get('review_asset')=='city']
    city_bounds=bounds(city)
    frame=[o for o in scene.objects if o.get('review_asset')=='framing']
    frame_bounds=bounds(frame)
    metadata=json.loads(scene['framing_revision'])
    center=metadata['center'][:2];radius=metadata['radius']
    local_z=frame_bounds[0][2]
    for root in [o for o in frame if o.get('arc_role')=='post']:
        assert abs(math.hypot(root.location.x-center[0],root.location.y-center[1])-radius)<1e-5
        assert abs(root.location.z-local_z)<1e-6
    delta=world_z-city_bounds[0][2]
    assert delta>0,'City does not need the approved upward ground correction'
    return {'world_ground_z':world_z,'city_bounds_before':city_bounds,'local_ground_z_before':local_z,
        'translation_z':delta,'plaza_center_xy':center,'plaza_radius':radius,'plaza_elevation':local_z+delta,
        'circle_segments':SEGMENTS,'checkpoint_sha256':REFERENCE_SHA}

def state():
    """All old objects, data and presentation. Excludes only the new disk."""
    scene=bpy.context.scene;objects=[o for o in scene.objects if o.name!=PLAZA]
    signatures=V.source_signatures([o for o in objects if o.type in ('MESH','CURVE','ARMATURE','EMPTY')])
    result={'objects':{},'world':[[n.name,[[s.name,list(s.default_value) if hasattr(s.default_value,'__len__') else s.default_value]
        for s in n.inputs if hasattr(s,'default_value')]] for n in scene.world.node_tree.nodes],
        'render':{'camera':scene.camera.name,'resolution':[scene.render.resolution_x,scene.render.resolution_y,scene.render.resolution_percentage],
        'engine':scene.render.engine,'samples':scene.cycles.samples,'denoise':scene.cycles.use_denoising,
        'view':[scene.view_settings.view_transform,scene.view_settings.look,scene.view_settings.exposure,scene.view_settings.gamma],
        'frame':scene.frame_current}}
    for o in objects:
        record={'world':V.flat(o.matrix_world),'basis':V.flat(o.matrix_basis),'parent_inverse':V.flat(o.matrix_parent_inverse),
            'parent':o.parent.name if o.parent else None,'type':o.type,'hide':[o.hide_render,o.hide_viewport],
            'rotation_mode':o.rotation_mode,'rotation_euler':list(o.rotation_euler),'rotation_quaternion':list(o.rotation_quaternion),
            'scale':list(o.scale),'source_data':signatures.get(o.name)}
        if o.type=='ARMATURE':
            record['pose']=[[p.name,list(p.location),list(p.rotation_quaternion),list(p.scale)] for p in o.pose.bones]
            record['action']=F.action_state(o.animation_data.action)
        if o.type=='CAMERA':record['camera']=[o.data.type,o.data.lens,o.data.sensor_width,o.data.sensor_height,o.data.sensor_fit,
            o.data.clip_start,o.data.clip_end,o.data.shift_x,o.data.shift_y]
        if o.type=='LIGHT':record['light']=[o.data.type,o.data.energy,list(o.data.color),
            o.data.shape if o.data.type=='AREA' else None,o.data.size if o.data.type=='AREA' else o.data.angle]
        result['objects'][o.name]=record
    return result

def verify_translation(baseline,delta):
    current=state();assert current['world']==baseline['world'] and current['render']==baseline['render'],'Presentation changed'
    assert current['objects'].keys()==baseline['objects'].keys(),'Original object set changed'
    transform=Matrix.Translation((0,0,delta));maximum_error=0
    for name,old in baseline['objects'].items():
        new=current['objects'][name]
        for key in old:
            if key not in ('world','basis'):assert new[key]==old[key],('Original data/rotation/scale changed',name,key)
        old_world=Matrix([old['world'][i:i+4] for i in range(0,16,4)])
        expected=old_world if name=='Review.Ground' else transform@old_world
        error=max(abs(a-b) for a,b in zip(new['world'],V.flat(expected)));maximum_error=max(maximum_error,error)
        assert error<1e-5,('Common translation violated',name,error)
        old_basis=Matrix([old['basis'][i:i+4] for i in range(0,16,4)])
        expected_basis=transform@old_basis if not old['parent'] and name!='Review.Ground' else old_basis
        assert max(abs(a-b) for a,b in zip(new['basis'],V.flat(expected_basis)))<1e-5,('Relative local transform changed',name)
    return maximum_error

def build(dest):
    output(dest,'.blend');protected()
    print('GROUND READ CHECKPOINT ATTEMPT',REFERENCE,flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(REFERENCE));bpy.context.view_layer.update()
    measurements=measure();baseline=state();delta=measurements['translation_z']
    print('GROUND MEASURED TRANSLATION',json.dumps(measurements,sort_keys=True),flush=True)
    # Move only hierarchy roots. Child local transforms, rotations and scales
    # remain unchanged. Camera and all four lights receive the SAME offset.
    moved=[]
    for o in bpy.context.scene.objects:
        if not o.parent and o.name!='Review.Ground':o.location.z+=delta;moved.append(o.name)
    bpy.context.view_layer.update();verify_translation(baseline,delta)
    radius=measurements['plaza_radius']
    vertices=[(0,0,0)]+[(radius*math.cos(2*math.pi*i/SEGMENTS),radius*math.sin(2*math.pi*i/SEGMENTS),0) for i in range(SEGMENTS)]
    faces=[(0,i+1,(i+1)%SEGMENTS+1) for i in range(SEGMENTS)]
    mesh=bpy.data.meshes.new(PLAZA+'.Mesh');mesh.from_pydata(vertices,[],faces);mesh.update()
    plaza=bpy.data.objects.new(PLAZA,mesh);bpy.context.scene.collection.objects.link(plaza)
    plaza.location=(*measurements['plaza_center_xy'],measurements['plaza_elevation'])
    plaza['review_asset']='local-ground';plaza['purpose']='Flat circular local ground; no wall, thickness or support structure'
    mesh.materials.append(bpy.data.objects['Review.Ground'].data.materials[0])
    measurements['moved_roots']=sorted(moved);measurements['lighting']='All positional lights, including sun object, translated with assets; energies/colors/orientations unchanged'
    bpy.context.scene['ground_revision']=json.dumps(measurements,sort_keys=True)
    bpy.context.view_layer.update();verify_translation(baseline,delta);protected()
    print('GROUND SAVE ATTEMPT',dest,flush=True);bpy.ops.wm.save_as_mainfile(filepath=str(dest),compress=True)
    protected();print('GROUND SAVE SUCCESS',dest,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True)
    p.add_argument('--input',type=Path,required=True)
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    REFERENCE=args.input.resolve();INPUT_SHA=A.sha(REFERENCE)
    build(output(args.output,'.blend'))
