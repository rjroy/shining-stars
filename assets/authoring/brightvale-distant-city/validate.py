"""Reopen the saved candidate before running. Geometry/material/transform fingerprint
supports independent relocated rebuild comparisons. --negative-test injects and
detects a missing landmark in memory, never saving the source.
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

APPROVED_SOURCES = {
    'assets/authoring/neon-twilight-platform/platform.blend': 'ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af',
    'assets/authoring/brightvale-platform-endcaps/endcaps.blend': 'c49ae80c34350ddb7281c3192c4ed90921852f0386fa047a9196087cc13b4207',
    'assets/authoring/brightvale-highway/highway.blend': '2f2eca2987cd42b105c579420ca2e2cbc71ad75d73bcbf164aca60afe32652e5',
    'assets/authoring/brightvale-outer-framing/framing.blend': 'cd17e3162c434ce4054f6c32d86d4b6a885e9dbad44c1841b563513fffd75542',
    'assets/authoring/brightvale-distant-city/concept-candidate.webp': '220643485a5a6fe467f6bc7b98ce663d856b80ebd7e9b388d41cfba0622804af',
}


def inspect():
    coll=bpy.data.collections.get('CITY_ASSET')
    assert coll is not None,'Missing asset collection'
    assert len(bpy.data.collections)==1,'Unexpected reference/studio collection in asset'
    objects=sorted(coll.all_objects,key=lambda o:o.name)
    assert len(objects)==len(bpy.data.objects),'Objects leaked outside asset'
    assert all(o.type in {'MESH','EMPTY'} for o in objects),'Non-asset object present'
    meshes=[o for o in objects if o.type=='MESH']
    landmark=bpy.data.objects.get('Landmark.ArticulatedSpire')
    assert landmark in meshes,'Missing distinctive landmark'
    root=bpy.data.objects.get('CITY.ProvisionalLayout')
    assert root and root.parent is None,'Missing layout root'
    for obj in objects:
        if obj!=root:
            assert obj.parent,'Unowned module: '+obj.name
        assert not obj.modifiers and not obj.animation_data,'Unexpected procedural/runtime dependency'
        assert all(math.isfinite(v) for row in obj.matrix_world for v in row)
    data=sorted({o.data for o in meshes},key=lambda m:m.name)
    nonmanifold=degenerate=inconsistent=0
    payload={'meshes':[],'objects':[],'materials':[]}
    for mesh in data:
        assert len(mesh.materials)==6,'Material region slots missing'
        assert all(0 <= p.material_index < 6 for p in mesh.polygons)
        assert all(math.isfinite(c) for v in mesh.vertices for c in v.co)
        bm=bmesh.new();bm.from_mesh(mesh)
        nonmanifold+=sum(not e.is_manifold for e in bm.edges)
        inconsistent+=sum(not e.is_contiguous for e in bm.edges)
        degenerate+=sum(f.calc_area()<1e-9 for f in bm.faces)
        # Each authored closed shell should have outward normals and positive volume.
        pending=set(bm.faces)
        while pending:
            stack=[pending.pop()]; group=[]
            while stack:
                f=stack.pop();group.append(f)
                for edge in f.edges:
                    for near in edge.link_faces:
                        if near in pending:pending.remove(near);stack.append(near)
            volume=0
            for f in group:
                vs=[v.co for v in f.verts]
                volume+=sum(vs[0].dot(vs[i].cross(vs[i+1]))/6 for i in range(1,len(vs)-1))
            assert volume>1e-11,('Nonpositive shell',mesh.name,volume)
        bm.free()
        payload['meshes'].append([mesh.name,[[round(c,6) for c in v.co] for v in mesh.vertices],
                                 [[list(p.vertices),p.material_index] for p in mesh.polygons]])
    assert nonmanifold==0,('Nonmanifold edges',nonmanifold)
    assert inconsistent==0,('Inconsistent winding',inconsistent)
    assert degenerate==0,('Degenerate faces',degenerate)
    for o in objects:
        payload['objects'].append([o.name,o.type,o.data.name if o.data else None,
                                   o.parent.name if o.parent else None,
                                   [round(c,6) for row in o.matrix_world for c in row]])
    assert len(bpy.data.materials)==6,'Unexpected materials'
    assert not bpy.data.images and not bpy.data.libraries,'External asset dependency'
    for mat in sorted(bpy.data.materials,key=lambda m:m.name):
        bsdf=mat.node_tree.nodes.get('Principled BSDF');assert bsdf
        payload['materials'].append([mat.name,list(mat.diffuse_color),
                                     list(bsdf.inputs['Base Color'].default_value),
                                     bsdf.inputs['Roughness'].default_value,
                                     bsdf.inputs['Metallic'].default_value,
                                     list(bsdf.inputs['Emission Color'].default_value),
                                     bsdf.inputs['Emission Strength'].default_value])
    def bounds(obs):
        coords=[o.matrix_world@Vector(v) for o in obs for v in o.bound_box]
        return [[round(fn(v[a] for v in coords),4) for a in range(3)] for fn in (min,max)]
    bb=bounds(meshes);lb=bounds([landmark])
    others=[o for o in meshes if not o.name.startswith('Landmark.')]
    assert lb[1][2]>bounds(others)[1][2]*1.35,'Landmark not distinctively taller'
    assert lb[1][0]<0,'Landmark should remain left of center in candidate'
    assert bb[1][0]-bb[0][0]>2*(bb[1][2]-bb[0][2]),'City no longer broad skyline'
    districts=[o for o in objects if o.type=='EMPTY' and o.name.startswith('District.')]
    assert len(districts)==21,'District ownership count changed'
    assert set(o['depth_layer'] for o in districts)=={'front','middle','rear','landmark'}
    assert min(o.location.y for o in districts)<10 and max(o.location.y for o in districts)>75
    # Provisional layered basin, not an immutable runtime framing corridor.
    central=[o for o in meshes if abs(o.matrix_world.translation.x)<30]
    assert bounds(central)[1][2]<lb[1][2]*.65,'Central basin exceeds silhouette hierarchy'
    unique_tris=sum(sum(len(p.vertices)-2 for p in m.polygons) for m in data)
    placed_tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
    result={'blender':bpy.app.version_string,'objects':len(objects),'mesh_objects':len(meshes),
            'unique_meshes':len(data),'linked_mesh_placements':len(meshes)-len(data),
            'unique_vertices':sum(len(m.vertices) for m in data),
            'unique_triangles':unique_tris,'placed_triangles':placed_tris,
            'bounds':bb,'landmark_bounds':lb,'materials':len(bpy.data.materials),
            'nonmanifold_edges':nonmanifold,'degenerate_faces':degenerate,
            'inconsistent_winding_edges':inconsistent,
            'fingerprint':hashlib.sha256(json.dumps(payload,separators=(',',':')).encode()).hexdigest()}
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path)
    parser.add_argument('--negative-test',action='store_true')
    parser.add_argument('--sources-root',type=Path,help='Optional read-only approved-source checksum check')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    result=inspect()
    if args.sources_root:
        for relative,expected in APPROVED_SOURCES.items():
            actual=hashlib.sha256((args.sources_root/relative).read_bytes()).hexdigest()
            assert actual==expected,('Approved source hash changed',relative,actual)
        result['approved_source_checksums']='PASS: four approved blends and city concept'
    if args.negative_test:
        obj=bpy.data.objects['Landmark.ArticulatedSpire'];obj.name='INJECTED_MISSING_LANDMARK'
        try:inspect()
        except AssertionError as error:
            assert str(error)=='Missing distinctive landmark',str(error)
            result['negative_test']='PASS: missing landmark rejected'
        else:raise AssertionError('Negative mutation was not detected')
        obj.name='Landmark.ArticulatedSpire'
    print(json.dumps(result,indent=2),flush=True)
    if args.report:args.report.write_text(json.dumps(result,indent=2)+'\n')
