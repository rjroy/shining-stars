"""Read-only source identity, placement/projection/occlusion and negative tests."""
import argparse
import hashlib
import json
import math
import sys
sys.dont_write_bytecode=True
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector,Euler
sys.path.insert(0,str(Path(__file__).resolve().parent))
import assemble as A


def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def flat(m):return [c for row in m for c in row]


def material_signature(mat):
    nodes=[]
    for node in mat.node_tree.nodes:
        inputs=[]
        for socket in node.inputs:
            if not hasattr(socket,'default_value'):continue
            value=socket.default_value
            if not isinstance(value,(str,int,float,bool)) and value is not None:value=list(value)
            inputs.append([socket.identifier,value])
        extra={}
        for field in ('operation','blend_type','noise_dimensions','feature','distance','interpolation'):
            if hasattr(node,field):extra[field]=getattr(node,field)
        if hasattr(node,'color_ramp'):extra['color_ramp']=[[e.position,list(e.color)] for e in node.color_ramp.elements]
        nodes.append([node.name,node.bl_idname,inputs,extra])
    return digest([list(mat.diffuse_color),nodes,[[l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier] for l in mat.node_tree.links]])


def source_signatures(objects):
    data_cache={};mat_cache={};result={}
    for o in objects:
        data=o.data
        if data is not None and data not in data_cache:
            if o.type=='MESH':
                value={'vertices':[list(v.co) for v in data.vertices],
                       'edges':[list(e.vertices) for e in data.edges],
                       'polygons':[[list(p.vertices),p.material_index,p.use_smooth] for p in data.polygons],
                       'weights':[[[g.group,g.weight] for g in v.groups] for v in data.vertices]}
            elif o.type=='CURVE':
                value={'resolution':data.resolution_u,'bevel_depth':data.bevel_depth,'bevel_resolution':data.bevel_resolution,
                       'dimensions':data.dimensions,'fill_mode':data.fill_mode,'splines':[]}
                for s in data.splines:
                    value['splines'].append([s.type,s.use_cyclic_u,s.resolution_u,
                        [[list(p.co),list(p.handle_left),list(p.handle_right),p.radius,p.tilt] for p in s.bezier_points],
                        [[list(p.co),p.radius,p.tilt] for p in s.points]])
            elif o.type=='ARMATURE':
                value={b.name:[b.parent.name if b.parent else None,b.use_connect,b.use_deform,flat(b.matrix_local)] for b in data.bones}
            else:raise AssertionError(('Unexpected source data',o.name,o.type))
            data_cache[data]=digest(value)
        materials=[]
        for slot in o.material_slots if o.type in ('MESH','CURVE') else []:
            m=slot.material
            if m not in mat_cache:mat_cache[m]=material_signature(m)
            materials.append(mat_cache[m])
        modifiers=[]
        for mod in o.modifiers:
            record={'type':mod.type,'viewport':mod.show_viewport,'render':mod.show_render}
            for field in ('width','segments','limit_method','angle_limit','affect','use_clamp_overlap','weight',
                          'keep_sharp','mode','use_deform_preserve_volume','use_vertex_groups','use_bone_envelopes'):
                if hasattr(mod,field):record[field]=getattr(mod,field)
            modifiers.append(record)
        result[o.name]={'type':o.type,'data':data_cache.get(data),'materials':materials,'modifiers':modifiers,
                        'vertex_groups':[g.name for g in o.vertex_groups] if o.type=='MESH' else [],
                        'pose_definitions':o.get('pose_definitions')}
    return result


def verify_identity():
    current=[o for o in bpy.data.objects if o.get('review_asset')]
    signatures=source_signatures(current);references={}
    for key in A.SOURCES:
        print('READ-ONLY IDENTITY REFERENCE',key,flush=True)
        cols,objects=A.load_asset(key)
        bpy.context.view_layer.update()
        references[key]=source_signatures(objects)
        originals={o.name:o for o in objects}
        for o in current:
            if o['review_asset']==key:
                assert signatures[o.name]==references[key][o['source_object']],('Source geometry/material/rig mismatch',o.name)
                ref=originals[o['source_object']]
                assert (o.parent.get('source_object') if o.parent else None)==(ref.parent.name if ref.parent else None),('Source hierarchy changed',o.name)
                # Only asset/module/character ROOT transforms may change. The
                # platform junction is retained exactly, not just its broad box.
                if ref.parent or key in ('platform','endcaps','highway'):
                    assert max(abs(a-b) for a,b in zip(flat(o.matrix_basis),flat(ref.matrix_basis)))<1e-7,('Unapproved local transform',o.name)
                else:
                    assert max(o.scale)-min(o.scale)<1e-7 and min(o.scale)>0,('Nonuniform/squashed asset',o.name)
        for o in objects:bpy.data.objects.remove(o,do_unlink=True)
        for c in cols:bpy.data.collections.remove(c)
    return digest({o.name:signatures[o.name] for o in current})


