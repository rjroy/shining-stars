"""Batching-only repartition of the retained reduced GLB; no reevaluation/decimation."""
import copy,hashlib,json,math
import numpy as np
from optimization_core import accessor
from glb_checks import identity

def recover_pieces(doc,binary,coverage):
    assert all(identity(n) for n in doc['nodes']),'Input must already be world-baked Y-up, with identity nodes'
    assert not any('EXT_mesh_gpu_instancing' in n.get('extensions',{}) for n in doc['nodes']),'Never silently drop instance multiplicity'
    nodes={n['name']:n for n in doc['nodes'] if 'mesh' in n};pieces=[]
    assert set(nodes)=={g['batch'] for g in coverage['groups']}
    for group in coverage['groups']:
        node=nodes[group['batch']];primitives=doc['meshes'][node['mesh']]['primitives'];assert len(primitives)==1;p=primitives[0];assert p.get('mode',4)==4
        material=p['material'];assert doc['materials'][material]['name']==group['material']
        attrs={k:accessor(doc,binary,i) for k,i in p['attributes'].items()};indices=accessor(doc,binary,p['indices'])[:,0];offset=0
        for member in group['members']:
            length=member['triangles']*3;selected=indices[offset:offset+length];assert len(selected)==length
            # Do not carry unreferenced vertices from the old broad batch into
            # each recovered piece: they would create phantom culling bounds.
            used,inverse=np.unique(selected,return_inverse=True);local={k:v[used].copy() for k,v in attrs.items()};xyz=local['POSITION']
            pieces.append(dict(id=len(pieces),source_object=member['source_object'],family=group['family'],material=material,old_batch=group['batch'],old_index_offset=offset,attrs=local,indices=inverse.astype('<u4'),lo=xyz.min(axis=0),hi=xyz.max(axis=0)))
            offset+=length
        assert offset==len(indices) and offset==group['triangles']*3
    return pieces

def partition(pieces,cell_size,max_span):
    assert cell_size>0 and max_span>=cell_size
    buckets={};large=[]
    for p in pieces:
        if float(np.max(p['hi']-p['lo']))>max_span:
            large.append(dict(members=[p],lo=p['lo'].copy(),hi=p['hi'].copy(),oversized_original_piece=True));continue
        center=(p['lo'].astype(np.float64)+p['hi'])*.5;cell=tuple(math.floor(float(v)/cell_size) for v in center)
        key=(p['family'],p['material'],tuple(sorted(p['attrs'])),cell);buckets.setdefault(key,[]).append(p)
    groups=[]
    for key,members in sorted(buckets.items()):
        bins=[]
        for p in sorted(members,key=lambda p:(tuple(p['lo']),p['source_object'],p['id'])):
            choices=[]
            for i,g in enumerate(bins):
                lo=np.minimum(g['lo'],p['lo']);hi=np.maximum(g['hi'],p['hi']);span=hi-lo
                if float(span.max())<=max_span:
                    # Tightest resulting diagonal; stable bin index tie break.
                    choices.append((float(np.dot(span,span)),i,lo,hi))
            if choices:
                _,i,lo,hi=min(choices,key=lambda t:(t[0],t[1]));bins[i]['members'].append(p);bins[i].update(lo=lo,hi=hi)
            else:bins.append(dict(members=[p],lo=p['lo'].copy(),hi=p['hi'].copy(),oversized_original_piece=False))
        groups.extend(bins)
    groups.extend(large)
    groups.sort(key=lambda g:(g['members'][0]['family'],g['members'][0]['material'],tuple(g['lo']),tuple(p['id'] for p in g['members'])))
    assert sorted(p['id'] for g in groups for p in g['members'])==list(range(len(pieces)))
    return groups

def bounding_sphere(group):
    # Installed Three GLTFLoader.computeBounds uses half the AABB diagonal,
    # not BufferGeometry.computeBoundingSphere's tighter vertex-distance radius.
    center=(group['lo'].astype(np.float64)+group['hi'])*.5
    return center,float(np.linalg.norm(group['hi'].astype(np.float64)-group['lo']))*.5

