"""Read-only structural, source-lineage and posed-surface regression checks."""
import argparse
import hashlib
import json
import math
import sys
sys.dont_write_bytecode=True
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).resolve().parent))
import build as B


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def flat(matrix):
    return [v for row in matrix for v in row]


def mesh_record(o):
    return {'vertices':[list(v.co) for v in o.data.vertices],
            'edges':[list(e.vertices) for e in o.data.edges],
            'faces':[[list(p.vertices),p.material_index,p.use_smooth] for p in o.data.polygons],
            'weights':[{o.vertex_groups[g.group].name:g.weight for g in v.groups} for v in o.data.vertices]}


def material_record(o):
    result=[]
    for slot in o.material_slots:
        mat=slot.material;nodes=[]
        for n in mat.node_tree.nodes:
            inputs=[]
            for socket in n.inputs:
                if not hasattr(socket,'default_value'):continue
                value=socket.default_value
                if not isinstance(value,(str,int,float,bool)) and value is not None:value=list(value)
                inputs.append([socket.identifier,value])
            nodes.append([n.name,n.bl_idname,inputs])
        result.append([list(mat.diffuse_color),nodes,[[l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier] for l in mat.node_tree.links]])
    return result


def skeleton(rig):
    return {b.name:[b.parent.name if b.parent else None,b.use_connect,b.use_deform,flat(b.matrix_local),b.length] for b in rig.data.bones}


def topology(o):
    mesh=o.data;mesh.calc_loop_triangles()
    assert not mesh.shape_keys
    assert all(math.isfinite(c) for v in mesh.vertices for c in v.co),('Nonfinite',o.name)
    assert all(t.area>1e-12 for t in mesh.loop_triangles),('Rest degenerate triangle',o.name)
    assert all(p.area>1e-12 for p in mesh.polygons),('Rest degenerate face',o.name)
    assert all(math.isfinite(c) for p in mesh.polygons for c in p.normal),('Normals',o.name)
    bm=bmesh.new();bm.from_mesh(mesh)
    try:
        assert not any(e.is_wire or len(e.link_faces)>2 for e in bm.edges),('Nonmanifold interior',o.name)
        assert not any(e.is_manifold and not e.is_contiguous for e in bm.edges),('Winding',o.name)
        boundaries=sum(e.is_boundary for e in bm.edges)
        if o['source_role'].startswith('ArmHand'):assert boundaries==0,('Open hand',o.name)
        if o['source_role']=='Shirt':assert boundaries==52,('Garment boundary changed',o.name,boundaries)
        if o['source_role']=='Hair' and o['character_id']!='A':assert boundaries==40,('Hair cap boundary',o.name,boundaries)
        return {'vertices':len(mesh.vertices),'triangles':len(mesh.loop_triangles),'boundary_edges':boundaries}
    finally:bm.free()


def weights(cid):
    rig=B.obj(cid,'CrowdRig')
    for o in B.members(cid):
        if o.type!='MESH':continue
        assert len(o.modifiers)==1 and o.modifiers[0].type=='ARMATURE'
        mod=o.modifiers[0]
        assert mod.object==rig and mod.use_deform_preserve_volume and mod.use_vertex_groups and not mod.use_bone_envelopes
        assert o.parent==B.obj(cid,'NeutralBase'),('Parent',o.name)
        for v in o.data.vertices:
            ww={o.vertex_groups[g.group].name:g.weight for g in v.groups}
            assert ww and abs(sum(ww.values())-1)<2e-6,('Unweighted/non-normalized',o.name,v.index)
            assert all(n in rig.data.bones and rig.data.bones[n].use_deform and math.isfinite(w) and 0<w<=1 for n,w in ww.items())
            if o['source_role'] in ('Hair','Mouth','Ears') or o['source_role'].startswith(('BrowLid','Iris','EyeWhite')):
                assert ww=={'head':1.},('Face/hair weights',o.name)


