"""Reopen native derivative, inspect GLB bytes/geometry and test deliberate defects.

No external validator/library installation and no browser/runtime claims.
"""
import argparse
import collections
import copy
import hashlib
import itertools
import json
import math
from pathlib import Path
import struct
import sys
sys.dont_write_bytecode = True
import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Quaternion, Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
import produce as P

AXES = Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))


def material_snapshot():
    result={}
    for m in bpy.data.materials:
        bsdf=m.node_tree.nodes.get('Principled BSDF')
        assert bsdf and len(m.node_tree.nodes)==2 and len(m.node_tree.links)==1
        result[m.name]=dict(base=list(bsdf.inputs['Base Color'].default_value),
            diffuse=list(m.diffuse_color),roughness=bsdf.inputs['Roughness'].default_value,
            metallic=bsdf.inputs['Metallic'].default_value,
            emission=list(bsdf.inputs['Emission Color'].default_value),
            strength=bsdf.inputs['Emission Strength'].default_value,properties=dict(m.items()))
    return result


def snapshot():
    bpy.context.view_layer.update()
    result={}
    for o in sorted(bpy.data.objects,key=lambda o:o.name):
        item=dict(parent=o.parent.name if o.parent else None, origin=list(o.matrix_world.translation),
                  matrix=[list(row) for row in o.matrix_world], type=o.type,
                  properties=dict(o.items()))
        if o.type=='MESH':
            m=o.data; m.calc_loop_triangles(); normals=m.corner_normals
            normal_matrix=o.matrix_world.to_3x3().inverted().transposed()
            item['mesh']=m.name; item['triangles']=[]
            for t in m.loop_triangles:
                points=np.array([list(o.matrix_world@m.vertices[v].co) for v in t.vertices])
                ns=np.array([list((normal_matrix@normals[i].vector).normalized()) for i in t.loops])
                item['triangles'].append((m.materials[t.material_index].name,points,ns))
        result[o.name]=item
    return result


def native_checks():
    assert len(bpy.data.objects)==221 and len(bpy.data.meshes)==64, 'Native object/mesh scope changed'
    assert set(bpy.data.collections.keys())=={'CITY_ASSET'}
    assert set(bpy.data.materials.keys())==set(P.ROLES)
    assert not bpy.data.images and not bpy.data.libraries
    assert 'Landmark.ArticulatedSpire' in bpy.data.objects
    assert all(o.type in {'MESH','EMPTY'} and not o.modifiers and not o.animation_data for o in bpy.data.objects)
    assert sum(o.type=='EMPTY' for o in bpy.data.objects)==25
    assert sum(o.type=='EMPTY' and o.name.startswith('District.') for o in bpy.data.objects)==21
    inv=P.inventory(list(bpy.data.objects))
    assert inv['placed_triangles']==216633 and inv['unique_triangles']==71110
    assert inv['linked_additional_placements']==132
    boundary=nonmanifold=degenerate=0
    for m in bpy.data.meshes:
        assert not m.uv_layers and not m.color_attributes and len(m.materials)==6
        bm=bmesh.new();bm.from_mesh(m)
        boundary+=sum(e.is_boundary for e in bm.edges)
        nonmanifold+=sum(not e.is_manifold and not e.is_boundary for e in bm.edges)
        degenerate+=sum(f.calc_area()<1e-10 for f in bm.faces)
        assert all(e.is_contiguous for e in bm.edges if e.is_manifold), 'Inconsistent winding'
        bm.free()
    assert not nonmanifold and not degenerate
    return dict(**{k:v for k,v in inv.items() if k!='repeats'},intentional_open_detail_edges=boundary,invalid_nonmanifold_edges=nonmanifold,degenerate_faces=degenerate)


