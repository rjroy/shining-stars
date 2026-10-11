"""Read-only saved-rig checks, including actual posed geometry and negative tests."""
import argparse
import hashlib
import json
import math
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import BASE, BASE_SHA256, POSES, apply_pose, bone_specs, new_output, sha


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def flat(matrix):
    return [c for row in matrix for c in row]


def meshes():
    return sorted((o for o in bpy.data.objects if o.type == 'MESH'),key=lambda o:o.name)


def native():
    result = {'meshes':{},'materials':{}}
    for obj in meshes():
        mesh = obj.data
        assert not mesh.shape_keys
        result['meshes'][obj.name] = {
            'vertices':[list(v.co) for v in mesh.vertices],
            'edges':[list(e.vertices) for e in mesh.edges],
            'polygons':[[list(p.vertices),p.material_index,p.use_smooth] for p in mesh.polygons],
            'materials':[m.name for m in mesh.materials],
            'transform':flat(obj.matrix_world),
        }
    for mat in sorted(bpy.data.materials,key=lambda m:m.name):
        nodes=[]
        for node in mat.node_tree.nodes:
            inputs=[]
            for socket in node.inputs:
                if not hasattr(socket,'default_value'):
                    continue
                value=socket.default_value
                if not isinstance(value,(str,int,float,bool)):
                    value=list(value) if value is not None else None
                inputs.append([socket.identifier,value])
            nodes.append([node.name,node.bl_idname,inputs])
        result['materials'][mat.name] = [list(mat.diffuse_color),nodes,
            [[l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier] for l in mat.node_tree.links]]
    return result


def weights_and_bones():
    rig=bpy.data.objects['CrowdRig']
    assert rig['source_sha256']==BASE_SHA256
    assert json.loads(rig['pose_definitions'])==json.loads(json.dumps(POSES)),'Pose definitions differ'
    assert len(bpy.data.armatures)==1 and len(rig.data.bones)==20,'Bone count'
    assert set(bpy.data.actions.keys())=={'Pose.'+p for p in POSES},'Pose action ownership'
    assert not bpy.data.libraries and not bpy.data.images
    assert len(meshes())==17 and len(bpy.data.objects)==19,'Object count'
    bone_report={}
    for name,head,tail,parent,connected in bone_specs():
        bone=rig.data.bones[name]
        assert (bone.parent.name if bone.parent else None)==parent,('Bone parent',name)
        assert bone.use_connect==connected,('Bone connection',name)
        assert (bone.head_local-Vector(head)).length<1e-6 and (bone.tail_local-Vector(tail)).length<1e-6,('Bone rest landmarks',name)
        rot=bone.matrix_local.to_3x3()
        # Blender's float32 edit-bone roll conversion accumulates ~1.2e-5
        # determinant error down the downward-facing leg chain.
        assert abs(rot.determinant()-1)<3e-5 and bone.length>.05,('Bone frame',name)
        direction=(bone.tail_local-bone.head_local).normalized()
        front=Vector((0,-1,0));front=(front-direction*direction.dot(front)).normalized()
        assert (rot@Vector((0,0,1))).dot(front)>.9999,('Bone roll',name)
        assert not rig.pose.bones[name].constraints,('Unexpected constraints',name)
        bone_report[name]=[parent,connected,flat(bone.matrix_local),bone.length,bone.use_deform]
    weight_report={}
    for obj in meshes():
        assert obj.parent==bpy.data.objects['NeutralBase'],'Mesh ownership'
        assert len(obj.modifiers)==1 and obj.modifiers[0].type=='ARMATURE',('Skin modifier',obj.name)
        mod=obj.modifiers[0]
        assert mod.object==rig and mod.use_deform_preserve_volume and mod.use_vertex_groups and not mod.use_bone_envelopes
        values=[]
        for v in obj.data.vertices:
            groups={obj.vertex_groups[g.group].name:g.weight for g in v.groups}
            assert groups and abs(sum(groups.values())-1)<2e-6,('Unweighted/non-normalized vertex',obj.name,v.index)
            assert all(math.isfinite(w) and 0<w<=1 and rig.data.bones[n].use_deform for n,w in groups.items()),('Invalid weights',obj.name,v.index)
            if obj.name in ('Hair','Ears','Mouth') or obj.name.startswith(('EyeWhite.','Iris.','BrowLid.')):
                assert groups=={'head':1.},('Face attachment',obj.name)
            values.append(groups)
        weight_report[obj.name]=values
    return {'bones':bone_report,'weights':weight_report,'pose_definitions':json.loads(rig['pose_definitions'])}