def evaluated(cid):
    root=B.obj(cid,'NeutralBase');inverse=root.matrix_world.inverted()
    graph=bpy.context.evaluated_depsgraph_get();result={}
    for o in B.members(cid):
        if o.type!='MESH':continue
        ev=o.evaluated_get(graph);mesh=ev.to_mesh()
        try:
            mesh.calc_loop_triangles()
            vv=[inverse@ev.matrix_world@v.co for v in mesh.vertices]
            tt=[tuple(t.vertices) for t in mesh.loop_triangles]
            assert len(vv)==len(o.data.vertices),('Topology changed',o.name)
            assert all(math.isfinite(c) for v in vv for c in v),('Nonfinite pose',o.name)
            assert all(math.isfinite(c) for p in mesh.polygons for c in p.normal)
            assert all(p.area>1e-12 for p in mesh.polygons),('Collapsed posed face',o.name)
            # Check source tessellation independently of collinear n-gon ears.
            o.data.calc_loop_triangles()
            area=lambda t:(vv[t[1]]-vv[t[0]]).cross(vv[t[2]]-vv[t[0]]).length*.5
            assert min(area(t.vertices) for t in o.data.loop_triangles)>1e-12,('Collapsed source triangle',o.name)
            zero=[]
            for t in mesh.loop_triangles:
                if area(t.vertices)>1e-12:continue
                orig=[o.data.vertices[i].co for i in t.vertices]
                assert len(mesh.polygons[t.polygon_index].vertices)>4 and (orig[1]-orig[0]).cross(orig[2]-orig[0]).length<2e-12,('New degenerate triangle',o.name)
                zero.append(t.polygon_index)
            result[o['source_role']]={'vertices':vv,'triangles':tt,'collinear_ears':len(zero),
                                      'tree':BVHTree.FromPolygons(vv,tt,all_triangles=True)}
        finally:ev.to_mesh_clear()
    return result


def crossings(surface, interiors=False):
    vv,tt=surface['vertices'],surface['triangles']
    if not interiors:
        return [(a,b) for a,b in surface['tree'].overlap(surface['tree']) if a<b and not set(tt[a])&set(tt[b])]
    contracted=[]
    for tri in tt:
        center=sum((vv[i] for i in tri),Vector())/3
        contracted.extend(center+(vv[i]-center)*.9999 for i in tri)
    tree=BVHTree.FromPolygons(contracted,[tuple(range(i,i+3)) for i in range(0,len(contracted),3)],all_triangles=True)
    return [(a,b) for a,b in tree.overlap(tree) if a<b]


def arm_checks(cid, surfaces):
    result={}
    for side in (-1,1):
        name='ArmHand.'+str(side);surface=surfaces[name]
        values={'nonadjacent':len(crossings(surface)),'face_interiors':len(crossings(surface,True))}
        assert not any(values.values()),('Arm/hand crossing',cid,name,values)
        result[name]=values
    return result


