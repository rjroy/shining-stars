"""Reopen validation against approved endcaps.blend: fit, topology and regeneration.
Does not save either .blend. Reports only to a new authorized path.
"""
import bpy, bmesh, json, sys, argparse, hashlib
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import ROOT, PLATFORM, APPROVED_SHA, bounds, output_path, sha

def snapshot(objects):
    dg=bpy.context.evaluated_depsgraph_get(); result={}
    def material_state(m):
        tree=m.node_tree
        return {'name':m.name,'diffuse':list(m.diffuse_color),
                'nodes':[[n.name,n.bl_idname,[(i.name,list(i.default_value)
                           if hasattr(i.default_value,'__len__') and not isinstance(i.default_value,str)
                           else i.default_value) for i in n.inputs if hasattr(i,'default_value')]]
                         for n in tree.nodes] if tree else [],
                'links':[[l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name]
                         for l in tree.links] if tree else []}
    for o in objects:
        ev=o.evaluated_get(dg); me=ev.to_mesh()
        data={'matrix':[list(r) for r in o.matrix_world],
              'verts':[list(v.co) for v in me.vertices],
              'faces':[[list(p.vertices),p.material_index,p.use_smooth] for p in me.polygons],
              'materials':[material_state(s.material) for s in o.material_slots]}
        result[o.name]=hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()
        ev.to_mesh_clear()
    return result

