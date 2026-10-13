"""Read-only native/export/source comparisons, reproduction and injected defects."""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
import struct
import sys
from pathlib import Path
sys.dont_write_bytecode = True
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

spec = importlib.util.spec_from_file_location('crowd_build', Path(__file__).with_name('build.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)

def geometry(obj):
    mesh = obj.data; mesh.calc_loop_triangles()
    vertices = np.array([tuple(v.co) for v in mesh.vertices])
    faces = np.array([tuple(t.vertices) for t in mesh.loop_triangles])
    assert np.isfinite(vertices).all(), 'Non-finite vertices'
    normals = np.array([tuple(v.normal) for v in mesh.vertices])
    assert np.isfinite(normals).all(), 'Non-finite normals'
    areas = np.linalg.norm(np.cross(vertices[faces[:,1]]-vertices[faces[:,0]],
                                    vertices[faces[:,2]]-vertices[faces[:,0]]), axis=1)
    assert min(areas) > 1e-12, 'Degenerate face'
    assert all(0 <= p.material_index < len(mesh.materials) for p in mesh.polygons), 'Material mapping'
    assert abs(vertices[:,2].min()) < 1e-6, 'Feet not grounded'
    for side in (-1,1):
        foot=vertices[(vertices[:,0]*side>0)&(vertices[:,2]<.12)]
        # Collapse may leave one sole a fraction of a millimetre above the
        # common plane. Keep a declared 0.1 mm contact tolerance, not pixel-scale.
        assert len(foot) and abs(foot[:,2].min())<1e-4, 'One foot floats'
    assert np.max(np.abs(np.array(obj.matrix_local)-np.eye(4))) < 1e-7, 'Nonidentity local transform'
    return vertices, faces

def record(obj):
    v,f = geometry(obj)
    mats = [m.name.rsplit('.',1)[0] if m.name.rsplit('.',1)[-1].isdigit() else m.name for m in obj.data.materials]
    values={}
    for name,mat in zip(mats,obj.data.materials):
        bsdf=mat.node_tree.nodes.get('Principled BSDF')
        values[name]={'base':list(bsdf.inputs['Base Color'].default_value),
                      'roughness':bsdf.inputs['Roughness'].default_value,
                      'metallic':bsdf.inputs['Metallic'].default_value}
    payload = {'vertices':np.round(v,7).tolist(), 'triangles':f.tolist(),
               'assignments':[p.material_index for p in obj.data.polygons],
               'smooth':[p.use_smooth for p in obj.data.polygons], 'materials':mats,'material_values':values}
    return {'fingerprint':hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest(),
            'triangles':len(f), 'vertices':len(v), 'bounds_blender':B.bounds(obj.data),
            'material_names':mats,'material_values':values,
            'foot_min_z':[float(v[(v[:,0]*side>0)&(v[:,2]<.12),2].min()) for side in (-1,1)]}

def silhouette(v, f, angle, height=150, upper=False):
    # Rasterized orthographic geometric occupancy, no lighting/material influence.
    # Pixel scale 150 / 2.1m; same camera and framing for original and derivative.
    x = v[:,0]*math.cos(angle)+v[:,1]*math.sin(angle)
    pts = np.column_stack((x*height/2.1+height/2, v[:,2]*height/2.1+3))
    mask = np.zeros((height,height), dtype=bool)
    for ids in f:
        p=pts[ids]; lo=np.maximum(np.floor(p.min(axis=0)).astype(int),0)
        hi=np.minimum(np.ceil(p.max(axis=0)).astype(int),height-1)
        if (lo>hi).any(): continue
        xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
        cross=[]
        for i in range(3):
            a,b=p[i],p[(i+1)%3]
            cross.append((b[0]-a[0])*(yy-a[1])-(b[1]-a[1])*(xx-a[0]))
        hit=(np.array(cross)>=-1e-9).all(axis=0)|(np.array(cross)<=1e-9).all(axis=0)
        mask[lo[1]:hi[1]+1,lo[0]:hi[0]+1] |= hit
    if upper: mask[:int(1.0*height/2.1+3),:] = False
    return mask

def likeness(source, candidate):
    sv,sf=geometry(source); cv,cf=geometry(candidate)
    result={}
    for height in (66,150):
        for label,angle in [('front',0),('threequarter',math.pi/4),('side',math.pi/2),('back',math.pi)]:
            for upper in (False,True):
                a=silhouette(sv,sf,angle,height,upper); b=silhouette(cv,cf,angle,height,upper)
                score=np.logical_and(a,b).sum()/np.logical_or(a,b).sum()
                result[f'{label}_{height}' + ('_upper' if upper else '')]=round(float(score),6)
    # Surface displacement in both directions: vertices plus triangle centroids.
    distances=[]
    for a,af,b,bf in ((sv,sf,cv,cf),(cv,cf,sv,sf)):
        tree=BVHTree.FromPolygons([Vector(p) for p in b], bf.tolist(), all_triangles=True)
        points=np.concatenate([a,a[af].mean(axis=1)])
        distances.extend(tree.find_nearest(Vector(p))[3] for p in points)
    result['surface_max_m']=max(distances)
    result['surface_p95_m']=float(np.percentile(distances,95))
    # These are regression tolerances, not approved budgets or visual approval.
    assert min(v for k,v in result.items() if not k.startswith('surface')) > .94, 'Silhouette regression'
    assert result['surface_max_m'] < .025, 'Excess source-surface displacement'
    return result

def glb_data(path):
    data=Path(path).read_bytes()
    magic,version,total=struct.unpack_from('<4sII',data)
    assert magic==b'glTF' and version==2 and total==len(data), 'Bad GLB header'
    n,kind=struct.unpack_from('<II',data,12); assert kind==0x4e4f534a
    doc=json.loads(data[20:20+n]); off=20+n
    bn,bkind=struct.unpack_from('<II',data,off); assert bkind==0x004e4942
    return doc,data[off+8:off+8+bn]

def export_check(doc, blob, native):
    assert not any(doc.get(k) for k in ('animations','skins','images','textures')), 'Unexpected runtime payload'
    assert not doc.get('extensionsRequired'), 'Unexpected required extension'
    assert len(doc['meshes'])==9, 'Pose geometry missing'
    def accessor(idx):
        a=doc['accessors'][idx]; view=doc['bufferViews'][a['bufferView']]
        dtype={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']]
        n={'SCALAR':1,'VEC3':3}[a['type']]
        width=np.dtype(dtype).itemsize*n; stride=view.get('byteStride',width)
        offset=view.get('byteOffset',0)+a.get('byteOffset',0)
        assert offset+(a['count']-1)*stride+width <= len(blob), 'Accessor overrun'
        return np.ndarray((a['count'],n),dtype=dtype,buffer=blob,offset=offset,strides=(stride,np.dtype(dtype).itemsize)).copy()
    roots={n['name']:n for n in doc['nodes'] if n.get('extras',{}).get('static_review_only')}
    assert set(roots)==set(native), 'Stable pose IDs missing'
    total=0; decoded=0; all_bounds={}
    for pid,root in roots.items():
        assert root.get('translation',[0,0,0])==[0,0,0] and root.get('scale',[1,1,1])==[1,1,1]
        assert root.get('rotation',[0,0,0,1])==[0,0,0,1], 'Unexpected root rotation'
        assert root['extras']['forward_gltf']==[0,0,1], 'Forward contract'
        child=doc['nodes'][root['children'][0]]
        assert child.get('translation',[0,0,0])==[0,0,0]
        positions=[]; count=0; roles=set()
        for prim in doc['meshes'][child['mesh']]['primitives']:
            assert prim.get('mode',4)==4
            p=accessor(prim['attributes']['POSITION']); n=accessor(prim['attributes']['NORMAL'])
            ids=accessor(prim['indices']).ravel()
            assert np.isfinite(p).all() and np.isfinite(n).all(), 'Export nonfinite data'
            assert np.max(np.abs(np.linalg.norm(n,axis=1)-1)) < 1e-4, 'Export invalid normals'
            assert len(ids)%3==0 and max(ids)<len(p), 'Invalid indices'
            t=p[ids.reshape(-1,3)]
            assert min(np.linalg.norm(np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]),axis=1))>1e-12, 'Export degenerate'
            mat=doc['materials'][prim['material']]
            assert mat.get('extras',{}).get('family') in ('skin','hair','clothes','face'), 'Lost material roles'
            assert not any(mat.get('emissiveFactor',[0,0,0])), 'Unexpected emission'
            expected_mat=native[pid]['material_values'][mat['name']]
            pbr=mat['pbrMetallicRoughness']
            assert max(abs(a-b) for a,b in zip(pbr.get('baseColorFactor',[1,1,1,1]),expected_mat['base']))<1e-6, 'PBR color loss'
            assert abs(pbr.get('roughnessFactor',1)-expected_mat['roughness'])<1e-6, 'PBR roughness loss'
            assert abs(pbr.get('metallicFactor',1)-expected_mat['metallic'])<1e-6, 'PBR metalness loss'
            roles.add(mat['name']); positions.extend(p.tolist());count+=len(ids)//3
            decoded+=p.nbytes+n.nbytes+ids.nbytes
        assert roles==set(native[pid]['material_names']), 'Export material assignment loss'
        assert count==native[pid]['triangles'], 'Export geometry count'
        a=np.array(positions); lo=a.min(axis=0);hi=a.max(axis=0)
        b=native[pid]['bounds_blender'];expected=np.array([[b[0][0],b[0][2],-b[1][1]],[b[1][0],b[1][2],-b[0][1]]])
        assert np.max(abs(np.array([lo,hi])-expected))<1e-6, 'Y-up/ground/bounds mismatch'
        all_bounds[pid]=[lo.tolist(),hi.tolist()];total+=count
    return {'triangles':total,'mesh_primitives':sum(len(m['primitives']) for m in doc['meshes']),
            'materials':len(doc['materials']),'decoded_attribute_index_bytes':decoded,'bounds_gltf':all_bounds}

def must_fail(label, fn):
    try: fn()
    except (AssertionError,ValueError,IndexError): return label
    raise AssertionError('Negative test incorrectly passed: '+label)

def validate(args):
    source=args.source.resolve(); blend=Path(bpy.data.filepath)
    B.protected(source); before=B.sha(blend)
    assert bpy.context.scene.get('source_sha256')==B.SOURCE_SHA
    surfaces={o.parent.name:o for o in bpy.context.scene.objects if o.type=='MESH'}
    expected={'Crowd.'+c+'.'+p for c in 'ABC' for p in B.POSES}
    assert set(surfaces)==expected and len(bpy.context.scene.objects)==18
    assert not bpy.data.armatures and not bpy.data.actions
    native={pid:record(o) for pid,o in sorted(surfaces.items())}
    negative=[]
    if args.negative_test:
        obj=next(iter(surfaces.values())); orig=obj.data.vertices[0].co.copy()
        obj.data.vertices[0].co.z=-.1
        negative.append(must_fail('ungrounded foot',lambda:geometry(obj)))
        obj.data.vertices[0].co=orig
        foot_backup=[v.co.copy() for v in obj.data.vertices]
        for v in obj.data.vertices:
            if v.co.x<0 and v.co.z<.12:v.co.z+=.01
        negative.append(must_fail('one floating foot',lambda:geometry(obj)))
        for v,co in zip(obj.data.vertices,foot_backup):v.co=co
        obj.data.vertices[0].co.x=float('nan')
        negative.append(must_fail('nonfinite vertex',lambda:geometry(obj)))
        obj.data.vertices[0].co=orig
    # Load source into a separate in-memory scene, retaining derivative object refs.
    with bpy.data.libraries.load(str(source),link=False) as (a,b):
        b.objects=list(a.objects)
        b.actions=list(a.actions)
    for obj in b.objects: bpy.context.scene.collection.objects.link(obj)
    comparisons={}
    for pid,derivative in surfaces.items():
        _,cid,name=pid.split('.')
        B.pose(cid,name)
        original=B.merge(B.frozen_parts(cid),'comparison')
        floor=min(v.co.z for v in original.data.vertices)
        for v in original.data.vertices:v.co.z-=floor
        actual_source=B.triangles(original.data)
        assert derivative.parent['source_triangles']==actual_source
        assert native[pid]['triangles'] < actual_source*.5, 'Reduction absent'
        original_names={m.name.rsplit('.',1)[0] if m.name.rsplit('.',1)[-1].isdigit() else m.name for m in original.data.materials}
        assert set(native[pid]['material_names'])==original_names, ('Native material loss',pid,native[pid]['material_names'],original_names)
        assert record(original)['material_values']==native[pid]['material_values'], 'Source palette changed'
        comparisons[pid]={'source_triangles':actual_source, **likeness(original,derivative)}
        if args.negative_test and pid=='Crowd.A.Calm':
            backup=[v.co.copy() for v in derivative.data.vertices]
            for v in derivative.data.vertices:
                if v.co.z>1.4:v.co.x*=.3
            negative.append(must_fail('collapsed upper silhouette',lambda:likeness(original,derivative)))
            for v,co in zip(derivative.data.vertices,backup):v.co=co
        bpy.data.objects.remove(original,do_unlink=True)
    doc,blob=glb_data(args.glb)
    exported=export_check(doc,blob,native)
    if args.negative_test:
        bad=copy.deepcopy(doc);bad['meshes'][0]['primitives'][0]['material']=len(doc['materials'])+1
        negative.append(must_fail('invalid export material',lambda:export_check(bad,blob,native)))
        bad=copy.deepcopy(doc);bad['skins']=[{}]
        negative.append(must_fail('unexpected skin payload',lambda:export_check(bad,blob,native)))
        bad=copy.deepcopy(doc)
        next(n for n in bad['nodes'] if n.get('extras',{}).get('static_review_only'))['translation']=[0,.1,0]
        negative.append(must_fail('export root offset',lambda:export_check(bad,blob,native)))
    if args.compare:
        comparison={}
        with bpy.data.libraries.load(str(args.compare),link=False) as (a,b):
            b.objects=[n for n in a.objects if n.endswith('.Surface')]
        for obj in b.objects:
            comparison[obj.get('pose_id')]=record(obj)
        assert comparison==native, 'Independent regeneration mismatch'
    old_objects=set(bpy.data.objects)
    print('CROWD GLB REOPEN ATTEMPT',args.glb,flush=True)
    bpy.ops.import_scene.gltf(filepath=str(args.glb))
    imported=[o for o in bpy.data.objects if o not in old_objects and o.type=='MESH']
    assert len(imported)==9, 'GLB importer mesh count'
    for obj in imported:
        pid=obj['pose_id']; v,f=geometry(obj)
        assert len(f)==native[pid]['triangles']
        assert np.max(abs(np.array(B.bounds(obj.data))-np.array(native[pid]['bounds_blender'])))<2e-6
    print('CROWD GLB REOPEN SUCCESS',len(imported),'meshes',flush=True)
    if args.negative_test:
        negative.append(must_fail('immutable-source output',lambda:B.new_output(source,'.blend')))
        negative.append(must_fail('existing output',lambda:B.new_output(args.glb,'.glb')))
        negative.append(must_fail('outside output scope',lambda:B.new_output(Path('/etc/crowd.glb'),'.glb')))
        negative.append(must_fail('wrong source checksum',lambda:B.protected(args.glb)))
    B.protected(source);assert B.sha(blend)==before
    report={'blender':bpy.app.version_string,'source_sha256':B.SOURCE_SHA,'blend_sha256':before,
            'glb_sha256':B.sha(args.glb),'glb_bytes':args.glb.stat().st_size,
            'native':native,'source_comparison':comparisons,'export':exported,
            'negative_tests':negative,'independent_reproduction':bool(args.compare),'glb_blender_reopen':True}
    B.new_output(args.report,'.json').write_text(json.dumps(report,indent=2)+'\n')
    print('CROWD VALIDATION PASS', args.report, flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=B.SOURCE)
    p.add_argument('--glb',type=Path,required=True);p.add_argument('--report',type=Path,required=True)
    p.add_argument('--compare',type=Path);p.add_argument('--negative-test',action='store_true')
    validate(p.parse_args(sys.argv[sys.argv.index('--')+1:]))