def contacts(cid,surfaces):
    rig=B.obj(cid,'CrowdRig');shirt=surfaces['Shirt'];result={}
    # No hidden nude torso exists in the source. Sample visible coverage just
    # beneath the hem rather than accepting a cropped shirt floating over jeans.
    hem=min(v.co.z for v in B.obj(cid,'Shirt').data.vertices)
    for x in (-.12,-.08,-.04,0,.04,.08,.12):
        origin=Vector((x,-.4,hem-.002));direction=Vector((0,1,0))
        assert any(surfaces[role]['tree'].ray_cast(origin,direction,.8)[0] is not None
                   for role in ('Trousers','Waistband')),('Uncovered waist gap',cid,x)
    for pb in rig.pose.bones:
        if pb.bone.use_connect:assert (pb.head-pb.parent.tail).length<2e-6,('Disconnected joint',cid,pb.name)
    for side,suffix in ((1,'L'),(-1,'R')):
        name='ArmHand.'+str(side);arm=surfaces[name]
        overlap=shirt['tree'].overlap(arm['tree'])
        assert not overlap,('Shirt/arm intersection',cid,suffix,len(overlap))
        pb=rig.pose.bones['upper_arm.'+suffix];delta=pb.matrix@pb.bone.matrix_local.inverted()
        clear=[]
        # Stations remain inside both the shorter tee and longer overshirt.
        for x in (.254,.285,.310):
            if x==.254:
                indices=[v.index for v in B.obj(cid,name).data.vertices if abs(abs(v.co.x)-x)<1e-6]
                origin=sum((arm['vertices'][i] for i in indices),Vector())/len(indices)
            else:origin=delta@Vector((side*x,-.012,1.409))
            for j in range(24):
                angle=j*math.tau/24;direction=delta.to_3x3()@Vector((0,math.sin(angle),math.cos(angle)))
                cloth=shirt['tree'].ray_cast(origin,direction,.25);skin=arm['tree'].ray_cast(origin,direction,.25)
                assert cloth[0] is not None and skin[0] is not None,('Missing sleeve coverage',cid,suffix,x,j)
                clear.append(cloth[3]-skin[3])
        assert min(clear)>.001,('Sleeve clearance',cid,suffix,min(clear))
        hand=rig.pose.bones['hand.'+suffix];hand_delta=hand.matrix@hand.bone.matrix_local.inverted()
        raw=B.obj(cid,name).data.vertices
        finger=max((arm['vertices'][v.index]-hand_delta@v.co).length for v in raw if abs(v.co.x)>.735)
        wrist_indices=[v.index for v in raw if abs(abs(v.co.x)-.687)<1e-6]
        wrist=(sum((arm['vertices'][i] for i in wrist_indices),Vector())/len(wrist_indices)-hand.head).length
        assert finger<2e-6 and wrist<.0025,('Hand/joint attachment',cid,suffix,finger,wrist)
        result[suffix]={'minimum_sleeve_clearance':min(clear),'shirt_arm_intersections':len(overlap),'finger_error':finger,'wrist_error':wrist}
    # Cloth self-crossings are rejected, unlike intended collar layering.
    self_cross=crossings(shirt)
    assert not self_cross,('Shirt self-crossing',cid,len(self_cross))
    if cid!='A':
        hair=surfaces['Hair'];head=surfaces['Head']
        overlap=hair['tree'].overlap(head['tree'])
        assert not overlap,('Hair/head intersection',cid,len(overlap))
        overlap=hair['tree'].overlap(shirt['tree'])
        assert not overlap,('Hair/cloth intersection',cid,len(overlap))
        for role in ('EyeWhite.-1','EyeWhite.1','Iris.-1','Iris.1','Mouth'):
            assert not hair['tree'].overlap(surfaces[role]['tree']),('Hair/face intersection',cid,role)
        # Front-facing eye/mouth visibility: ray from each posed surface center.
        head_bone=rig.pose.bones['head'];delta=head_bone.matrix@head_bone.bone.matrix_local.inverted()
        direction=delta.to_3x3()@Vector((0,-1,0))
        for role in ('EyeWhite.-1','EyeWhite.1','Mouth'):
            vertices=surfaces[role]['vertices'];center=sum(vertices,Vector())/len(vertices)
            assert hair['tree'].ray_cast(center,direction,.4)[0] is None,('Hair occludes face',cid,role)
        if 'CollarPlacket' in surfaces:
            detail=surfaces['CollarPlacket']['tree']
            for role in ('Head','Hair','Shirt','ArmHand.-1','ArmHand.1'):
                overlap=detail.overlap(surfaces[role]['tree'])
                assert not overlap,('Collar/body intersection',cid,role,len(overlap))
    return result


def pose_check(cid,name):
    rig=B.apply_pose(cid,name);surfaces=evaluated(cid)
    assert not any(d['collinear_ears'] for d in surfaces.values()),('Retessellated zero-area ear',cid,name)
    report={'contacts':contacts(cid,surfaces),'hand_crossings':arm_checks(cid,surfaces)}
    head=rig.pose.bones['head'];delta=head.matrix@head.bone.matrix_local.inverted();attachment=0.
    for o in B.members(cid):
        role=o['source_role']
        if role in ('Hair','Mouth','Ears') or role.startswith(('BrowLid','Iris','EyeWhite')):
            attachment=max(attachment,max((surfaces[role]['vertices'][v.index]-delta@v.co).length for v in o.data.vertices))
        if role.startswith('Shoe.'):
            assert max((surfaces[role]['vertices'][v.index]-v.co).length for v in o.data.vertices)<2e-6,'Feet moved'
    assert attachment<2e-6,('Face/hair detached',cid,attachment)
    if name=='Rest':
        rest_error=max((surfaces[o['source_role']]['vertices'][v.index]-v.co).length
                       for o in B.members(cid) if o.type=='MESH' for v in o.data.vertices)
        assert rest_error<2e-6,('Rest skin drift',cid,rest_error)
        report['rest_error']=rest_error
    if name=='Calm':
        assert all(.75<rig.pose.bones['hand.'+s].head.z<1.05 for s in ('L','R')),'Calm hands not lowered'
    assert (delta.to_3x3()@Vector((0,-1,0))).dot(Vector((0,-1,0)))>.98,'Not player-facing'
    geometry={k:[[round(c,7) for c in v] for v in d['vertices']] for k,d in surfaces.items()}
    report['geometry_fingerprint']=digest(geometry)
    report['transforms']={pb.name:flat(pb.matrix) for pb in rig.pose.bones}
    report['attachment_error']=attachment
    report['collinear_ears']={k:d['collinear_ears'] for k,d in surfaces.items() if d['collinear_ears']}
    bounds=[v for d in surfaces.values() for v in d['vertices']]
    report['bounds']=[[min(v[i] for v in bounds) for i in range(3)],[max(v[i] for v in bounds) for i in range(3)]]
    B.apply_pose(cid,name,False);direct=evaluated(cid)
    assert max((v-direct[k]['vertices'][i]).length for k,d in surfaces.items() for i,v in enumerate(d['vertices']))<2e-6,('Action/direct mismatch',cid,name)
    B.apply_pose(cid,name)
    return report


