"""Saved framing arc, source identity, joint solid union and fixed-scene tests."""
import argparse,importlib.util,json,math,sys
from pathlib import Path
sys.dont_write_bytecode=True
import bpy
from mathutils import Vector
PACKAGE=Path(__file__).resolve().parent
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
F=module('_framing_compose',PACKAGE/'framing-compose.py')
O=module('_initial_candidate_validation',PACKAGE/'validate.py')
A=F.A;V=F.V

def arc_check():
    roots=[o for o in bpy.context.scene.objects if o.get('arc_role')]
    posts=sorted([o for o in roots if o['arc_role']=='post'],key=lambda o:o['arc_index'])
    sections=sorted([o for o in roots if o['arc_role']=='section'],key=lambda o:o['arc_index'])
    assert len(posts)==F.N+1 and len(sections)==F.N,'Arc module count'
    residual=[]
    for i,post in enumerate(posts):
        assert post['arc_index']==i and len(post.children)==3,'Incomplete post assembly'
        assert all(not o.hide_render for o in post.children),'Hidden post component'
        assert {o.data.name.split('.')[0] for o in post.children}=={'Framing | post stone pier','Framing | post warm metal bezel','Framing | post inset amber lens'},'Missing post component'
        radial=post.location-F.CENTER;residual.append(abs(radial.length-F.RADIUS))
        assert residual[-1]<1e-5 and abs(post.location.z-F.CENTER.z)<1e-6,'Not circular'
        theta=math.atan2(radial.y,radial.x)
        assert abs(theta-i*F.DELTA)<1e-6,'Not full semicircle'
        inward=post.rotation_euler.to_matrix()@Vector((0,-1,0))
        assert inward.dot(-radial.normalized())>.99999,'Post lens not facing interior'
    # Explicit ordered full arc, including complete terminal posts.
    pattern=[]
    for i in range(F.N):pattern.extend(['post','section'])
    pattern.append('post')
    assert [p['role'] for p in F.placements()]==pattern
    samples=0;minimum_overlap=100
    for i,section in enumerate(sections):
        assert len(section.children)==1 and 'long' in section['source_object'],'Wrong section module'
        midpoint=(posts[i].location+posts[i+1].location)/2
        assert (section.location-midpoint).length<1e-5,'Section chord placement'
        chord=(posts[i+1].location-posts[i].location).length
        assert abs(chord-F.PITCH)<1e-5,'Arc pitch'
        minimum_overlap=min(minimum_overlap,(2.8+.70-chord)/2)
        direction=section.rotation_euler.to_matrix()@Vector((1,0,0))
        normal=section.rotation_euler.to_matrix()@Vector((0,1,0))
        wall_tree=O.make_tree(section.children[0])
        for post,sign in ((posts[i],1),(posts[i+1],-1)):
            post_tree=O.make_tree(next(o for o in post.children if 'stone pier' in o['source_object']))
            joint=section.location+sign*1.4*direction
            # Cover wall interior through the joint into the post's side cheek.
            # Do not demand solid fill deep inside the source's intentional
            # front lamp pocket, which is an inset cavity, not a wall gap.
            for along in (-.24,-.12,-.06,0,.04):
                for across in (-.22,-.11,0,.11,.22):
                    for height in (.20,.40,.75,.95):
                        point=joint+sign*along*direction+across*normal+Vector((0,0,height))
                        assert O.inside(wall_tree,point) or O.inside(post_tree,point),('Open section-post joint',i,sign,along,across,height)
                        samples+=1
    return {'sections':len(sections),'complete_posts':len(posts),'post_drawables':3*len(posts),
            'total_drawables':len(sections)+3*len(posts),'ordered_pattern':pattern,
            'center':list(F.CENTER),'radius':F.RADIUS,'arc_degrees':180,'post_interval_degrees':180/F.N,
            'maximum_radius_residual':max(residual),'minimum_nominal_body_overlap':minimum_overlap,
            'actual_evaluated_solid_joint_samples':samples,'opening':'foreground -Y'}

