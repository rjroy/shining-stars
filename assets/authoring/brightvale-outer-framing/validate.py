"""Read-only piece geometry and disposable preview-isolation checks, not production placement."""
import argparse
import json
import math
import sys
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
import build
import bpy
import bmesh


def points(objects):
    dg=bpy.context.evaluated_depsgraph_get()
    result=[]
    for o in objects:
        e=o.evaluated_get(dg);m=e.to_mesh()
        result.extend(o.matrix_world@v.co for v in m.vertices)
        e.to_mesh_clear()
    return result


def bounds(objects):
    pts=points(objects)
    assert pts,'Empty geometry set'
    lo=[min(v[i] for v in pts) for i in range(3)]
    hi=[max(v[i] for v in pts) for i in range(3)]
    return {'min':lo,'max':hi,'dimensions':[hi[i]-lo[i] for i in range(3)]}


def overlaps(a,b):
    return all(min(a['max'][i],b['max'][i])-max(a['min'][i],b['min'][i])>1e-5 for i in range(3))


def fit(asset,reference):
    """Check the stored scene-study setup only; none of its layout numbers are approved placement."""
    roots=[o for o in asset if o.type=='EMPTY']
    rb=bounds(reference)
    result={}
    for side in ('left','right'):
        sections=[]
        for root in roots:
            if root['side']!=side:
                continue
            assert tuple(root.scale)==(1.,1.,1.),'Unexpected module scale'
            assert root.matrix_world.determinant()>0.,'Reflected/negative module transform'
            b=bounds(list(root.children))
            assert not overlaps(b,rb),'Framing overlaps approved assembly'
            for lo,hi in build.CROWD:
                assert not overlaps(b,{'min':lo,'max':hi}),'Framing enters reserved crowd corridor'
            sections.append((root['module'],b))
        sections.sort(key=lambda kv:kv[1]['min'][1])
        assert [k for k,b in sections]==['long','post','short'],'Section order changed'
        gaps=[sections[i+1][1]['min'][1]-sections[i][1]['max'][1] for i in range(2)]
        assert min(gaps)>=2.,f'Open gap invariant failed: {side} {gaps}'
        result[side]={'sections':dict(sections),'open_gaps':gaps}
    result['assembly_bounds']=rb
    result['framing_bounds']=bounds([o for o in asset if o.type=='MESH'])
    result['minimum_crowd_lateral_gap']=min(abs(v[0]) for v in points([o for o in asset if o.type=='MESH']))-11.10
    result['minimum_assembly_lateral_gap']=min(abs(v[0]) for v in points([o for o in asset if o.type=='MESH']))-max(abs(rb['min'][0]),abs(rb['max'][0]))
    return result


def material_state(m):
    ns=[]
    for n in sorted(m.node_tree.nodes,key=lambda n:n.name):
        vals=[]
        for socket in n.inputs:
            if not hasattr(socket,'default_value'):
                continue
            value=socket.default_value
            if isinstance(value,(str,float,int,bool)):
                vals.append((socket.name,value))
            else:
                try: vals.append((socket.name,list(value)))
                except TypeError: pass
        ns.append((n.name,n.type,vals))
    return {'name':m.name,'nodes':ns,'links':sorted((l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name) for l in m.node_tree.links)}


def snapshot(objects):
    result={}
    dg=bpy.context.evaluated_depsgraph_get()
    for o in sorted(objects,key=lambda o:o.name):
        if o.type not in {'MESH','CURVE'}:
            continue
        e=o.evaluated_get(dg);m=e.to_mesh()
        value={'vertices':[list(v.co) for v in m.vertices],
               'faces':[(list(p.vertices),p.material_index) for p in m.polygons],
               'matrix':[list(row) for row in o.matrix_world],
               'materials':[material_state(mat) for mat in m.materials]}
        result[o.name]=value
        e.to_mesh_clear()
    return result