def geometry():
    """Actual evaluated vertices, not object boxes or guessed screen extents."""
    scene=bpy.context.scene;graph=bpy.context.evaluated_depsgraph_get();camera=scene.camera
    projection=np.array(camera.calc_matrix_camera(graph,x=1600,y=900))@np.array(camera.matrix_world.inverted())
    result={}
    for o in sorted(scene.objects,key=lambda o:o.name):
        if o.type not in ('MESH','CURVE') or o.name=='Review.Ground':continue
        ev=o.evaluated_get(graph);mesh=ev.to_mesh()
        try:
            coords=np.empty(len(mesh.vertices)*3,dtype=np.float64);mesh.vertices.foreach_get('co',coords);coords=coords.reshape((-1,3))
            assert np.isfinite(coords).all(),o.name
            local=np.column_stack((coords,np.ones(len(coords))))
            world=local@np.array(ev.matrix_world).T
            clip=world@projection.T
            assert np.all(clip[:,3]>0),('Geometry behind camera',o.name)
            ndc=clip[:,:2]/clip[:,3,None];screen=(ndc+1)*.5
            result[o.name]={'asset':o['review_asset'],'instance':o.get('instance_id'),
                            'bounds':[world[:,:3].min(axis=0).tolist(),world[:,:3].max(axis=0).tolist()],
                            'screen':[screen.min(axis=0).tolist(),screen.max(axis=0).tolist()],
                            'vertices':len(coords),'triangles':sum(len(p.vertices)-2 for p in mesh.polygons),
                            'evaluated_fingerprint':hashlib.sha256(np.round(world[:,:3],7).tobytes()).hexdigest()}
        finally:ev.to_mesh_clear()
    return result


def aggregate(records,field):
    records=list(records);assert records
    low=np.array([r[field][0] for r in records]).min(axis=0).tolist()
    high=np.array([r[field][1] for r in records]).max(axis=0).tolist()
    return [low,high]


def camera_check(records):
    camera=bpy.context.scene.camera
    assert abs(camera.location.x)<1e-6 and camera.location.y<-2.8 and camera.location.z>1.15,'Camera not player-side centered'
    forward=camera.rotation_euler.to_matrix()@Vector((0,0,-1))
    assert forward.y>.9,'Camera not aimed down road'
    for key in ('platform','endcaps','highway','city'):
        box=aggregate((r for r in records.values() if r['asset']==key),'screen')
        assert min(box[0])>=0 and max(box[1])<=1,('Landscape asset crop',key,box)


def crowd_check(records):
    camera=bpy.context.scene.camera;result={}
    for iid,variant,pose,x,y,scale in A.CROWD:
        objects=[o for o in bpy.context.scene.objects if o.get('instance_id')==iid]
        root=next(o for o in objects if o.get('source_role')=='NeutralBase')
        rig=next(o for o in objects if o.type=='ARMATURE')
        assert pose!='Rest' and rig['review_pose']==pose and rig.animation_data.action is not None,'Rest/missing crowd pose'
        definitions=json.loads(rig['pose_definitions'])
        for pb in rig.pose.bones:
            q=Euler(tuple(math.radians(v) for v in definitions[pose].get(pb.name,(0,0,0))),'XYZ').to_quaternion()
            rest=pb.bone.matrix_local.to_quaternion();q=rest.inverted()@q@rest
            assert min((pb.rotation_quaternion-q).magnitude,(pb.rotation_quaternion+q).magnitude)<2e-6,('Pose/action mismatch',iid,pb.name)
            assert pb.location.length<1e-6 and (pb.scale-Vector((1,1,1))).length<1e-6
        forward=root.matrix_world.to_3x3()@Vector((0,-1,0));forward.z=0;forward.normalize()
        target=camera.location-root.location;target.z=0;target.normalize()
        facing=forward.dot(target)
        assert facing>.98,('Audience not facing player',iid,facing)
        box=aggregate((r for r in records.values() if r['instance']==iid),'bounds')
        assert (box[1][0]<-6.2 if x<0 else box[0][0]>6.2),('Audience lane overlap',iid,box)
        assert abs(box[0][2]-A.GROUND_Z)<1e-5,('Floating audience',iid,box)
        assert 1.65<box[1][2]-box[0][2]<2.10,('Audience scale outlier',iid,box)
        for o in objects:
            if o.type=='MESH':
                assert len(o.modifiers)==1 and o.modifiers[0].type=='ARMATURE' and o.modifiers[0].object==rig
                assert o.parent==root
        screen=aggregate((r for r in records.values() if r['instance']==iid),'screen')
        assert min(screen[0])>=0 and max(screen[1])<=1,('Cropped audience',iid,screen)
        result[iid]={'variant':variant,'pose':pose,'location':list(root.location),'scale':list(root.scale),
                     'rotation':list(root.rotation_euler),'facing_dot':facing,'bounds':box,'screen':screen,
                     'height_pixels':900*(screen[1][1]-screen[0][1])}
    assert len([o for o in bpy.context.scene.objects if o.type=='ARMATURE'])==10,'Crowd count/orphan rig'
    return result