def run(report,negative):
    source=Path(bpy.data.filepath).resolve();before=A.sha(source);F.protected()
    bpy.ops.wm.open_mainfile(filepath=str(F.INITIAL));bpy.context.view_layer.update()
    baseline=V.digest(F.nonframing_state())
    bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.view_layer.update()
    frozen=V.digest(F.nonframing_state());assert frozen==baseline,'Nonframing scene differs from initial'
    assert not bpy.data.libraries and not bpy.data.images
    identity=O.identity(PACKAGE/'initial/highway.blend')
    bpy.context.view_layer.update();assert V.digest(F.nonframing_state())==baseline
    arc=arc_check();clear_lanes=O.lanes();records=V.geometry()
    # Actual source playfield vertices, not just lane centers, fit inside the
    # circle. Its foreground half is deliberately open, not a second half-ring.
    graph=bpy.context.evaluated_depsgraph_get();maximum_playfield_radius=0;minimum_framing_radius=1000
    for o in bpy.context.scene.objects:
        if o.get('review_asset') not in ('platform','highway','endcaps','framing'):continue
        if o.type not in ('MESH','CURVE'):continue
        ev=o.evaluated_get(graph);mesh=ev.to_mesh()
        try:
            if o.get('review_asset')=='framing':
                outward=o.parent.location-F.CENTER;outward.z=0;outward.normalize()
            for v in mesh.vertices:
                p=ev.matrix_world@v.co
                radial=math.hypot(p.x-F.CENTER.x,p.y-F.CENTER.y)
                # A linear support projection bounds EVERY point of each
                # polygon, whereas minimum vertex radius alone would not.
                if o.get('review_asset')=='framing':minimum_framing_radius=min(minimum_framing_radius,(p-F.CENTER).dot(outward))
                else:maximum_playfield_radius=max(maximum_playfield_radius,radial)
        finally:ev.to_mesh_clear()
    assert maximum_playfield_radius<F.RADIUS-.6,'Arc intrudes into playing footprint'
    assert minimum_framing_radius>maximum_playfield_radius,'Framing overlaps playing footprint'
    result={'pass':True,'blender':bpy.app.version_string,'scene_sha256':before,'initial_sha256':F.INITIAL_SHA,
        'source_sha256':{k:v[1] for k,v in A.SOURCES.items()},'nonframing_semantic_fingerprint':baseline,
        'source_identity_fingerprint':identity,'arc':arc,'unobstructed_lane_rays':clear_lanes,
        'minimum_playfield_centerline_plan_clearance':F.RADIUS-maximum_playfield_radius,
        'evaluated_framing_to_playfield_radial_clearance_lower_bound':minimum_framing_radius-maximum_playfield_radius,
        'geometry_fingerprint':V.digest(records),'framing_bounds':V.aggregate([r for r in records.values() if r['asset']=='framing'],'bounds')}
    if negative:
        negatives={}
        post=next(o for o in bpy.context.scene.objects if o.get('arc_role')=='post' and o['arc_index']==1)
        saved=post.location.copy();post.location.x+=.2;bpy.context.view_layer.update()
        try:arc_check()
        except AssertionError:negatives['noncircular_post_rejected']=True
        else:raise AssertionError('Noncircle test accepted')
        finally:post.location=saved;bpy.context.view_layer.update()
        lens=next(o for o in post.children if 'amber lens' in o['source_object']);saved_hide=lens.hide_render;lens.hide_render=True
        try:arc_check()
        except AssertionError as e:
            assert 'Hidden post component' in str(e);negatives['missing_visible_post_component_rejected']=True
        else:raise AssertionError('Incomplete post test accepted')
        finally:lens.hide_render=saved_hide
        section=next(o for o in bpy.context.scene.objects if o.get('arc_role')=='section' and o['arc_index']==0)
        mesh=section.children[0];saved=mesh.location.copy();mesh.location.x+=.6;bpy.context.view_layer.update()
        try:arc_check()
        except AssertionError as e:
            assert 'Open section-post joint' in str(e);negatives['actual_joint_gap_rejected']=True
        else:raise AssertionError('Gap test accepted')
        finally:mesh.location=saved;bpy.context.view_layer.update()
        camera=bpy.context.scene.camera;saved=camera.location.copy();camera.location.z+=.1;bpy.context.view_layer.update()
        assert V.digest(F.nonframing_state())!=baseline;negatives['changed_nonframing_camera_rejected']=True
        camera.location=saved;bpy.context.view_layer.update()
        assert V.digest(F.nonframing_state())==baseline
        assert arc_check()==arc and O.lanes()==clear_lanes and V.digest(V.geometry())==result['geometry_fingerprint'],'Negative restore drift'
        result['negative_tests']=negatives
    assert A.sha(source)==before;F.protected()
    report.write_text(json.dumps(result,indent=2)+'\n');print('FRAMING VALIDATION SUCCESS',report,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--report',type=Path,required=True);p.add_argument('--negative-test',action='store_true')
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);print('FRAMING VALIDATION ATTEMPT',bpy.data.filepath,flush=True)
    run(F.output(args.report,'.json'),args.negative_test)
