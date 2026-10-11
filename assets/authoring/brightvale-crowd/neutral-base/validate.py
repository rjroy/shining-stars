"""Reopen-check neutral geometry, per-part topology and deterministic fingerprint.

Never saves a blend. Reports require a new path. Negative tests mutate memory only.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SOURCE_HASHES={
    '../brief.md':'2fdf54bc3f8c2e3323fc63c9d388bef0ee93633218159811dfa078008abe5b35',
    '../concept-cel-shaded-candidate.webp':'1c21fefe24828f2a70f57afb12a4cea817fba02b1008ff95d6dbd950320e5a05',
}


def coordinates(obj):return [obj.matrix_world@v.co for v in obj.data.vertices]


def bounds(objects):
    vv=[v for obj in objects for v in coordinates(obj)]
    return [[round(fn(v[a] for v in vv),7) for a in range(3)] for fn in (min,max)]


def shoulder_continuity():
    """Sample actual triangle surfaces, not just landmark metadata/counts.

    Radial clearance over the covered deltoid, crown slope from clavicle to
    cuff, and the exposed upper-arm taper catch the former shelf/second bulge.
    This is a bounded local test, not exhaustive self-intersection certification.
    """
    graph=bpy.context.evaluated_depsgraph_get()
    shirt=BVHTree.FromObject(bpy.data.objects['Shirt'],graph)
    report={}
    for side in (-1,1):
        arm=BVHTree.FromObject(bpy.data.objects['ArmHand.'+str(side)],graph)
        def radius(tree,x,angle):
            direction=Vector((0,math.sin(angle),math.cos(angle)))
            hit,normal,index,distance=tree.ray_cast(Vector((side*x,-.012,1.409)),direction,.3)
            assert hit is not None,'Shoulder missing radial surface'
            return distance
        clearances=[radius(shirt,x,i*math.tau/24)-radius(arm,x,i*math.tau/24)
                    for x in (.22,.25,.28,.31,.34) for i in range(24)]
        assert min(clearances)>.001,('Shoulder garment penetration/insufficient clearance',min(clearances),clearances.index(min(clearances)))
        def crown_height(x):
            hits=[shirt.ray_cast(Vector((side*x,y*.002,1.65)),Vector((0,0,-1)),.3)[0]
                  for y in range(-50,51)]
            return max(p.z for p in hits if p is not None)
        crown=[crown_height(x) for x in (.16,.18,.20,.22,.24,.26,.28,.30,.32,.34)]
        slopes=[(b-a)/.02 for a,b in zip(crown,crown[1:])]
        assert all(-.40<s<.025 for s in slopes),'Shoulder crown ledge/rebound'
        cuff_gap=radius(shirt,.344,0)-radius(arm,.348,0)
        assert .003<cuff_gap<.017,'Shoulder cuff shelf'
        exposed=[radius(arm,x,0) for x in (.35,.37,.39,.41,.43,.45)]
        assert all(b<=a+.0002 for a,b in zip(exposed,exposed[1:])),'Second exposed deltoid bulge'
        assert max(abs(b-a)/.02 for a,b in zip(exposed,exposed[1:]))<.3,'Abrupt exposed upper-arm taper'
        report[str(side)]={'minimum_radial_clearance':min(clearances),'cuff_top_gap':cuff_gap,
                           'crown_z':crown,'exposed_top_radii':exposed}
    return report


def inspect():
    assert not bpy.context.scene['study'],'Incomplete study is not a full neutral base'
    assert set(c.name for c in bpy.data.collections)=={'NEUTRAL_CHARACTER'},'Unexpected collection'
    assert not bpy.data.armatures and not bpy.data.actions and not bpy.data.libraries and not bpy.data.images
    root=bpy.data.objects['NeutralBase']
    forward=root.matrix_world.to_3x3()@Vector((0,-1,0))
    assert forward.normalized().dot(Vector((0,-1,0)))>.999,'Facing invariant'
    objects=sorted(bpy.data.objects,key=lambda o:o.name)
    meshes=[o for o in objects if o.type=='MESH']
    assert len(meshes)==17 and len(objects)==18,'Part ownership/count'
    report={};payload={'objects':[],'meshes':[],'materials':[]}
    for obj in objects:
        assert obj.type in {'MESH','EMPTY'} and not obj.modifiers and not obj.animation_data
        assert all(math.isfinite(c) for row in obj.matrix_world for c in row)
        payload['objects'].append([obj.name,obj.parent.name if obj.parent else None,[c for row in obj.matrix_world for c in row]])
        if obj.type!='MESH':continue
        assert obj.parent==root and obj['role']
        mesh=obj.data
        assert all(math.isfinite(c) for v in mesh.vertices for c in v.co)
        assert all(0<=p.material_index<len(mesh.materials) for p in mesh.polygons)
        mesh.calc_loop_triangles()
        assert all((mesh.vertices[t.vertices[1]].co-mesh.vertices[t.vertices[0]].co).cross(
                    mesh.vertices[t.vertices[2]].co-mesh.vertices[t.vertices[0]].co).length>2e-12
                   for t in mesh.loop_triangles),('Degenerate tessellated triangle',obj.name)
        bm=bmesh.new();bm.from_mesh(mesh)
        assert all(v.link_faces for v in bm.verts),('Loose vertex',obj.name)
        assert not any(f.calc_area()<1e-12 for f in bm.faces),('Degenerate face',obj.name)
        assert not any(e.calc_length()<1e-8 for e in bm.edges),('Degenerate edge',obj.name)
        assert all(e.is_boundary or e.is_manifold for e in bm.edges),('Nonmanifold edge',obj.name)
        assert all(e.is_contiguous for e in bm.edges if e.is_manifold),('Inconsistent winding',obj.name)
        boundary={e for e in bm.edges if e.is_boundary}
        boundary_count=len(boundary);loops=0
        boundary_vertices={v for e in boundary for v in e.verts}
        assert all(sum(e.is_boundary for e in v.link_edges)==2 for v in boundary_vertices),('Branched boundary',obj.name)
        while boundary:
            pending=[boundary.pop()];loops+=1
            while pending:
                edge=pending.pop()
                for v in edge.verts:
                    for e in v.link_edges:
                        if e in boundary:boundary.remove(e);pending.append(e)
        assert loops==obj['expected_boundary_loops'],('Boundary loop count',obj.name,loops,obj['expected_boundary_loops'])
        remaining=set(bm.faces);components=0;closed_components=0
        while remaining:
            pending=[remaining.pop()];component=[];components+=1
            while pending:
                f=pending.pop();component.append(f)
                for edge in f.edges:
                    for near in edge.link_faces:
                        if near in remaining:remaining.remove(near);pending.append(near)
            if all(e.is_manifold for f in component for e in f.edges):
                volume=0
                for f in component:
                    vv=[v.co for v in f.verts]
                    volume+=sum(vv[0].dot(vv[i].cross(vv[i+1]))/6 for i in range(1,len(vv)-1))
                assert volume>1e-12,('Inverted closed component',obj.name,volume)
                closed_components+=1
        if obj['role'] in {'head','arm_hand','garment','trousers'}:
            assert components==1,('Disconnected main surface',obj.name,components)
        report[obj.name]={
            'role':obj['role'],'vertices':len(mesh.vertices),'faces':len(mesh.polygons),
            'triangles':sum(len(p.vertices)-2 for p in mesh.polygons),
            'components':components,'closed_components':closed_components,
            'boundary_edges':boundary_count,'boundary_loops':loops,
            'quads':sum(len(p.vertices)==4 for p in mesh.polygons),
            'materials':sorted({mesh.materials[p.material_index].name for p in mesh.polygons}),
            'bounds':bounds([obj]),
        }
        bm.free()
        payload['meshes'].append([obj.name,[[c for c in v.co] for v in mesh.vertices],[[list(p.vertices),p.material_index,p.use_smooth] for p in mesh.polygons]])
    bb=bounds(meshes);height=bb[1][2]-bb[0][2]
    assert 1.70<height<1.90 and abs(bb[0][2])<1e-7,'Ground/height invariant'
    assert abs(bb[0][0]+bb[1][0])<.001,'Symmetric body bounds'
    head=bpy.data.objects['Head'];hb=bounds([head])
    assert 6.2<height/(hb[1][2]-1.505)<7.3,'Head/body ratio (chin excludes joined neck)'
    assert abs(hb[0][2]-1.425)<1e-5,'Joined neck extent'
    shirt=bounds([bpy.data.objects['Shirt']]);pants=bounds([bpy.data.objects['Trousers']])
    assert pants[1][2]>shirt[0][2] and pants[1][2]-shirt[0][2]<.05,'Waist overlap'
    for side in (-1,1):
        arm=bpy.data.objects['ArmHand.'+str(side)]
        assert arm['digits']==5
        wrist=Vector(arm['wrist']);elbow=Vector(arm['elbow'])
        shoulder=Vector(arm['shoulder'])
        assert side*shoulder.x<side*elbow.x<side*wrist.x and side*wrist.x>.68,'T-pose joint ordering'
        assert max(abs(p.z-1.409) for p in (shoulder,elbow,wrist))<1e-6 and max(abs(p.y+.012) for p in (shoulder,elbow,wrist))<1e-6,'Horizontal T-pose axis'
        assert list(arm['palm_normal'])==[0,-1,0] and list(arm['thumb_direction'])==[0,0,1],'Hand orientation'
        # Check the actual wrist/elbow/upper-arm sections, not only stored joints.
        for x in (.20,.254,.314,.366,.432,.465,.490,.521,.597,.660,.687):
            section=[v for v in coordinates(arm) if abs(side*v.x-x)<1e-6]
            assert len(section)==18,('T-pose section missing',x)
            center=sum(section,Vector())/len(section)
            assert abs(center.z-1.409)<.0021 and abs(center.y+.012)<1e-6,'T-pose surface axis'
        assert min((v-wrist).length for v in coordinates(arm))<.029,'Wrist surface connection'
        assert min((v-elbow).length for v in coordinates(arm))<.045,'Elbow surface connection'
        assert shoulder.z>1.38 and abs(shoulder.x)<.23,'Arm must extend beneath shoulder, not stop at cuff'
        assert min((v-shoulder).length for v in coordinates(arm))<.061,'Shoulder surface connection'
        assert len(arm.data.vertices)<1200,'Unexpected arm topology expansion (experiment guard, not runtime budget)'
        # Corresponding opposite-side mesh coordinates must mirror exactly.
        opposite=bpy.data.objects['ArmHand.'+str(-side)]
        mirrored={tuple(round(c,7) for c in (-v.co.x,v.co.y,v.co.z)) for v in opposite.data.vertices}
        assert {tuple(round(c,7) for c in v.co) for v in arm.data.vertices}==mirrored,'Arm symmetry'
        shoe=bounds([bpy.data.objects['Shoe.'+str(side)]])
        assert shoe[1][2]-pants[0][2]>.015,'Shoe/cuff overlap'
    # Front-facing surface normals, independent of material appearance.
    for name in ('Head','Shirt'):
        obj=bpy.data.objects[name]
        front=[p for p in obj.data.polygons if p.center.y<-.065 and abs(p.center.x)<.075]
        assert front and sum(p.normal.y for p in front)<0,('Front normals',name)
    for mat in sorted(bpy.data.materials,key=lambda m:m.name):
        node=mat.node_tree.nodes.get('Principled BSDF');assert node
        payload['materials'].append([mat.name,list(mat.diffuse_color),list(node.inputs['Base Color'].default_value),node.inputs['Roughness'].default_value])
    continuity=shoulder_continuity()
    return {'blender':bpy.app.version_string,'parts':report,'bounds':bb,'height':height,'shoulder_continuity':continuity,
            'vertices':sum(p['vertices'] for p in report.values()),'triangles':sum(p['triangles'] for p in report.values()),
            'mesh_objects':len(meshes),'used_materials':sorted({m for p in report.values() for m in p['materials']}),
            'fingerprint':hashlib.sha256(json.dumps(payload,separators=(',',':')).encode()).hexdigest()}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--report',type=Path);p.add_argument('--negative-test',action='store_true')
    p.add_argument('--check-references',action='store_true')
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    if args.report and (args.report.exists() or args.report.suffix!='.json'):
        raise FileExistsError('Report requires new .json output')
    source=Path(bpy.data.filepath);before=hashlib.sha256(source.read_bytes()).hexdigest()
    result=inspect()
    if args.negative_test:
        root=bpy.data.objects['NeutralBase'];original=root.rotation_euler.z
        root.rotation_euler.z=math.pi;bpy.context.view_layer.update()
        try:inspect()
        except AssertionError as error:assert str(error)=='Facing invariant';result['negative_facing']='PASS'
        else:raise AssertionError('Negative facing accepted')
        root.rotation_euler.z=original;bpy.context.view_layer.update()
        arm=bpy.data.objects['ArmHand.1'];original_mesh=arm.data;arm.data=original_mesh.copy()
        bm=bmesh.new();bm.from_mesh(arm.data);bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm,geom=[bm.faces[-1]],context='FACES_ONLY');bm.to_mesh(arm.data);bm.free()
        try:inspect()
        except AssertionError as error:
            assert 'Boundary loop count' in str(error),str(error);result['negative_open_hand']='PASS'
        else:raise AssertionError('Missing thumb tip accepted')
        damaged=arm.data;arm.data=original_mesh;bpy.data.meshes.remove(damaged)
        original_wrist=list(arm['wrist']);arm['wrist']=[original_wrist[0],original_wrist[1],original_wrist[2]-.05]
        try:inspect()
        except AssertionError as error:
            assert 'Horizontal T-pose axis' in str(error);result['negative_lowered_wrist']='PASS'
        else:raise AssertionError('Lowered wrist accepted')
        arm['wrist']=original_wrist
        # Recreate a sleeve ledge on both sides, retaining all topology/counts.
        shirt=bpy.data.objects['Shirt'];original_mesh=shirt.data;shirt.data=original_mesh.copy()
        for vertex in shirt.data.vertices:
            if abs(vertex.co.x)>.33 and vertex.co.z>1.44:vertex.co.z+=.035
        shirt.data.update();bpy.context.view_layer.update()
        try:shoulder_continuity()
        except AssertionError as error:
            assert 'Shoulder crown ledge/rebound' in str(error) or 'Shoulder cuff shelf' in str(error),str(error)
            result['negative_sleeve_ledge']='PASS'
        else:raise AssertionError('Sleeve ledge accepted')
        damaged=shirt.data;shirt.data=original_mesh;bpy.data.meshes.remove(damaged);bpy.context.view_layer.update()
        original_mesh=arm.data;arm.data=original_mesh.copy()
        for vertex in arm.data.vertices:
            if abs(vertex.co.x-.432)<1e-6:
                vertex.co.z=1.409+(vertex.co.z-1.409)*1.55
        arm.data.update();bpy.context.view_layer.update()
        try:shoulder_continuity()
        except AssertionError as error:
            assert 'Second exposed deltoid bulge' in str(error),str(error)
            result['negative_second_deltoid']='PASS'
        else:raise AssertionError('Second deltoid accepted')
        damaged=arm.data;arm.data=original_mesh;bpy.data.meshes.remove(damaged);bpy.context.view_layer.update()
        assert inspect()['fingerprint']==result['fingerprint'],'Negative-test restore'
    if args.check_references:
        for relative,expected in SOURCE_HASHES.items():
            path=(Path(__file__).resolve().parent/relative).resolve()
            assert hashlib.sha256(path.read_bytes()).hexdigest()==expected,('Reference changed',relative)
        result['references']='PASS: relative brief and approved concept hashes'
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before,'SOURCE MUTATED'
    result['source_sha256']=before
    print(json.dumps(result,indent=2),flush=True)
    if args.report:args.report.write_text(json.dumps(result,indent=2)+'\n')
