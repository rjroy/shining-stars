"""Framing-only semicircle from the exact initial candidate, never overwrite."""
import argparse, importlib.util, json, math, sys
from pathlib import Path
sys.dont_write_bytecode = True
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
import assemble as A
spec=importlib.util.spec_from_file_location('_source_signatures',Path(__file__).resolve().parent/'signatures.py')
V=importlib.util.module_from_spec(spec);spec.loader.exec_module(V)
PACKAGE=Path(__file__).resolve().parent
INITIAL=None
INITIAL_SHA=None
N=26
PITCH=3.26  # 2.8 section + .70 post body - two .12 joint overlaps
DELTA=math.pi/N
RADIUS=PITCH/(2*math.sin(DELTA/2))
CENTER=Vector((0,20,-.65))

def output(path,suffix):
    p=Path(path).resolve()
    assert p.suffix==suffix and p.parent.is_dir(),'New output in existing directory required'
    assert p.is_relative_to(PACKAGE) or p.is_relative_to(Path('/tmp/opencode')),'Unauthorized output'
    if p.exists():raise FileExistsError(p)
    return p

def protected():
    A.check_sources();assert A.sha(INITIAL)==INITIAL_SHA,'Initial candidate changed'

def action_state(action):
    return [[f.data_path,f.array_index,f.extrapolation,
        [[list(k.co),list(k.handle_left),list(k.handle_right),k.interpolation,k.handle_left_type,k.handle_right_type] for k in f.keyframe_points]]
        for layer in action.layers for strip in layer.strips for bag in strip.channelbags for f in bag.fcurves]

def nonframing_state():
    scene=bpy.context.scene;objects=[o for o in scene.objects if o.get('review_asset')!='framing']
    data=V.source_signatures([o for o in objects if o.type in ('MESH','CURVE','ARMATURE','EMPTY')])
    result={'objects':{},'geometry':{k:v for k,v in V.geometry().items() if v['asset']!='framing'},
        'world':[[n.name,[[s.name,list(s.default_value) if hasattr(s.default_value,'__len__') else s.default_value]
                 for s in n.inputs if hasattr(s,'default_value')]] for n in scene.world.node_tree.nodes],
        'scene':{'camera':scene.camera.name,'resolution':[scene.render.resolution_x,scene.render.resolution_y,scene.render.resolution_percentage],
                 'engine':scene.render.engine,'samples':scene.cycles.samples,'denoise':scene.cycles.use_denoising,
                 'view':[scene.view_settings.view_transform,scene.view_settings.look,scene.view_settings.exposure,scene.view_settings.gamma],
                 'frame':scene.frame_current}}
    for o in objects:
        record={'type':o.type,'world':V.flat(o.matrix_world),'basis':V.flat(o.matrix_basis),
            'parent_inverse':V.flat(o.matrix_parent_inverse),'parent':o.parent.name if o.parent else None,
            'hide':[o.hide_render,o.hide_viewport],'data':data.get(o.name)}
        if o.type=='ARMATURE':
            record['pose']=[[p.name,list(p.location),list(p.rotation_quaternion),list(p.scale)] for p in o.pose.bones]
            record['action']=action_state(o.animation_data.action)
        if o.type=='CAMERA':record['camera']=[o.data.type,o.data.lens,o.data.sensor_width,o.data.sensor_height,o.data.sensor_fit,o.data.clip_start,o.data.clip_end,o.data.shift_x,o.data.shift_y]
        if o.type=='LIGHT':record['light']=[o.data.type,o.data.energy,list(o.data.color),o.data.shape if o.data.type=='AREA' else None,o.data.size if o.data.type=='AREA' else o.data.angle]
        result['objects'][o.name]=record
    return result

def placements():
    posts=[CENTER+Vector((RADIUS*math.cos(i*DELTA),RADIUS*math.sin(i*DELTA),0)) for i in range(N+1)]
    result=[]
    for i,point in enumerate(posts):
        result.append({'role':'post','index':i,'position':list(point),'yaw':i*DELTA-math.pi/2})
        if i<N:
            result.append({'role':'section','index':i,'position':list((point+posts[i+1])/2),
                           'yaw':(i+.5)*DELTA-math.pi/2})
    return result

def compose(dest):
    output(dest,'.blend');protected()
    bpy.ops.wm.open_mainfile(filepath=str(INITIAL));bpy.context.view_layer.update()
    frozen=V.digest(nonframing_state())
    old=[o for o in bpy.context.scene.objects if o.get('review_asset')=='framing']
    for o in old:bpy.data.objects.remove(o,do_unlink=True)
    cols,refs=A.load_asset('framing')
    prototypes={role:next(o for o in refs if not o.parent and o.get('side')=='left' and o.get('module')==kind)
                for role,kind in (('section','long'),('post','post'))}
    dest_collection=A.collection('FRAMING.SectionPostSemicircle')
    for p in placements():
        template=prototypes[p['role']];root=template.copy()
        root.name=f"framing-arch.{p['role']}.{p['index']:02}.root";dest_collection.objects.link(root)
        root['review_asset']='framing';root['source_object']=template.name
        root['arc_role']=p['role'];root['arc_index']=p['index']
        root.location=p['position'];root.rotation_euler=(0,0,p['yaw']);root.scale=(1,1,1)
        for original in template.children:
            child=original.copy();dest_collection.objects.link(child)
            child.name=f"framing-arch.{p['role']}.{p['index']:02}::{original.data.name}"
            child['review_asset']='framing';child['source_object']=original.name
            child.parent=root;child.matrix_basis=original.matrix_basis.copy()
    for o in refs:bpy.data.objects.remove(o,do_unlink=True)
    for col in cols:bpy.data.collections.remove(col)
    bpy.context.view_layer.update()
    assert V.digest(nonframing_state())==frozen,'Nonframing scene changed during replacement'
    bpy.context.scene['framing_revision']=json.dumps({'status':'User framing direction approved; scene acceptance pending',
        'center':list(CENTER),'radius':RADIUS,'arc_degrees':180,'section_count':N,'post_count':N+1,
        'post_components':3,'section_kind':'existing long','chord_pitch':PITCH,'nominal_body_overlap_per_joint':.12,
        'opening':'foreground -Y','nonframing_fingerprint':frozen},sort_keys=True)
    protected();print('FRAMING SAVE ATTEMPT',dest,flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(dest),compress=True)
    protected();print('FRAMING SAVE SUCCESS',dest,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True)
    p.add_argument('--input',type=Path,required=True)
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    INITIAL=args.input.resolve();INITIAL_SHA=A.sha(INITIAL)
    compose(output(args.output,'.blend'))