def negative_tests():
    result={}
    def rejected(label,callback,text):
        try:callback()
        except AssertionError as error:
            assert text in str(error),str(error);result[label]='PASS'
        else:raise AssertionError('Negative test accepted: '+label)
    # Shared immutable hand mesh is replaced in memory, never edited in place.
    cid='B';o=B.obj(cid,'ArmHand.1');original=o.data;o.data=o.data.copy()
    try:
        for i in (233,269,394):o.data.vertices[i].co.x-=.007
        o.data.update();B.apply_pose(cid,'Cheering')
        rejected('palm_reverse_fold',lambda:arm_checks(cid,evaluated(cid)),'Arm/hand crossing')
    finally:
        damaged=o.data;o.data=original;bpy.data.meshes.remove(damaged)
    g=o.vertex_groups['hand.L'];index=next(v.index for v in o.data.vertices if v.co.x>.8)
    g.remove([index]);rejected('missing_hand_weight',lambda:weights(cid),'Unweighted/non-normalized');g.add([index],1.,'REPLACE')
    shirt=B.obj(cid,'Shirt');saved=mesh_record(shirt)['weights']
    for v in shirt.data.vertices:
        if v.co.x>.18:
            for g in shirt.vertex_groups:g.remove([v.index])
            shirt.vertex_groups['chest'].add([v.index],1.,'REPLACE')
    B.apply_pose(cid,'Cheering')
    rejected('unmoving_sleeve',lambda:contacts(cid,evaluated(cid)),'Shirt/arm intersection')
    for v,ww in zip(shirt.data.vertices,saved):
        if v.co.x>.18:
            for g in shirt.vertex_groups:g.remove([v.index])
            for name,w in ww.items():shirt.vertex_groups[name].add([v.index],w,'REPLACE')
    hair=B.obj(cid,'Hair');original=hair.data;hair.data=hair.data.copy()
    try:
        for v in hair.data.vertices:v.co.x*=.65;v.co.y*=.65
        hair.data.update();B.apply_pose(cid,'Rest')
        rejected('hair_into_skull',lambda:contacts(cid,evaluated(cid)),'Hair/head intersection')
    finally:
        damaged=hair.data;hair.data=original;bpy.data.meshes.remove(damaged)
    saved={}
    for role in ('Trousers','Waistband'):
        garment=B.obj(cid,role);saved[role]=garment.data;garment.data=garment.data.copy()
        for v in garment.data.vertices:
            if v.co.z>1.:v.co.z-=.03
        garment.data.update()
    try:
        B.apply_pose(cid,'Rest')
        rejected('cropped_waist_gap',lambda:contacts(cid,evaluated(cid)),'Uncovered waist gap')
    finally:
        for role,mesh in saved.items():
            garment=B.obj(cid,role);damaged=garment.data;garment.data=mesh;bpy.data.meshes.remove(damaged)
    B.assigned_poses()
    return result