def source_surface_checks():
    """Independent face-subset proof: unchanged coordinates, winding and material.

    Only recognized shell backs/sides may be absent. All other source polygons
    must survive exactly, including structural and any source-degenerate faces.
    """
    def face(m,p):
        return (m.materials[p.material_index].name,tuple(tuple(m.vertices[i].co) for i in p.vertices))
    expected={}; degenerate={}; families=collections.Counter(); matched=collections.Counter()
    for m in bpy.data.meshes:
        kind=P.family(m); families[kind]+=1;remove=set()
        for vs,fs in P.components(m):
            cap=P.detail_cap(m,vs,fs)
            if cap:
                assert kind!='protected_structure','Structural misclassification'
                remove.update(f for f in fs if f!=cap[0]);matched[cap[1]]+=1
        expected[m.name]=[face(m,p) for p in m.polygons if p.index not in remove]
        m.calc_loop_triangles()
        bad=[dict(polygon=t.polygon_index,vertices=list(t.vertices),area=t.area)
             for t in m.loop_triangles if t.area<1e-10]
        if bad:degenerate[m.name]=bad
    assert dict(families)==dict(protected_structure=24,tower=23,palazzo=9,landmark=8)
    assert dict(matched)==dict(lancet=3768,mullion=631)
    changes=P.derive()
    for m in bpy.data.meshes:
        assert [face(m,p) for p in m.polygons]==expected[m.name], 'Source surface changed'
    return dict(families=dict(families),recognized_shells=dict(matched),
                exact_retained_polygons=True,source_degenerate_triangles=degenerate),changes


def compare(expected,actual,tolerance=8e-5,check_normals=True):
    assert len(expected)==len(actual),'Triangle count changed'
    def canonical(record):
        role,p,n=record
        # Millith-unit bin is only a matching key; actual values remain strict.
        quant=np.round(p,3)
        first=min(range(3),key=lambda i:tuple(quant[i]))
        q=np.roll(quant,-first,axis=0)
        return (role,tuple(q.flat)),np.roll(p,-first,axis=0),np.roll(n,-first,axis=0)
    bins=collections.defaultdict(list)
    for r in expected:
        k,p,n=canonical(r);bins[k].append((p,n))
    max_position=max_normal=0; spatial=None; active=None
    for r in actual:
        k,p,n=canonical(r)
        if k in bins and bins[k]:
            candidates=bins[k]
            j=min(range(len(candidates)),key=lambda j:np.max(np.abs(p-candidates[j][0]))+np.max(np.abs(n-candidates[j][1])))
            q,m=candidates.pop(j)
            if active is not None:active.discard(id(q))
        else:
            # Float32 transforms can cross a rounding-bin boundary. Resolve only
            # these misses spatially, still requiring identical oriented vertices
            # and material within the same strict numerical tolerance.
            if spatial is None:
                spatial=collections.defaultdict(list);active=set()
                for key,values in bins.items():
                    for pp,nn in values:
                        cell=tuple(np.floor(pp.mean(axis=0)*100).astype(int))
                        spatial[(key[0],*cell)].append((key,pp,nn));active.add(id(pp))
            cell=np.floor(p.mean(axis=0)*100).astype(int);found=None
            for delta in itertools.product((-1,0,1),repeat=3):
                for key,pp,nn in spatial.get((k[0],*(cell+delta)),[]):
                    if id(pp) not in active:continue
                    for shift in range(3):
                        qq=np.roll(pp,shift,axis=0);mm=np.roll(nn,shift,axis=0)
                        if np.max(np.abs(p-qq))<tolerance and (not check_normals or np.max(np.abs(n-mm))<2e-4):
                            found=(key,pp,qq,mm);break
                    if found:break
                if found:break
            assert found is not None, ('Triangle/material/winding changed',k)
            key,pp,q,m=found;active.remove(id(pp))
            bins[key]=[(v,w) for v,w in bins[key] if v is not pp]
        pe=float(np.max(np.abs(p-q)));ne=float(np.max(np.abs(n-m)))
        assert pe<tolerance,('Triangle position changed',pe)
        if check_normals:assert ne<2e-4,('Corner normals changed',ne)
        max_position=max(max_position,pe);max_normal=max(max_normal,ne)
    return dict(maximum_position_error=max_position,maximum_normal_component_error=max_normal)


def glb(path):
    data=Path(path).read_bytes()
    magic,version,size=struct.unpack_from('<4sII',data)
    assert magic==b'glTF' and version==2 and size==len(data),'Bad GLB header'
    off=12;chunks=[]
    while off<len(data):
        length,kind=struct.unpack_from('<II',data,off);off+=8
        assert length%4==0 and off+length<=len(data)
        chunks.append((kind,data[off:off+length]));off+=length
    assert [k for k,_ in chunks]==[0x4e4f534a,0x004e4942]
    return json.loads(chunks[0][1]),chunks[1][1]