def main():
    p=argparse.ArgumentParser(); p.add_argument('--report',required=True,type=Path)
    p.add_argument('--compare',type=Path,default=ROOT/'endcaps.blend',
                   help='Geometry/material comparison; defaults to approved endcaps.blend')
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    out=output_path(a.report)
    if out.exists(): raise FileExistsError(out)
    saved=Path(bpy.data.filepath); before=sha(saved)
    assert sha(PLATFORM)==APPROVED_SHA
    scene=bpy.context.scene
    pair=list(bpy.data.collections['CANDIDATE | endcap pair | UNAPPROVED'].objects)
    ref=list(bpy.data.collections['REFERENCE | approved platform v8.3 | read-only context'].objects)
    assert len(pair)==2 and all(o.type=='MESH' for o in pair)
    assert len({s.material.name for o in pair for s in o.material_slots})==2
    assert not bpy.data.libraries and not bpy.utils.blend_paths(absolute=True,packed=False,local=True)
    checks=[]
    for o in pair:
        assert all(abs(x-1)<1e-7 for x in o.scale)
        assert not o.animation_data
        for evaluated in (False,True):
            ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get()) if evaluated else o
            me=ev.to_mesh() if evaluated else o.data
            bm=bmesh.new(); bm.from_mesh(me); bm.normal_update()
            bad=sum(not e.is_manifold for e in bm.edges)
            deg=sum(f.calc_area()<1e-10 for f in bm.faces)
            vol=bm.calc_volume(signed=True)
            normals=sum(e.is_manifold and not e.is_contiguous for e in bm.edges)
            assert bad==0 and deg==0 and normals==0 and vol>0,(o.name,bad,deg,normals,vol)
            checks.append({'object':o.name,'evaluated':evaluated,'verts':len(bm.verts),
                           'faces':len(bm.faces),'triangles':sum(len(f.verts)-2 for f in bm.faces),
                           'nonmanifold':bad,'degenerate':deg,'inconsistent_normals':normals,'signed_volume':vol})
            bm.free()
            if evaluated: ev.to_mesh_clear()
    fit=[]
    rb=bounds(ref)
    groups={p:bounds([o for o in ref if o.name.startswith(p)])
            for p in ('Platform','Inset lane','Lane','Hit bar','Crest','Perimeter','Corner forging')}
    all_counts={t:sum(o.type==t for o in scene.objects) for t in ('MESH','CURVE','CAMERA','LIGHT')}
    all_materials=sorted({s.material.name for o in scene.objects for s in o.material_slots if s.material})
    profile_rays=[]
    for o in pair:
        b=bounds([o]); right=o.location.x>0
        gap=b['min'][0]-rb['max'][0] if right else rb['min'][0]-b['max'][0]
        assert -1e-6<=gap<=1e-6,('Side face not directly adjacent',gap)
        assert abs(b['min'][1]+2.8)<1e-5 and abs(b['max'][1]-2.7)<1e-5
        assert abs(b['dimensions'][0]-.98)<1e-5
        assert abs(b['min'][2]+.65)<1e-5 and abs(b['max'][2]-1.15)<1e-5
        clearances={p:6.0-max(abs(groups[p]['min'][0]),abs(groups[p]['max'][0]))
                    for p in ('Inset lane','Lane','Hit bar','Crest')}
        assert all(v>0 for v in clearances.values())
        fit.append({'object':o.name,'bounds':b,'platform_aabb_x_gap':gap,
                    'x_clearance_to_actual_group_extents':clearances})
        from mathutils import Vector
        for y,target in [(2.15,1.128),(1.55,1.128),(.90,.8224),(-1.0,.4073),(-2.30,-.0397),(-2.65,-.322)]:
            origin=o.matrix_world.inverted()@Vector((o.location.x,y,3))
            hit,loc,normal,index=o.ray_cast(origin,Vector((0,0,-1)))
            world=o.matrix_world@loc
            assert hit and abs(world.z-target)<.015 and normal.z>0,(o.name,y,hit,list(world))
            profile_rays.append({'object':o.name,'y':y,'surface_z':world.z,'normal':list(normal)})
    candidate=snapshot(pair); reference=snapshot(ref)
    pair_bounds=bounds(pair)
    camera=scene.camera
    cam={'name':camera.name,'matrix':[list(r) for r in camera.matrix_world],
         'lens':camera.data.lens,'sensor_width':camera.data.sensor_width,'type':camera.data.type}
    if a.compare:
        bpy.ops.wm.open_mainfile(filepath=str(a.compare.resolve()))
        assert candidate==snapshot(list(bpy.data.collections['CANDIDATE | endcap pair | UNAPPROVED'].objects)), 'Rebuild differs'
        assert reference==snapshot(list(bpy.data.collections['REFERENCE | approved platform v8.3 | read-only context'].objects))
    bpy.ops.wm.open_mainfile(filepath=str(PLATFORM))
    actual=[o for o in bpy.context.scene.objects if o.type in {'MESH','CURVE'} and not o.name.startswith('Studio')]
    assert reference==snapshot(actual), 'Imported platform geometry differs from actual approved source'
    c=bpy.context.scene.camera
    assert cam=={'name':c.name,'matrix':[list(r) for r in c.matrix_world],
                 'lens':c.data.lens,'sensor_width':c.data.sensor_width,'type':c.data.type}
    assert sha(saved)==before and sha(PLATFORM)==APPROVED_SHA
    report={'pass':True,'blender':bpy.app.version_string,'candidate_sha256':before,
            'platform_sha256_before_after':APPROVED_SHA,'platform_bounds':rb,
            'pair_bounds':pair_bounds,
            'candidate_objects':2,'candidate_materials':2,'reference_objects':len(reference),
            'scene_object_counts':all_counts,'scene_material_count':len(all_materials),
            'platform_group_bounds':groups,'profile_surface_rays':profile_rays,
            'reference_geometry_exact_match':True,'accepted_camera_exact_match':cam,
            'rebuild_exact_geometry_match':bool(a.compare),'fit':fit,'mesh_checks':checks,
            'assumptions':['Zero nominal X gap: touching bounding planes; bevels open small edge seams.',
                           'No positive-volume platform overlap: all cap vertices outside X +/-6.',
                           'No mounting hardware or collision supplied; bottom sits .20 below platform keel.',
                           'AABB separation does not prove attachment/support or gameplay camera visibility.'],
            'runtime_performance_game_camera_collision':'NOT VALIDATED'}
    out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(report,indent=2)+'\n')
    print('VALIDATION_PASS',str(out))

if __name__=='__main__': main()