def evaluated():
    graph=bpy.context.evaluated_depsgraph_get()
    result={}
    minimum_area=float('inf')
    collinear_ears={}
    for obj in meshes():
        evaluated_obj=obj.evaluated_get(graph)
        mesh=evaluated_obj.to_mesh()
        try:
            coords=[evaluated_obj.matrix_world@v.co for v in mesh.vertices]
            assert all(math.isfinite(c) for v in coords for c in v),('Nonfinite deformation',obj.name)
            assert len(coords)==len(obj.data.vertices),('Topology changed',obj.name)
            assert all(math.isfinite(c) for p in mesh.polygons for c in p.normal),('Invalid normal',obj.name)
            mesh.calc_loop_triangles()
            areas=[(coords[t.vertices[1]]-coords[t.vertices[0]]).cross(coords[t.vertices[2]]-coords[t.vertices[0]]).length*.5 for t in mesh.loop_triangles]
            # Modifier evaluation can choose a zero-area ear across an existing
            # collinear n-gon boundary midpoint. Never excuse an actual collapsed
            # source triangle: test the saved source tessellation separately.
            obj.data.calc_loop_triangles()
            stable_areas=[(coords[t.vertices[1]]-coords[t.vertices[0]]).cross(coords[t.vertices[2]]-coords[t.vertices[0]]).length*.5 for t in obj.data.loop_triangles]
            assert min(stable_areas)>1e-12,('Collapsed source triangle',obj.name,min(stable_areas))
            for t,area in zip(mesh.loop_triangles,areas):
                if area<=1e-12:
                    original=[obj.data.vertices[i].co for i in t.vertices]
                    assert len(mesh.polygons[t.polygon_index].vertices)>4 and (original[1]-original[0]).cross(original[2]-original[0]).length<2e-12,('New degenerate triangle',obj.name,t.polygon_index)
                    collinear_ears[obj.name]=collinear_ears.get(obj.name,0)+1
            assert all(p.area>1e-12 for p in mesh.polygons),('Collapsed face',obj.name)
            minimum_area=min(minimum_area,min(stable_areas))
            result[obj.name]=coords
        finally:
            evaluated_obj.to_mesh_clear()
    return result,{'minimum_source_triangle_area':minimum_area,'retessellated_collinear_ears':collinear_ears}


def contact_checks(rig, coords):
    for pb in rig.pose.bones:
        if pb.bone.use_connect:
            assert (pb.head-pb.parent.tail).length<2e-6,('Disconnected posed joint',pb.name)
    graph=bpy.context.evaluated_depsgraph_get()
    shirt=BVHTree.FromObject(bpy.data.objects['Shirt'],graph)
    result={}
    for side,suffix in ((1,'L'),(-1,'R')):
        obj=bpy.data.objects['ArmHand.'+str(side)]
        arm=BVHTree.FromObject(obj,graph)
        pb=rig.pose.bones['upper_arm.'+suffix]
        delta=pb.matrix@pb.bone.matrix_local.inverted()
        clearances=[]
        for x in (.254,.314,.338):
            if x==.254:
                ring=[coords[obj.name][v.index] for v in obj.data.vertices if abs(abs(v.co.x)-x)<1e-6]
                assert len(ring)==18
                origin=sum(ring,Vector())/len(ring)
            else:
                origin=delta@Vector((side*x,-.012,1.409))
            for i in range(24):
                angle=i*math.tau/24
                direction=delta.to_3x3()@Vector((0,math.sin(angle),math.cos(angle)))
                sh=shirt.ray_cast(origin,direction,.25)
                skin=arm.ray_cast(origin,direction,.25)
                assert sh[0] is not None and skin[0] is not None,('Missing sleeve coverage',suffix,x,i)
                clearances.append(sh[3]-skin[3])
        assert min(clearances)>.001,('Sleeve penetration/clearance',suffix,min(clearances))
        overlap=shirt.overlap(arm)
        assert not overlap,('Shirt/arm triangle intersections',suffix,len(overlap))
        wrist=rig.pose.bones['hand.'+suffix].head
        wrist_ring=[coords[obj.name][v.index] for v in obj.data.vertices if abs(abs(v.co.x)-.687)<1e-6]
        error=(sum(wrist_ring,Vector())/len(wrist_ring)-wrist).length
        assert error<.0025,('Wrist surface/joint separation',suffix,error)
        hand=rig.pose.bones['hand.'+suffix]
        hand_delta=hand.matrix@hand.bone.matrix_local.inverted()
        finger_error=max((coords[obj.name][v.index]-hand_delta@v.co).length for v in obj.data.vertices if abs(v.co.x)>.735)
        assert finger_error<2e-6,('Detached fingers',suffix,finger_error)
        result[suffix]={'minimum_sleeve_clearance':min(clearances),'triangle_intersections':len(overlap),
                        'wrist_center_error':error,'finger_rigid_error':finger_error,
                        'shoulder':list(pb.head),'elbow':list(rig.pose.bones['forearm.'+suffix].head),'wrist':list(wrist)}
    return result