def accessor(doc,buf,index):
    a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
    assert 'sparse' not in a and v['buffer']==0
    dtype=np.dtype({5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']])
    width={'SCALAR':1,'VEC3':3}[a['type']];stride=v.get('byteStride',width*dtype.itemsize)
    start=v.get('byteOffset',0)+a.get('byteOffset',0)
    assert start+(a['count']-1)*stride+width*dtype.itemsize<=v.get('byteOffset',0)+v['byteLength']<=len(buf)
    result=np.ndarray((a['count'],width),dtype=dtype,buffer=buf,offset=start,strides=(stride,dtype.itemsize)).copy()
    assert np.isfinite(result).all(),'Nonfinite accessor'
    return result


def matrix(node):
    assert 'matrix' not in node,'Unexpected matrix encoding'
    q=node.get('rotation',[0,0,0,1])
    return (Matrix.Translation(Vector(node.get('translation',[0,0,0]))) @
            Quaternion((q[3],*q[:3])).to_matrix().to_4x4() @
             Matrix.Diagonal((*node.get('scale',[1,1,1]),1)))


def triangle_degeneracy(doc,buf):
    """Measure exported float32 geometry, not only Blender polygon areas."""
    by_mesh={}
    for i,m in enumerate(doc['meshes']):
        bad=0
        for p in m['primitives']:
            pts=accessor(doc,buf,p['attributes']['POSITION']).astype(np.float64)
            ix=accessor(doc,buf,p['indices']).reshape(-1,3)
            v=pts[ix];areas=np.linalg.norm(np.cross(v[:,1]-v[:,0],v[:,2]-v[:,0]),axis=1)*.5
            bad+=int(np.sum(areas<1e-10))
        if bad:by_mesh[i]=bad
    return dict(area_threshold=1e-10,unique_count=sum(by_mesh.values()),
                placed_count=sum(by_mesh.get(n['mesh'],0) for n in doc['nodes'] if 'mesh' in n),
                meshes={doc['meshes'][i]['name']:n for i,n in by_mesh.items()})


def inspect(doc,buf,expected):
    assert doc['asset']['version']=='2.0'
    assert len(doc['nodes'])==221 and len(doc['meshes'])==64,'Unexpected export scope'
    assert len(doc['scenes'])==1 and len(doc['scenes'][0]['nodes'])==1
    assert set(doc.get('extensionsUsed',[]))=={'KHR_materials_emissive_strength'}, 'Unexpected extension'
    assert not doc.get('extensionsRequired')
    for key in ('cameras','skins','animations','images','textures','samplers'):assert not doc.get(key),key
    assert len(doc['buffers'])==1 and 'uri' not in doc['buffers'][0]
    assert len(doc['materials'])==6 and {m['name'] for m in doc['materials']}==set(P.ROLES),'Material role loss'
    materials={}
    colors={'Limestone':[.42,.31,.21],'Recess':[.10,.085,.12],'Slate':[.035,.085,.14],
            'Cornice':[.62,.49,.30],'Gilt':[.65,.38,.105],'Window':[1,.47,.12]}
    for m in doc['materials']:
        name=m['name'];pbr=m['pbrMetallicRoughness']
        assert m['extras']['city_role']==P.ROLES[name] and m['extras']['source_material']==name
        assert np.allclose(pbr['baseColorFactor'],[*colors[name],1],atol=1e-7,rtol=0)
        assert abs(pbr.get('metallicFactor',1)-(.48 if name=='Gilt' else 0))<1e-7
        assert abs(pbr['roughnessFactor']-(.39 if name=='Gilt' else .68))<1e-7
        assert m.get('alphaMode','OPAQUE')=='OPAQUE' and m['doubleSided'] is True
        if name=='Window':
            assert np.allclose(m['emissiveFactor'],colors[name],atol=1e-7,rtol=0)
            assert abs(m['extensions']['KHR_materials_emissive_strength']['emissiveStrength']-1.8)<1e-7
        else:assert not m.get('emissiveFactor') and not m.get('extensions')
        materials[name]={**pbr,'city_role':P.ROLES[name], 'emissiveFactor':m.get('emissiveFactor',[0,0,0]),
                         'emissiveStrength':m.get('extensions',{}).get('KHR_materials_emissive_strength',{}).get('emissiveStrength',0)}
    nodes=doc['nodes'];assert {n['name'] for n in nodes}==set(expected),'Node names changed'
    parent={};world={};visited=set()
    def walk(i,base,par):
        assert i not in visited,'Node cycle or duplicate parent'
        visited.add(i);parent[i]=par;world[i]=base@matrix(nodes[i])
        for child in nodes[i].get('children',[]):walk(child,world[i],nodes[i]['name'])
    for i in doc['scenes'][0]['nodes']:walk(i,Matrix.Identity(4),None)
    assert len(visited)==221
    all_points=[];placed=0;primitive_placements=0;comparisons=[];mesh_users=collections.defaultdict(list)
    triangles_by_role=collections.Counter()
    for i,n in enumerate(nodes):
        e=expected[n['name']]
        assert parent[i]==e['parent'],'Hierarchy changed'
        target=AXES@Matrix(e['matrix'])@AXES.inverted()
        assert np.allclose(np.array(world[i]),np.array(target),atol=2e-5,rtol=0),'Source transform drift'
        assert n['extras']['source_object']==n['name']
        assert n['extras']==e['properties'], 'Source/role/reuse metadata changed'
        if e['type']=='EMPTY':assert 'mesh' not in n;continue
        assert n['extras']['shared_geometry_id']==e['mesh']
        mesh_users[n['mesh']].append(n['name'])
        records=[];normal_matrix=world[i].to_3x3().inverted().transposed()
        for prim in doc['meshes'][n['mesh']]['primitives']:
            assert prim.get('mode',4)==4 and set(prim['attributes'])=={'POSITION','NORMAL'}
            assert not prim.get('extensions') and not prim.get('targets')
            pts=accessor(doc,buf,prim['attributes']['POSITION']);norm=accessor(doc,buf,prim['attributes']['NORMAL'])
            ix=accessor(doc,buf,prim['indices']).reshape(-1)
            assert len(ix)%3==0 and len(pts)==len(norm) and ix.max()<len(pts)
            assert np.max(np.abs(np.linalg.norm(norm,axis=1)-1))<2e-5,'Invalid normals'
            pts=np.array([list(world[i]@Vector(p)) for p in pts]);norm=np.array([list((normal_matrix@Vector(p)).normalized()) for p in norm])
            role=doc['materials'][prim['material']]['name']
            for tri in ix.reshape(-1,3):records.append((role,pts[tri],norm[tri]))
            triangles_by_role[role]+=len(ix)//3
            all_points.extend(pts);primitive_placements+=1
        converted=[(role,np.array([list(AXES@Vector(p)) for p in pts]),
                    np.array([list(AXES.to_3x3()@Vector(n)) for n in ns])) for role,pts,ns in e['triangles']]
        comparisons.append(compare(converted,records));placed+=len(records)
    assert placed==216633
    repeats=sorted(sorted(v) for v in mesh_users.values() if len(v)>1)
    expected_repeats=collections.defaultdict(list)
    for name,e in expected.items():
        if e['type']=='MESH':expected_repeats[e['mesh']].append(name)
    assert repeats==sorted(sorted(v) for v in expected_repeats.values() if len(v)>1),'Shared mesh reuse lost'
    points=np.array(all_points)
    lo=points.min(axis=0);hi=points.max(axis=0)
    assert np.allclose(lo,[-133,-13,-99],atol=2e-5,rtol=0)
    assert np.allclose(hi,[133,118,12],atol=2e-5,rtol=0)
    primitives=[p for m in doc['meshes'] for p in m['primitives']]
    degeneracy=triangle_degeneracy(doc,buf)
    return dict(nodes=len(nodes),unique_meshes=len(doc['meshes']),unique_primitives=len(primitives),
        placed_primitives=primitive_placements,placed_triangles=placed,
        unique_triangles=sum(doc['accessors'][p['indices']]['count']//3 for p in primitives),
        decoded_unique_primitive_vertices=sum(doc['accessors'][p['attributes']['POSITION']]['count'] for p in primitives),
        buffer_bytes=len(buf),bounds_gltf=dict(min=lo.tolist(),max=hi.tolist()),
        linked_node_groups=repeats,triangles_by_role=dict(triangles_by_role),materials=materials,
        degenerate_triangles=degeneracy,
        maximum_position_error=max(c['maximum_position_error'] for c in comparisons),
        maximum_normal_component_error=max(c['maximum_normal_component_error'] for c in comparisons),
        extensions=doc.get('extensionsUsed',[]))


def negative_tests(doc,buf,expected,existing):
    results={}
    landmark=next(i for i,n in enumerate(doc['nodes']) if n['name']=='Landmark.ArticulatedSpire')
    for name,mutation in [
        ('extra_reference_node',lambda d:d['nodes'].append({'name':'Unowned studio'})),
        ('missing_landmark',lambda d:d['nodes'][landmark].update(name='Missing')),
        ('role_loss',lambda d:d['materials'][0].update(name='Unknown')),
        ('transform_drift',lambda d:d['nodes'][landmark].update(translation=[0,0,0.5])),
        ('unexpected_compression',lambda d:d.update(extensionsUsed=['KHR_draco_mesh_compression'])),
        ('reuse_lost',lambda d:d['meshes'].append(copy.deepcopy(d['meshes'][0]))),
        ('missing_rear_district',lambda d:next(n for n in d['nodes'] if n['name']=='District.20.rear').update(name='Missing')),
        ('missing_infrastructure',lambda d:next(n for n in d['nodes'] if n['name']=='Infrastructure.MasonryAndStreets').update(name='Missing'))]:
        bad=copy.deepcopy(doc);mutation(bad)
        try:inspect(bad,buf,expected)
        except AssertionError:results[name+'_rejected']=True
        else:raise AssertionError('Deliberate defect accepted: '+name)
    first=next(e['triangles'] for e in expected.values() if 'triangles' in e)
    role,p,n=first[0]
    try:compare([first[0]],[(role,p,-n)])
    except AssertionError:results['flipped_normals_rejected']=True
    else:raise AssertionError('Flipped normals accepted')
    try:compare([first[0]],[(role,p[[0,2,1]],n[[0,2,1]])])
    except AssertionError:results['reversed_winding_rejected']=True
    else:raise AssertionError('Reversed winding accepted')
    for name,path in [('existing_output',existing),('source_output',P.SOURCE.parent/'forbidden.glb'),
                      ('outside_scope',Path('/tmp/forbidden-city.glb'))]:
        try:P.output(path,'.glb')
        except (FileExistsError,ValueError):results[name+'_rejected']=True
        else:raise AssertionError('Output guard failed')
    import tempfile
    with tempfile.TemporaryDirectory(prefix='city-negative-',dir='/tmp/opencode') as temp:
        wrong=Path(temp)/'wrong.blend';wrong.write_bytes(b'not the authorized source')
        try:P.load_source(wrong)
        except AssertionError:results['changed_source_rejected']=True
        else:raise AssertionError('Changed source accepted')
    return results


def recognizer_negative_tests(source):
    """Operate on copies of actual full-source shells, never fabricated buildings."""
    P.load_source(source);results={}
    m=next(m for m in bpy.data.meshes if P.family(m)=='palazzo')
    vs,fs=next((vs,fs) for vs,fs in P.components(m) if (P.detail_cap(m,vs,fs) or (None,None))[1]=='lancet')
    for name in ('wrong_material','deep_structural_panel','wrong_outline','broken_ring'):
        test=m.copy()
        if name=='wrong_material':
            for f in fs:test.polygons[f].material_index=0
        elif name=='deep_structural_panel':
            delta=test.vertices[vs[7]].co-test.vertices[vs[0]].co
            for v in vs[7:]:test.vertices[v].co+=delta*2
        elif name=='wrong_outline':test.vertices[vs[3]].co.z+=.1;test.vertices[vs[10]].co.z+=.1
        elif name=='broken_ring':test.vertices[vs[7]].co.x+=.1
        test.update()
        assert P.detail_cap(test,vs,fs) is None, 'Unsafe recognizer match: '+name
        results[name+'_rejected']=True;bpy.data.meshes.remove(test)
    # The whole input is required, not the formerly approved slice.
    bpy.data.objects.remove(bpy.data.objects['District.20.rear'],do_unlink=True)
    try:native_checks()
    except AssertionError:results['slice_or_partial_native_rejected']=True
    else:raise AssertionError('Partial city accepted')
    return results


def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=P.SOURCE)
    p.add_argument('--blend',type=Path,required=True);p.add_argument('--glb',type=Path,required=True)
    p.add_argument('--report',type=Path,required=True);p.add_argument('--compare',type=Path)
    p.add_argument('--negative-test',action='store_true')
    p.add_argument('--baseline-output',type=Path,help='Optional unchanged-source GLB in scratch for transfer measurement')
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=P.output(a.report,'.json')
    hashes={str(f):P.sha(f) for f in (a.source,a.blend,a.glb)}
    try:
        whole=P.load_source(a.source);baseline=None
        if a.baseline_output:
            baseline_path=P.output(a.baseline_output,'.glb')
            assert baseline_path.is_relative_to('/tmp/opencode'), 'Baseline export is scratch-only'
            P.stamp_metadata();P.export_glb(baseline_path)
            d,b=glb(baseline_path);primitives=[p for m in d['meshes'] for p in m['primitives']]
            baseline=dict(transfer_bytes=baseline_path.stat().st_size,
                unique_primitives=len(primitives),
                placed_primitives=sum(len(d['meshes'][n['mesh']]['primitives']) for n in d['nodes'] if 'mesh' in n),
                unique_triangles=sum(d['accessors'][p['indices']]['count']//3 for p in primitives),
                degenerate_triangles=triangle_degeneracy(d,b))
            assert baseline['unique_triangles']==whole['unique_triangles'], 'Baseline exporter dropped triangles'
        surfaces,changes=source_surface_checks();regenerated=snapshot()
        regenerated_materials=material_snapshot()
        print('CITY DERIVATIVE REOPEN ATTEMPT',a.blend,flush=True)
        bpy.ops.wm.open_mainfile(filepath=str(a.blend));native=native_checks();expected=snapshot()
        assert material_snapshot()==regenerated_materials,'Reopened native materials changed'
        assert expected.keys()==regenerated.keys()
        for name,e in expected.items():
            r=regenerated[name]
            assert {k:v for k,v in e.items() if k!='triangles'}=={k:v for k,v in r.items() if k!='triangles'}
            if 'triangles' in e:compare(r['triangles'],e['triangles'],tolerance=1e-9)
        print('CITY DERIVATIVE REOPEN/REGENERATION SUCCESS; GLB CHECK ATTEMPT',flush=True)
        doc,buf=glb(a.glb);exported=inspect(doc,buf,expected)
        result=dict(pass_geometry_export=True,source_sha256=P.SOURCE_SHA,blender=bpy.app.version_string,
                    exporter='5.2.40',whole_source={k:v for k,v in whole.items() if k!='repeats'},
                     source_surfaces=surfaces,derived_native=native,glb=exported,transfer_bytes=a.glb.stat().st_size,
                     derivative_reopen_and_independent_regeneration='PASS',source_unchanged=True)
        if baseline:result['unchanged_source_export']=baseline
        if baseline:assert exported['degenerate_triangles']==baseline['degenerate_triangles'], 'Export introduced/lost degenerate source surfaces'
        if a.compare:
            assert a.glb.read_bytes()==a.compare.read_bytes(),'Relocated export differs'
            result['relocated_reproduction_byte_identical']=True
        if a.negative_test:result['negative_tests']=negative_tests(doc,buf,expected,a.glb)
        print('CITY GLB CHECK SUCCESS; REIMPORT ATTEMPT',flush=True)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        assert bpy.ops.import_scene.gltf(filepath=str(a.glb),import_shading='NORMALS',merge_vertices=False)=={'FINISHED'}
        imported=snapshot();assert imported.keys()==expected.keys()
        errors=[]
        for name,e in expected.items():
            assert imported[name]['parent']==e['parent']
            assert np.allclose(imported[name]['matrix'],e['matrix'],atol=2e-5,rtol=0)
            if 'triangles' in e:errors.append(compare(e['triangles'],imported[name]['triangles'],check_normals=False))
        result['reimport']=dict(pass_geometry_material_winding_hierarchy=True,
            maximum_position_error=max(e['maximum_position_error'] for e in errors),
            maximum_normal_component_error=max(e['maximum_normal_component_error'] for e in errors))
        assert result['reimport']['maximum_normal_component_error']<.001,'Reimport normals diverged'
        if a.negative_test:result['negative_tests'].update(recognizer_negative_tests(a.source))
        result['limitations']=['Not an official Khronos-validator run; explicit structural and geometry checks.',
            'Intentional open single-face window details; not a watertight derivative.',
            'Linked mesh nodes are shared buffers, not automatic GPU instancing.',
            'Blender reimport normal reconstruction is measured, not assumed exact.',
            'Browser MeshToon appearance, target-device performance and runtime integration remain separate pending gates.']
        out.write_text(json.dumps(result,indent=2)+'\n');print('CITY VALIDATION PASS',out,flush=True)
    finally:assert all(P.sha(f)==h for f,h in hashes.items()),'Validation changed an input'


if __name__=='__main__':main()