def framing_check(records):
    result={}
    for side in ('left','right'):
        roots=sorted((o for o in bpy.context.scene.objects if o.get('review_asset')=='framing' and not o.parent and side in o['source_object']),key=lambda o:o.location.y)
        assert len(roots)==3
        boxes=[]
        for root in roots:
            children=[o.name for o in root.children]
            box=aggregate((records[n] for n in children),'bounds');boxes.append(box)
        gaps=[b[0][1]-a[1][1] for a,b in zip(boxes,boxes[1:])]
        assert min(gaps)>0,('Closed framing gap',side,gaps)
        crowd=aggregate((r for r in records.values() if r['instance'] and r['instance'].startswith('L' if side=='left' else 'R')),'bounds')
        lateral=(crowd[0][0]-max(b[1][0] for b in boxes)) if side=='left' else (min(b[0][0] for b in boxes)-crowd[1][0])
        assert lateral>0,('Framing inside audience',side,lateral)
        result[side]={'gaps':gaps,'lateral_clearance_to_crowd':lateral,'boxes':boxes}
    return result


def fit_and_occlusion(records):
    scene=bpy.context.scene;graph=bpy.context.evaluated_depsgraph_get();camera=scene.camera
    bounds={key:aggregate((r for r in records.values() if r['asset']==key),'bounds') for key in A.SOURCES}
    for key,expected in [('platform',[[-6,-2.8,-.45],[6,2.7,.695]]),
                         ('endcaps',[[-6.98,-2.8,-.65],[6.98,2.7,1.15]]),
                         ('highway',[[-6,2.535,-.30],[6,20.7,.505]])]:
        assert np.max(np.abs(np.array(bounds[key])-expected))<.002,('Assembly junction/bounds changed',key,bounds[key])
    assert bounds['city'][0][1]>bounds['highway'][1][1]+10,'City not behind road'
    tested=0
    for center in (-4.5,-1.5,1.5,4.5):
        for offset in (-1.25,-.625,0,.625,1.25):
            for y in np.linspace(2.85,20.5,21):
                target=Vector((center+offset,float(y),.445));direction=(target-camera.location).normalized()
                hit,point,normal,index,o,matrix=scene.ray_cast(graph,camera.location,direction)
                assert hit and o.get('review_asset')=='highway',('Lane occluded',center,offset,float(y),o.name if o else None)
                tested+=1
    face_results={}
    for iid,variant,pose,x,y,scale in A.CROWD:
        rig=next(o for o in scene.objects if o.type=='ARMATURE' and o.get('instance_id')==iid)
        head=rig.pose.bones['head'];delta=head.matrix@head.bone.matrix_local.inverted()
        target=rig.matrix_world@delta@Vector((0,-.080,1.654))
        hit,point,normal,index,o,matrix=scene.ray_cast(graph,camera.location,(target-camera.location).normalized())
        assert hit and o.get('instance_id')==iid,('Audience face occluded by other asset',iid,o.name if o else None)
        face_results[iid]=o['source_object']
    return {'bounds':bounds,'unobstructed_lane_rays':tested,'visible_face_rays':face_results}