def run(negative=False):
    source=Path(bpy.data.filepath);before=B.sha(source);B.sources()
    print('VALIDATION READ ACCEPTED SOURCE',B.SOURCE,flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(B.SOURCE))
    original={o.name:mesh_record(o) for o in bpy.data.objects if o.type=='MESH'}
    original_materials={o.name:material_record(o) for o in bpy.data.objects if o.type=='MESH'}
    bones=skeleton(bpy.data.objects['CrowdRig']);source_poses=json.loads(bpy.data.objects['CrowdRig']['pose_definitions'])
    bpy.ops.wm.open_mainfile(filepath=str(source))
    assert len(bpy.data.armatures)==3 and len([o for o in bpy.data.objects if o.type=='ARMATURE'])==3
    assert len(bpy.data.objects)==58 and len([o for o in bpy.data.objects if o.type=='MESH'])==52
    assert not bpy.data.libraries and not bpy.data.images
    assert len(bpy.data.actions)==12 and bpy.context.scene.frame_start==bpy.context.scene.frame_end==1
    report={'blender':bpy.app.version_string,'source_sha256':before,'source_hashes':B.HASHES,'characters':{}}
    all_records={}
    for cid,(_,assigned,x) in B.CHARACTERS.items():
        print('VALIDATE CHARACTER',cid,flush=True)
        rig=B.obj(cid,'CrowdRig')
        assert skeleton(rig)==bones,('Joint/rig edits',cid)
        assert json.loads(rig['pose_definitions'])=={**source_poses,'Calm':json.loads(json.dumps(B.CALM))}
        assert not any(pb.constraints for pb in rig.pose.bones)
        root=B.obj(cid,'NeutralBase');assert (root.location-Vector((x,0,0))).length<1e-6
        weights(cid);meshes=[o for o in B.members(cid) if o.type=='MESH']
        records={o['source_role']:mesh_record(o) for o in meshes}
        for role,record in records.items():
            changed=('Hair','Shirt','Mouth','CollarPlacket')+(('Trousers','Waistband') if cid=='B' else ())
            if role not in changed or cid=='A':
                assert record==original[role],('Unauthorized native change',cid,role)
            elif role in ('Shirt','Mouth','Trousers','Waistband'):
                assert record['edges']==original[role]['edges'] and record['faces']==original[role]['faces']
                assert record['weights']==original[role]['weights']
                if role=='Shirt':
                    assert all(v==record['vertices'][i] for i,v in enumerate(original[role]['vertices'])
                               if abs(v[0])<=.22 and v[2]>=1.265),'Accepted shoulder crown changed'
                if role=='Trousers':
                    assert all(v==record['vertices'][i] for i,v in enumerate(original[role]['vertices'])
                               if v[2]<=.884),'Lower trousers changed'
        if cid=='A':assert {o['source_role']:material_record(o) for o in meshes}==original_materials,'Original palette changed'
        topo={o['source_role']:topology(o) for o in meshes}
        materials={o['source_role']:material_record(o) for o in meshes}
        all_records[cid]={'meshes':records,'materials':materials,'skeleton':skeleton(rig)}
        checks={}
        for name in ('Rest','Cheering','Reaching','Calm'):
            print('VALIDATE POSE',cid,name,flush=True);checks[name]=pose_check(cid,name)
        assert pose_check(cid,'Rest')==checks['Rest'],'Rest-return drift'
        report['characters'][cid]={'assigned_pose':assigned,'topology':topo,'poses':checks,
                                 'vertices':sum(t['vertices'] for t in topo.values()),
                                 'triangles':sum(t['triangles'] for t in topo.values())}
    report['native_fingerprint']=digest(all_records)
    unique={o.data for o in bpy.data.objects if o.type=='MESH'}
    report['unique_meshes']=len(unique)
    report['unique_vertices']=sum(len(m.vertices) for m in unique)
    report['unique_triangles']=sum(sum(len(p.vertices)-2 for p in m.polygons) for m in unique)
    report['placed_vertices']=sum(c['vertices'] for c in report['characters'].values())
    report['placed_triangles']=sum(c['triangles'] for c in report['characters'].values())
    report['used_materials']=len({s.material for o in bpy.data.objects if o.type=='MESH' for s in o.material_slots})
    assert report['used_materials']==34,'Identical eye/lace materials should remain shared'
    if negative:
        report['negative_tests']=negative_tests()
        for cid in B.CHARACTERS:
            weights(cid)
            assert {o['source_role']:mesh_record(o) for o in B.members(cid) if o.type=='MESH'}==all_records[cid]['meshes'],'Negative restore native'
            for name,prior in report['characters'][cid]['poses'].items():
                assert pose_check(cid,name)==prior,('Negative restore pose',cid,name)
    B.assigned_poses();assert B.sha(source)==before,'CANDIDATE MUTATED';B.sources()
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);parser.add_argument('--negative-test',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    output=B.new_output(args.report,'.json')
    print('TRIO VALIDATION BEGIN',bpy.data.filepath,flush=True)
    result=run(args.negative_test);output.write_text(json.dumps(result,indent=2)+'\n')
    print('TRIO VALIDATION PASS',output,result['native_fingerprint'],flush=True)
