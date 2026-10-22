"""Independent current arc, ground-contact, footprint and lane checks.

Reuses the substantive evaluated-solid checks from the accepted study; no
historical candidate binaries or test-report dependencies.
"""
import json
import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import ground as G
F = G.F


def make_tree(o):
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get()); mesh = ev.to_mesh()
    try:
        return (BVHTree.FromPolygons([v.co for v in mesh.vertices], [list(p.vertices) for p in mesh.polygons]), ev.matrix_world.inverted())
    finally: ev.to_mesh_clear()


def inside(tree, point):
    tree, inverse = tree; direction = Vector((.013, 1, 0)).normalized(); count = 0; start = inverse @ point
    for _ in range(40):
        hit, normal, index, distance = tree.ray_cast(start, direction, 100)
        if hit is None: return count % 2 == 1
        count += 1; start = hit + direction * .00001
    raise AssertionError('Wall parity ray overflow')


def arc_check():
    roots = [o for o in bpy.context.scene.objects if o.get('arc_role')]
    posts = sorted([o for o in roots if o['arc_role']=='post'], key=lambda o:o['arc_index'])
    sections = sorted([o for o in roots if o['arc_role']=='section'], key=lambda o:o['arc_index'])
    assert len(posts)==F.N+1 and len(sections)==F.N, 'Arc module count'
    center = Vector((0,20,8.25)); residual = []; samples = 0; overlap = 100
    for i,post in enumerate(posts):
        assert post['arc_index']==i and len(post.children)==3, 'Incomplete post assembly'
        assert all(not o.hide_render for o in post.children), 'Hidden post component'
        assert {o.data.name.split('.')[0] for o in post.children}=={'Framing | post stone pier','Framing | post warm metal bezel','Framing | post inset amber lens'}, 'Missing post component'
        radial=post.location-center; residual.append(abs(radial.length-F.RADIUS))
        assert residual[-1]<1e-5 and abs(post.location.z-center.z)<1e-6, 'Not circular'
        assert abs(math.atan2(radial.y,radial.x)-i*F.DELTA)<1e-6, 'Not full semicircle'
        inward=post.rotation_euler.to_matrix()@Vector((0,-1,0))
        assert inward.dot(-radial.normalized())>.99999, 'Post lens not facing interior'
    for i,section in enumerate(sections):
        assert len(section.children)==1 and 'long' in section['source_object'], 'Wrong section module'
        assert (section.location-(posts[i].location+posts[i+1].location)/2).length<1e-5, 'Section chord placement'
        chord=(posts[i+1].location-posts[i].location).length
        assert abs(chord-F.PITCH)<1e-5, 'Arc pitch'
        overlap=min(overlap,(2.8+.70-chord)/2)
        direction=section.rotation_euler.to_matrix()@Vector((1,0,0)); normal=section.rotation_euler.to_matrix()@Vector((0,1,0))
        wall_tree=make_tree(section.children[0])
        for post,sign in ((posts[i],1),(posts[i+1],-1)):
            post_tree=make_tree(next(o for o in post.children if 'stone pier' in o['source_object']))
            joint=section.location+sign*1.4*direction
            for along in (-.24,-.12,-.06,0,.04):
                for across in (-.22,-.11,0,.11,.22):
                    for height in (.20,.40,.75,.95):
                        point=joint+sign*along*direction+across*normal+Vector((0,0,height))
                        assert inside(wall_tree,point) or inside(post_tree,point), ('Open section-post joint',i,sign,along,across,height)
                        samples+=1
    return {'sections':len(sections),'complete_posts':len(posts),'radius':F.RADIUS,'center':list(center),
            'maximum_radius_residual':max(residual),'minimum_nominal_body_overlap':overlap,'actual_evaluated_solid_joint_samples':samples}