def arm_intersections(coords):
    """Require zero source AND evaluated arm/hand crossings; no pair whitelist."""
    report={}
    def crossings(vv,triangles):
        tree=BVHTree.FromPolygons(vv,triangles,all_triangles=True)
        disjoint=[(a,b) for a,b in tree.overlap(tree) if a<b and not set(triangles[a])&set(triangles[b])]
        # Remove only shared-boundary contact for an all-face-interiors query.
        # Raw nonadjacent pairs above remain uncontracted and are not exempted.
        interior=[]
        for tri in triangles:
            center=sum((vv[i] for i in tri),Vector())/3
            interior.extend(center+(vv[i]-center)*.9999 for i in tri)
        tree=BVHTree.FromPolygons(interior,[tuple(range(i,i+3)) for i in range(0,len(interior),3)],all_triangles=True)
        overlaps=[(a,b) for a,b in tree.overlap(tree) if a<b]
        return {'nonadjacent':len(disjoint),'face_interiors':len(overlaps)}
    graph=bpy.context.evaluated_depsgraph_get()
    for side in (-1,1):
        obj=bpy.data.objects['ArmHand.'+str(side)]
        obj.data.calc_loop_triangles()
        triangles=[tuple(t.vertices) for t in obj.data.loop_triangles]
        original=crossings([v.co for v in obj.data.vertices],triangles)
        ev=obj.evaluated_get(graph);mesh=ev.to_mesh()
        try:
            mesh.calc_loop_triangles()
            posed=crossings(coords[obj.name],[tuple(t.vertices) for t in mesh.loop_triangles])
        finally:ev.to_mesh_clear()
        assert not any(original.values()) and not any(posed.values()),('Arm/hand self-intersection',obj.name,original,posed)
        report[obj.name]={'source':original,'evaluated':posed}
    return report


def pose_check(name):
    rig=apply_pose(name,use_action=True)
    coords,geometry_checks=evaluated()
    contacts=contact_checks(rig,coords)
    for side in (-1,1):
        shoe=bpy.data.objects['Shoe.'+str(side)]
        assert max((coords[shoe.name][v.index]-v.co).length for v in shoe.data.vertices)<2e-6,'Foot left ground/rest placement'
    head=rig.pose.bones['head'];delta=head.matrix@head.bone.matrix_local.inverted()
    face_error=0.
    for obj in meshes():
        if obj.name in ('Hair','Ears','Mouth') or obj.name.startswith(('EyeWhite.','Iris.','BrowLid.')):
            face_error=max(face_error,max((coords[obj.name][v.index]-delta@v.co).length for v in obj.data.vertices))
    assert face_error<2e-6,('Facial parts separated',face_error)
    assert (head.matrix.to_3x3()@head.bone.matrix_local.to_3x3().inverted()@Vector((0,-1,0))).dot(Vector((0,-1,0)))>.98,'Head no longer player-facing'
    if name=='Cheering':
        assert all(c['wrist'][2]>1.78 for c in contacts.values()),'Cheering wrist not raised'
    if name=='Reaching':
        assert contacts['L']['wrist'][1]<-.35,'Reaching wrist not forward'
    for suffix,c in contacts.items():
        if name!='Rest':
            a=(Vector(c['elbow'])-Vector(c['shoulder'])).normalized()
            b=(Vector(c['wrist'])-Vector(c['elbow'])).normalized()
            assert a.dot(b)<.97,('Unbent posed elbow',suffix)
    geometry={k:[[round(c,7) for c in v] for v in vv] for k,vv in coords.items()}
    transforms={pb.name:flat(pb.matrix) for pb in rig.pose.bones}
    apply_pose(name)
    direct,_=evaluated()
    assert max((direct[k][i]-v).length for k,vv in coords.items() for i,v in enumerate(vv))<2e-6,'Saved action differs from pose definition'
    return {'contacts':contacts,'face_rigid_error':face_error,**geometry_checks,
            'arm_self_intersections':arm_intersections(coords),
            'transforms':transforms,'geometry_fingerprint':digest(geometry)},coords