def composition():
    bpy.context.view_layer.update();records=geometry();camera_check(records)
    crowd=crowd_check(records);framing=framing_check(records);fit=fit_and_occlusion(records)
    screens={key:aggregate((r for r in records.values() if r['asset']==key),'screen') for key in A.SOURCES}
    # Literal 800x900 center crop of 1600x900, x=400..1199. Report losses,
    # do not move camera/geometry or convert a crop failure into a fit claim.
    crop={key:{'clipped':box[0][0]<.25 or box[1][0]>.75,
               'rectangle_pixels':[[1600*box[0][0]-400,900*(1-box[1][1])],
                                   [1600*box[1][0]-400,900*(1-box[0][1])]]} for key,box in screens.items()}
    used={s.material for o in bpy.context.scene.objects if o.type in ('MESH','CURVE') for s in o.material_slots}
    result={'camera':{'matrix':flat(bpy.context.scene.camera.matrix_world),'lens':bpy.context.scene.camera.data.lens,
                      'sensor_width':bpy.context.scene.camera.data.sensor_width,'resolution':[1600,900]},
            'crowd':crowd,'framing':framing,'fit':fit,'screen_rectangles_normalized_bottom_left':screens,
            'center_crop_800x900':crop,'drawable_objects':len(records),'placed_triangles':sum(r['triangles'] for r in records.values()),
            'ground_extra_triangles':2,'used_materials_including_ground':len(used),
            'placed_geometry_fingerprint':digest(records)}
    return result,records


def negatives():
    result={};scene=bpy.context.scene
    def rejected(name,fn,text):
        try:fn()
        except AssertionError as error:
            assert text in str(error),(name,str(error));result[name]='PASS'
        else:raise AssertionError('Negative test accepted: '+name)
    camera=scene.camera;saved=camera.data.lens;camera.data.lens=120
    rejected('camera_crops_highway',lambda:camera_check(geometry()),'Landscape asset crop');camera.data.lens=saved
    root=bpy.data.objects['crowd.L01::NeutralBase'];saved=root.rotation_euler.copy();root.rotation_euler.z+=math.pi;scene.frame_set(1)
    rejected('back_facing_spectator',lambda:crowd_check(geometry()),'Audience not facing player');root.rotation_euler=saved
    saved=root.location.copy();root.location.x=0;root.rotation_euler.z=0;scene.frame_set(1)
    rejected('spectator_in_lanes',lambda:crowd_check(geometry()),'Audience lane overlap')
    root.location=saved;root.rotation_euler.z=math.atan2(-saved.x,saved.y-A.CAMERA_POSITION[1])
    post=next(o for o in scene.objects if o.get('review_asset')=='framing' and not o.parent and 'left post' in o['source_object'])
    saved=post.location.copy();post.location.y=4.;scene.frame_set(1)
    rejected('closed_framing_gap',lambda:framing_check(geometry()),'Closed framing gap');post.location=saved
    bpy.context.view_layer.update()
    return result


def run(negative=False):
    source=Path(bpy.data.filepath);before=A.sha(source);A.check_sources()
    assert len([o for o in bpy.context.scene.objects if o.type=='CAMERA'])==1
    assert len([o for o in bpy.context.scene.objects if o.type=='LIGHT'])==4
    assert len(bpy.data.objects)==len(bpy.context.scene.objects),'Unlinked source/template objects'
    assert len(bpy.data.cameras)==1 and len(bpy.data.lights)==4,'Orphan source studio data'
    assert not any('Studio' in m.name for m in bpy.data.materials),'Orphan studio material'
    assert not bpy.data.libraries and not bpy.data.images,'External references'
    assert not any(c.name.startswith(('REFERENCE','STUDIO')) for c in bpy.data.collections),'Imported studio/reference collection'
    counts={key:len([o for o in bpy.context.scene.objects if o.get('review_asset')==key and o.type in ('MESH','CURVE')]) for key in A.SOURCES}
    assert counts=={'platform':53,'endcaps':2,'highway':14,'framing':10,'city':196,'crowd':173},('Source duplicates/ownership',counts)
    assert len(bpy.context.scene.objects)==505,'Unexpected nested/template objects'
    identity=verify_identity()
    result,_=composition();result['source_identity_fingerprint']=identity;result['source_sha256']=before
    result['sources']={k:v[1] for k,v in A.SOURCES.items()};result['blender']=bpy.app.version_string;result['asset_drawables']=counts
    if negative:
        result['negative_tests']=negatives()
        restored,_=composition()
        assert all(restored[k]==result[k] for k in restored),'Negative test restore drift'
    assert A.sha(source)==before,'Scene source mutated';A.check_sources()
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);parser.add_argument('--negative-test',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);output=A.new_output(args.report,'.json')
    print('SCENE VALIDATION BEGIN',bpy.data.filepath,flush=True)
    result=run(args.negative_test);output.write_text(json.dumps(result,indent=2)+'\n')
    print('SCENE VALIDATION PASS',output,result['placed_geometry_fingerprint'],flush=True)