def normal_topology(o):
    dg=bpy.context.evaluated_depsgraph_get()
    e=o.evaluated_get(dg);evaluated=e.to_mesh()
    result={}
    for label,m in (('base',o.data),('evaluated',evaluated)):
        bm=bmesh.new();bm.from_mesh(m)
        assert all(edge.is_manifold for edge in bm.edges),f'{o.name} {label}: nonmanifold edge'
        assert all(edge.is_contiguous for edge in bm.edges),f'{o.name} {label}: inconsistent winding'
        assert all(f.calc_area()>1e-10 for f in bm.faces),f'{o.name} {label}: degenerate face'
        volume=bm.calc_volume(signed=True)
        assert volume>1e-7,f'{o.name} {label}: inverted/empty volume {volume}'
        m.calc_loop_triangles()
        result[label]={'vertices':len(m.vertices),'faces':len(m.polygons),'triangles':len(m.loop_triangles),'volume':volume}
        bm.free()
    e.to_mesh_clear()
    return result


def module_contract(roots):
    """Check piece dimensions plus historical preview transforms, not final scene fit."""
    result={}
    for root in roots:
        kind,side=root['module'],root['side']
        expected_location=(-12. if side=='left' else 12.,build.POSITIONS[kind],-.70)
        assert all(abs(root.location[i]-expected_location[i])<1e-5 for i in range(3)),f'{root.name}: study origin changed'
        expected_angle=math.pi/2 if side=='left' else -math.pi/2
        assert abs(root.rotation_euler.z-expected_angle)<1e-5,'Front face no longer inward'
        assert len(root.children)==(3 if kind=='post' else 1),'Unexpected module construction'
        dg=bpy.context.evaluated_depsgraph_get();pts=[]
        for o in root.children:
            assert all(abs(v)<1e-7 for v in o.location),'Mesh local origin shifted'
            assert tuple(o.scale)==(1.,1.,1.),'Mesh scaled'
            e=o.evaluated_get(dg);m=e.to_mesh();pts += [v.co.copy() for v in m.vertices];e.to_mesh_clear()
        lo=[min(v[i] for v in pts) for i in range(3)];hi=[max(v[i] for v in pts) for i in range(3)]
        dims=[hi[i]-lo[i] for i in range(3)]
        expected={'long':(2.92,.68,1.15),'short':(1.92,.68,1.15),'post':(.94,.84,1.35)}[kind]
        assert all(abs(dims[i]-expected[i])<1e-5 for i in range(3)),f'{root.name}: module dimensions changed {dims}'
        assert abs(lo[2])<1e-7,'Module foot not at local Z=0'
        if kind=='post':
            lens=next(o for o in root.children if 'lens' in o.data.name)
            bezel=next(o for o in root.children if 'bezel' in o.data.name)
            # Pocket floor Y=-.225, shaft front -.32. Lens is behind the bezel.
            assert min(v.co.y for v in lens.data.vertices)>max(v.co.y for v in bezel.data.vertices)+.01,'Lens not recessed behind bezel'
            assert max(v.co.y for v in lens.data.vertices)<-.225-.02,'Lens crosses pocket floor'
        result[f'{side} {kind}']={'local_bounds':{'min':lo,'max':hi,'dimensions':dims},'preview_origin':list(root.location)}
    return result


