"""Reopen native derivative, inspect GLB bytes/geometry and test deliberate defects.

No external validator/library installation and no browser/runtime claims.
"""
import argparse
import collections
import copy
import hashlib
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
    assert len(bpy.data.objects)==31 and len(bpy.data.meshes)==24, 'Native object/mesh scope changed'
    assert set(bpy.data.collections.keys())=={'CITY_ASSET'}
    assert set(bpy.data.materials.keys())==set(P.ROLES)
    assert not bpy.data.images and not bpy.data.libraries
    assert 'Landmark.ArticulatedSpire' in bpy.data.objects
    assert all(o.type in {'MESH','EMPTY'} and not o.modifiers and not o.animation_data for o in bpy.data.objects)
    assert {o.name for o in bpy.data.objects if o.type=='EMPTY'}=={'CITY.ProvisionalLayout',*P.DISTRICTS}
    inv=P.inventory(list(bpy.data.objects))
    assert inv['placed_triangles']==36489 and inv['unique_triangles']==33246
    assert inv['linked_additional_placements']==3
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
    return dict(**inv,intentional_open_detail_edges=boundary,invalid_nonmanifold_edges=nonmanifold,degenerate_faces=degenerate)


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
    max_position=max_normal=0
    for r in actual:
        k,p,n=canonical(r)
        assert k in bins and bins[k], 'Triangle/material/winding changed'
        candidates=bins[k]
        j=min(range(len(candidates)),key=lambda j:np.max(np.abs(p-candidates[j][0]))+np.max(np.abs(n-candidates[j][1])))
        q,m=candidates.pop(j)
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


def inspect(doc,buf,expected):
    assert doc['asset']['version']=='2.0'
    assert len(doc['nodes'])==31 and len(doc['meshes'])==24,'Unexpected export scope'
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
    assert len(visited)==31
    all_points=[];placed=0;primitive_placements=0;comparisons=[];mesh_users=collections.defaultdict(list)
    triangles_by_role=collections.Counter()
    for i,n in enumerate(nodes):
        e=expected[n['name']]
        assert parent[i]==e['parent'],'Hierarchy changed'
        target=AXES@Matrix(e['matrix'])@AXES.inverted()
        assert np.allclose(np.array(world[i]),np.array(target),atol=2e-5,rtol=0),'Source transform drift'
        assert n['extras']['source_object']==n['name']
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
    assert placed==36489
    repeats=sorted(sorted(v) for v in mesh_users.values() if len(v)>1)
    expected_repeats=collections.defaultdict(list)
    for name,e in expected.items():
        if e['type']=='MESH':expected_repeats[e['mesh']].append(name)
    assert repeats==sorted(sorted(v) for v in expected_repeats.values() if len(v)>1),'Shared mesh reuse lost'
    points=np.array(all_points)
    lo=points.min(axis=0);hi=points.max(axis=0)
    assert np.allclose(lo,[-117.44999694824219,-7,-60.36000061035156],atol=2e-5,rtol=0)
    assert np.allclose(hi,[-41.43000030517578,118,4.015000343322754],atol=2e-5,rtol=0)
    primitives=[p for m in doc['meshes'] for p in m['primitives']]
    return dict(nodes=len(nodes),unique_meshes=len(doc['meshes']),unique_primitives=len(primitives),
        placed_primitives=primitive_placements,placed_triangles=placed,
        unique_triangles=sum(doc['accessors'][p['indices']]['count']//3 for p in primitives),
        decoded_unique_primitive_vertices=sum(doc['accessors'][p['attributes']['POSITION']]['count'] for p in primitives),
        buffer_bytes=len(buf),bounds_gltf=dict(min=lo.tolist(),max=hi.tolist()),
        linked_node_groups=repeats,triangles_by_role=dict(triangles_by_role),materials=materials,
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
        ('reuse_lost',lambda d:d['meshes'].append(copy.deepcopy(d['meshes'][0])))]:
        bad=copy.deepcopy(doc);mutation(bad)
        try:inspect(bad,buf,expected)
        except AssertionError:results[name+'_rejected']=True
        else:raise AssertionError('Deliberate defect accepted: '+name)
    first=next(e['triangles'] for e in expected.values() if 'triangles' in e)
    role,p,n=first[0]
    try:compare([first[0]],[(role,p,-n)])
    except AssertionError:results['flipped_normals_rejected']=True
    else:raise AssertionError('Flipped normals accepted')
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


def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=P.SOURCE)
    p.add_argument('--blend',type=Path,required=True);p.add_argument('--glb',type=Path,required=True)
    p.add_argument('--report',type=Path,required=True);p.add_argument('--compare',type=Path)
    p.add_argument('--negative-test',action='store_true')
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=P.output(a.report,'.json')
    hashes={str(f):P.sha(f) for f in (a.source,a.blend,a.glb)}
    try:
        whole=P.load_source(a.source);baseline=P.select_slice();changes=P.derive();regenerated=snapshot()
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
                    source_slice=baseline,derived_native=native,glb=exported,transfer_bytes=a.glb.stat().st_size,
                    derivative_reopen_and_independent_regeneration='PASS',source_unchanged=True)
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
        result['limitations']=['Not an official Khronos-validator run; explicit structural and geometry checks.',
            'Intentional open single-face window details; not a watertight derivative.',
            'Linked mesh nodes are shared buffers, not automatic GPU instancing.',
            'Blender reimport normal reconstruction is measured, not assumed exact.',
            'Browser MeshToon appearance, target-device performance and runtime integration remain separate pending gates.']
        out.write_text(json.dumps(result,indent=2)+'\n');print('CITY VALIDATION PASS',out,flush=True)
    finally:assert all(P.sha(f)==h for f,h in hashes.items()),'Validation changed an input'


if __name__=='__main__':main()