def run(negative=False):
    source=Path(bpy.data.filepath)
    before=sha(source)
    assert sha(BASE)==BASE_SHA256
    candidate=native()
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    original=native()
    assert candidate==original,'REST geometry/topology/material/transform differs from approved base'
    bpy.ops.wm.open_mainfile(filepath=str(source))
    structural=weights_and_bones()
    result={'blender':bpy.app.version_string,'source_sha256':before,'base_sha256':BASE_SHA256,
            'native_fingerprint':digest(candidate),'rig_fingerprint':digest(structural),'poses':{},
            'review_status':'Technical validation only; see README.md for maintained rig.blend approval'}
    for name in POSES:
        result['poses'][name],coords=pose_check(name)
        if name=='Rest':
            rest_error=max((v-Vector(original['meshes'][key]['vertices'][i])).length for key,vv in coords.items() for i,v in enumerate(vv))
            assert rest_error<2e-6,('Rest deformation',rest_error)
            result['rest_error']=rest_error
    # Return to rest must reproduce evaluated geometry, not merely zero channels.
    returned,_=pose_check('Rest')
    assert returned==result['poses']['Rest'],'Rest-return drift'
    if negative:
        # Restore the exact old reverse fold, then require actual geometry
        # checks (not counts or a changed expected hash) to reject it.
        originals={}
        for side in (-1,1):
            obj=bpy.data.objects['ArmHand.'+str(side)]
            originals[obj.name]=obj.data;obj.data=obj.data.copy()
            selected=[v for v in obj.data.vertices if abs(abs(v.co.x)-.754)<1e-6 and abs(v.co.z-1.373)<1e-6]
            assert len(selected)==3,'Palm repair landmarks'
            for v in selected:v.co.x-=side*.007
            obj.data.update()
        apply_pose('Cheering',use_action=True)
        coords,_=evaluated()
        try:arm_intersections(coords)
        except AssertionError as error:
            assert 'Arm/hand self-intersection' in str(error),str(error)
            result['negative_palm_reverse_fold']='PASS'
        else:raise AssertionError('Original palm crossing accepted')
        for name,original_mesh in originals.items():
            obj=bpy.data.objects[name];damaged=obj.data;obj.data=original_mesh;bpy.data.meshes.remove(damaged)
        apply_pose('Rest',use_action=True)
        obj=bpy.data.objects['ArmHand.1']
        group=obj.vertex_groups['hand.L']
        index=next(v.index for v in obj.data.vertices if abs(v.co.x)>.8)
        group.remove([index])
        try:
            weights_and_bones()
        except AssertionError as error:
            assert 'Unweighted/non-normalized' in str(error)
            result['negative_missing_hand_weight']='PASS'
        else:
            raise AssertionError('Missing weights accepted')
        group.add([index],1.,'REPLACE')
        rig=apply_pose('Cheering')
        shirt=bpy.data.objects['Shirt']
        saved_weights=structural['weights']['Shirt']
        for v in shirt.data.vertices:
            if v.co.x>.18:
                for g in shirt.vertex_groups:
                    g.remove([v.index])
                shirt.vertex_groups['chest'].add([v.index],1.,'REPLACE')
        bpy.context.view_layer.update()
        try:
            coords,_=evaluated()
            contact_checks(rig,coords)
        except AssertionError as error:
            assert any(s in str(error) for s in ('Disconnected posed joint','Missing sleeve coverage','Sleeve penetration','Shirt/arm triangle intersections'))
            result['negative_wrong_sleeve_weights']='PASS'
        else:
            raise AssertionError('Unmoving sleeve accepted')
        for v,values in zip(shirt.data.vertices,saved_weights):
            if v.co.x>.18:
                for g in shirt.vertex_groups:
                    g.remove([v.index])
                for name,weight in values.items():
                    shirt.vertex_groups[name].add([v.index],weight,'REPLACE')
        apply_pose('Rest',use_action=True)
        assert digest(weights_and_bones())==result['rig_fingerprint'],'Negative-test restore'
        for name in POSES:
            assert pose_check(name)[0]==result['poses'][name],'Negative-test pose restore'
        apply_pose('Rest',use_action=True)
    assert sha(source)==before and sha(BASE)==BASE_SHA256,'SOURCE MUTATED'
    result['vertices']=sum(len(o.data.vertices) for o in meshes())
    result['triangles']=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes())
    result['bones']=len(bpy.data.objects['CrowdRig'].data.bones)
    result['mesh_objects']=len(meshes())
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--negative-test',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    report=new_output(args.report,'.json')
    print('RIG VALIDATION BEGIN',bpy.data.filepath,flush=True)
    result=run(args.negative_test)
    report.write_text(json.dumps(result,indent=2)+'\n')
    print('RIG VALIDATION PASS',report,result['rig_fingerprint'],flush=True)