def camera_state():
    o=bpy.data.objects['Camera | concept v4 comparison']
    return {'matrix':[list(row) for row in o.matrix_world],'type':o.data.type,'lens':o.data.lens,'sensor':o.data.sensor_width}


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--report',required=True)
    ap.add_argument('--compare')
    ap.add_argument('--negative-test',action='store_true')
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    report=build.allowed(args.report)
    assert not report.exists(),'Report exists; choose a NEW output'
    source=Path(bpy.data.filepath).resolve()
    before=build.sha(source);immutable=build.integrity()
    print('VALIDATE_ATTEMPT',str(source),before,flush=True)
    asset=list(bpy.data.collections[build.ASSET].objects)
    refs=list(bpy.data.collections[build.REFERENCE].objects)
    meshes=[o for o in asset if o.type=='MESH'];roots=[o for o in asset if o.type=='EMPTY']
    assert len(meshes)==10 and len(roots)==6,(len(meshes),len(roots))
    assert len(refs)==69,'Reference object set changed'
    assert len({o.data.as_pointer() for o in meshes})==5,'Reusable linked geometry changed'
    assert sorted({m.name for o in meshes for m in o.data.materials})==sorted(build.MATERIAL_NAMES)
    assert all(o.parent in roots for o in meshes),'Unanchored bridging geometry'
    assert all(m.name.startswith('Framing |') for o in meshes for m in o.data.materials)
    assert not bpy.data.libraries,'Unexpected external linked library dependency'
    assert not bpy.utils.blend_paths(absolute=True,packed=False,local=True),'Unexpected external texture/file dependency'
    assert not any(o.name.startswith('TEMP') for o in bpy.context.scene.objects),'Temporary construction object leaked'
    result={'asset_sha256':before,'source_sha256':immutable,'preview_isolation':fit(asset,refs),
            'placement_scope':'Disposable scene-study transforms, gaps and empty crowd corridor only; production placement is NOT approved and awaits city/crowd and camera review.',
            'modules':module_contract(roots),
            'mesh_objects':len(meshes),'module_origins':len(roots),'unique_meshes':5,'materials':6,
            'topology':{o.name:normal_topology(o) for o in meshes}}
    result['evaluated_triangles']=sum(v['evaluated']['triangles'] for v in result['topology'].values())
    reference_state=snapshot(refs);asset_state=snapshot(meshes);camera=camera_state()
    if args.negative_test:
        root=next(o for o in roots if o['side']=='left' and o['module']=='post')
        old=root.location.copy();root.location.y=1.90;bpy.context.view_layer.update()
        try:
            fit(asset,refs)
        except AssertionError as exc:
            assert 'Open gap' in str(exc),f'Wrong negative-test failure: {exc}'
            result['negative_test']='PASS: closing one longitudinal gap was rejected: '+str(exc)
        else:
            raise AssertionError('Negative test did not catch closed gap')
        finally:
            root.location=old;bpy.context.view_layer.update()
        assert asset_state==snapshot(meshes),'Negative test restoration failed'
    if args.compare:
        other=Path(args.compare).resolve();other_sha=build.sha(other)
        bpy.ops.wm.open_mainfile(filepath=str(other))
        assert asset_state==snapshot(list(bpy.data.collections[build.ASSET].objects)),'Regenerated geometry/material/placement differs'
        assert reference_state==snapshot(list(bpy.data.collections[build.REFERENCE].objects)),'Regenerated references differ'
        assert camera==camera_state(),'Regenerated comparison camera differs'
        assert build.sha(other)==other_sha
        result['independent_regeneration']='PASS: exact evaluated geometry, transforms, materials and camera'
    for path in build.SOURCES:
        bpy.ops.wm.open_mainfile(filepath=str(path))
        source_objects=[o for o in bpy.context.scene.objects if o.type in {'MESH','CURVE'} and not o.name.startswith('Studio')]
        expected=snapshot(source_objects)
        assert all(reference_state.get(name)==value for name,value in expected.items()),f'Changed imported reference: {path.name}'
        assert camera==camera_state(),f'Comparison camera changed: {path.name}'
    assert build.integrity()==immutable
    assert build.sha(source)==before,'Asset source modified during validation'
    result['saved_reopen_reference_source_checks']='PASS'
    result['limitations']='Reusable pieces approved separately by user; validation is not approval. Stored placement/gaps/corridor are disposable preview setup, not production contracts; final placement and camera fit await city/crowd. No runtime integration, shader fidelity or performance budget validated. Topology tests do not prove absence of all nonadjacent face self-intersections.'
    report.parent.mkdir(parents=True,exist_ok=True)
    report.write_text(json.dumps(result,indent=2)+'\n')
    print('VALIDATE_PASS',str(report),result['evaluated_triangles'],flush=True)


if __name__=='__main__':
    main()