def ground_checks():
    scene=bpy.context.scene; m=json.loads(scene['ground_revision'])
    plaza=bpy.data.objects[G.PLAZA]; world=bpy.data.objects['Review.Ground']
    city=[o for o in scene.objects if o.get('review_asset')=='city']
    city_bounds=G.bounds(city); lower_z=G.bounds([world])[0][2]
    assert abs(city_bounds[0][2]-lower_z)<2e-6, 'City base not on lower world ground'
    floors=[o.name for o in city if o.type=='MESH' and abs(G.bounds([o])[0][2]-city_bounds[0][2])<2e-6]
    assert any('Infrastructure.MasonryAndStreets' in name for name in floors), 'Foundation datum not verified'
    assert abs(lower_z-m['world_ground_z'])<1e-8, 'World ground moved'
    assert tuple(plaza.rotation_euler)==(0,0,0) and tuple(plaza.scale)==(1,1,1), 'Disk rotation/scale changed'
    assert max(abs(a-b) for a,b in zip(plaza.location,(*m['plaza_center_xy'],m['plaza_elevation'])))<2e-6, 'Wrong local-ground elevation or center'
    assert len(plaza.data.materials)==1 and plaza.data.materials[0]==world.data.materials[0], 'Ground material not reused'
    assert not plaza.modifiers and len(plaza.data.vertices)==G.SEGMENTS+1 and len(plaza.data.polygons)==G.SEGMENTS, 'New structural geometry'
    assert all(len(p.vertices)==3 and p.normal.z>.99999 and p.area>0 for p in plaza.data.polygons), 'Disk triangles invalid'
    assert all(abs(v.co.z)<1e-8 for v in plaza.data.vertices), 'Disk thickness introduced'
    radius=m['plaza_radius']; radii=[math.hypot(v.co.x,v.co.y) for v in list(plaza.data.vertices)[1:]]
    assert max(abs(r-radius) for r in radii)<2e-6, 'Disk extends beyond frame radius'
    frame=[o for o in scene.objects if o.get('review_asset')=='framing']
    assert abs(G.bounds(frame)[0][2]-plaza.location.z)<2e-6, 'Frame interior ground changed'
    footprints={}
    for asset in ('platform','endcaps','highway'):
        maximum=max(math.hypot(p[0]-plaza.location.x,p[1]-plaza.location.y) for p in G.evaluated_points([o for o in scene.objects if o.get('review_asset')==asset]))
        assert maximum<radius-.05, ('Disk fails to cover footprint',asset,maximum)
        footprints[asset]=radius-maximum
    assert city_bounds[0][1]>plaza.location.y+radius, 'New disk intersects city footprint'
    stone=[o for o in frame if o.type=='MESH' and ('masonry section' in o['source_object'] or 'stone pier' in o['source_object'])]
    trees={o:make_tree(o) for o in stone}; covered=0
    for i in range(G.SEGMENTS//2+1):
        angle=2*math.pi*i/G.SEGMENTS
        p=Vector((plaza.location.x+radius*math.cos(angle),plaza.location.y+radius*math.sin(angle),plaza.location.z+.02))
        nearby=[o for o in stone if math.hypot(o.parent.location.x-p.x,o.parent.location.y-p.y)<2.1]
        assert any(inside(trees[o],p) for o in nearby), ('Circle edge escapes existing frame foot',i)
        covered+=1
    return {'city_ground_contact_error':city_bounds[0][2]-lower_z,'lower_ground_z':lower_z,'local_ground_z':plaza.location.z,
            'two_level_separation':plaza.location.z-lower_z,'radius':radius,'footprint_margins':footprints,
            'rear_perimeter_foot_overlap_samples':covered,'circle_to_city_plan_gap':city_bounds[0][1]-(plaza.location.y+radius)}


def lane_checks():
    scene=bpy.context.scene; graph=bpy.context.evaluated_depsgraph_get(); camera=scene.camera
    group=bpy.data.objects['COMPOSITION.Playfield.ForegroundPivot']; count=0
    for center in (-4.5,-1.5,1.5,4.5):
        for offset in (-1.2,-.6,0,.6,1.2):
            for i in range(41):
                target=group.matrix_world@Vector((center+offset,3.2+i*(44.7-3.4)/40,.445))
                hit,point,normal,index,o,matrix=scene.ray_cast(graph,camera.location,(target-camera.location).normalized())
                assert hit and o.get('review_asset')=='highway', ('Lane occluded',center,offset,i,o.name if o else None)
                count+=1
    return count