def pack(doc,groups):
    root=next(n for n in doc['nodes'] if n.get('name')=='CITY.ProvisionalLayout')
    out=dict(asset=copy.deepcopy(doc['asset']),scene=0,scenes=[dict(nodes=[0])],nodes=[dict(name='CITY.ProvisionalLayout',extras=copy.deepcopy(root.get('extras',{})),children=[])],meshes=[],materials=copy.deepcopy(doc['materials']),buffers=[dict(byteLength=0)],bufferViews=[],accessors=[])
    for k in ['extensionsUsed','extensionsRequired']:
        if k in doc:out[k]=copy.deepcopy(doc[k])
    blob=bytearray();coverage=[];corners=0
    def put(a,kind,target):
        a=np.ascontiguousarray(a);blob.extend(b'\0'*((-len(blob))%4));offset=len(blob);blob.extend(a.tobytes());view=len(out['bufferViews']);out['bufferViews'].append(dict(buffer=0,byteOffset=offset,byteLength=a.nbytes,target=target))
        rec=dict(bufferView=view,componentType={np.dtype('uint16'):5123,np.dtype('uint32'):5125}.get(a.dtype,5126),count=len(a),type=kind)
        if target==34962 and kind=='VEC3':rec.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
        i=len(out['accessors']);out['accessors'].append(rec);return i
    for number,g in enumerate(groups):
        members=g['members'];first=members[0];layout=tuple(sorted(first['attrs']));material=first['material'];family=first['family']
        assert all(p['material']==material and p['family']==family and tuple(sorted(p['attrs']))==layout for p in members)
        attrs={k:np.concatenate([p['attrs'][k] for p in members]) for k in layout};offsets=np.cumsum([0]+[len(p['attrs']['POSITION']) for p in members[:-1]]);ii=np.concatenate([p['indices']+offset for p,offset in zip(members,offsets)])
        joined=np.ascontiguousarray(np.concatenate([attrs[k] for k in layout],axis=1),dtype='<f4')
        # Preserve signed zero and every attribute bit, not merely float equality.
        unique,inverse=np.unique(joined.view('<u4'),axis=0,return_inverse=True);values=unique.view('<f4');indices=inverse[ii].astype('<u2' if len(unique)<=65535 else '<u4')
        assert np.array_equal(unique[indices],joined.view('<u4')[ii]);corners+=len(ii)
        cuts=np.cumsum([0]+[attrs[k].shape[1] for k in layout]);attributes={k:put(values[:,cuts[j]:cuts[j+1]],'VEC'+str(attrs[k].shape[1]),34962) for j,k in enumerate(layout)};index=put(indices.reshape(-1,1),'SCALAR',34963)
        name=f'Spatial.{family}.{material:03d}.{number:04d}';mesh=len(out['meshes']);out['meshes'].append(dict(name=name,primitives=[dict(attributes=attributes,indices=index,material=material,mode=4)]));node=len(out['nodes']);out['nodes'][0]['children'].append(node);out['nodes'].append(dict(name=name,mesh=mesh,extras=dict(city_family=family,city_role=doc['materials'][material]['extras']['city_role'],source_count=len(members))))
        center,radius=bounding_sphere(g)
        coverage.append(dict(batch=name,family=family,material=doc['materials'][material]['name'],bounds=[g['lo'].tolist(),g['hi'].tolist()],sphere_center=center.tolist(),sphere_radius=radius,oversized_original_piece=g['oversized_original_piece'],triangles=len(ii)//3,members=[dict(piece_id=p['id'],source_object=p['source_object'],triangles=len(p['indices'])//3,old_batch=p['old_batch'],old_index_offset=p['old_index_offset']) for p in members]))
    out['buffers'][0]['byteLength']=len(blob)
    return out,bytes(blob),dict(groups=coverage,triangle_corners_byte_compared=corners,method='Recover original reduced source primitives from retained index ranges; bounds-limited deterministic spatial bins; isolate oversized original primitives; no surface split or attribute transform.')

def geometry_digest(pieces):
    h=hashlib.sha256()
    for p in sorted(pieces,key=lambda p:p['id']):
        h.update(json.dumps([p['id'],p['source_object'],p['family'],p['material']],separators=(',',':')).encode())
        for key in sorted(p['attrs']):h.update(key.encode());h.update(np.ascontiguousarray(p['attrs'][key][p['indices']]).tobytes())
    return h.hexdigest()
