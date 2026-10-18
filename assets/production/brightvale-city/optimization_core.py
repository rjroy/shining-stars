"""Targeted reduction policy and lossless material/spatial GLB batching helpers."""
import copy,math

def policy(family,roles,has_uv=False,custom_normals=False):
    if has_uv or custom_normals:return 'protected'
    if family=='07' and roles=={'city.foliage'}:return 'leaf-collapse-0.5'
    if family in {'02','03'} and roles=={'city.trim'}:return 'trim-planar-2deg'
    return 'protected'

def component_triangle_counts(mesh):
    parent=list(range(len(mesh.vertices)))
    def find(i):
        while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
        return i
    for edge in mesh.edges:
        a,b=map(find,edge.vertices);parent[a]=b
    counts={};mesh.calc_loop_triangles()
    for triangle in mesh.loop_triangles:
        root=find(triangle.vertices[0]);counts[root]=counts.get(root,0)+1
    return sorted(counts.values())

def components(mesh):return len(component_triangle_counts(mesh))

def component_reduction_safe(original,reduced,leaf=False):
    before=component_triangle_counts(original);after=component_triangle_counts(reduced)
    return bool(after) and len(before)==len(after) and (not leaf or min(after)>=min(4,min(before)))

def node_matrix(node):
    import numpy as np
    if 'matrix' in node:return np.array(node['matrix'],dtype=np.float64).reshape(4,4).T
    x,y,z,w=node.get('rotation',[0,0,0,1]);m=np.eye(4)
    m[:3,:3]=[[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]]
    m[:3,:3]*=np.array(node.get('scale',[1,1,1]))[None,:];m[:3,3]=node.get('translation',[0,0,0]);return m

def world_matrices(doc):
    import numpy as np
    result={}
    def visit(i,parent):
        assert i not in result,'Repeated node or cycle'
        result[i]=parent@node_matrix(doc['nodes'][i])
        for child in doc['nodes'][i].get('children',[]):visit(child,result[i])
    for i in doc['scenes'][doc.get('scene',0)]['nodes']:visit(i,np.eye(4))
    return result

def accessor(doc,binary,index):
    import numpy as np
    a=doc['accessors'][index];assert 'sparse' not in a and not a.get('normalized',False)
    v=doc['bufferViews'][a['bufferView']];dtype=np.dtype({5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']]);size={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    return np.ndarray((a['count'],size),dtype=dtype,buffer=binary,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',size*dtype.itemsize),dtype.itemsize))

def transform_attributes(attributes,matrix):
    import numpy as np
    result={k:v.copy() for k,v in attributes.items()}
    result['POSITION']=(attributes['POSITION'].astype(np.float64)@matrix[:3,:3].T+matrix[:3,3]).astype('<f4')
    n=attributes['NORMAL'].astype(np.float64)@np.linalg.inv(matrix[:3,:3]);n/=np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-30);result['NORMAL']=n.astype('<f4')
    assert all(np.isfinite(v).all() for v in result.values())
    return result

def batch_glb(doc,binary,cell_size=32):
    """No simplification here. One exact-material/family/3D-cell/UV-layout group.

    Input is already Y-up. Bake each node world transform once, with inverse-
    transpose normals. Output identity nodes. Do not bake the game placement.
    """
    import numpy as np
    assert cell_size>0
    worlds=world_matrices(doc);groups={};root=next(n for n in doc['nodes'] if n.get('name')=='CITY.ProvisionalLayout')
    for i,node in enumerate(doc['nodes']):
        if 'mesh' not in node:continue
        assert not node.get('extensions',{}).get('EXT_mesh_gpu_instancing'),'Expand/count instances explicitly before batching'
        source=node['extras']['source_object'];family=node['extras']['city_family']
        for primitive in doc['meshes'][node['mesh']]['primitives']:
            assert primitive.get('mode',4)==4
            attrs=transform_attributes({k:accessor(doc,binary,j) for k,j in primitive['attributes'].items()},worlds[i])
            assert set(attrs)<={'POSITION','NORMAL','TEXCOORD_0'}
            inds=accessor(doc,binary,primitive['indices'])[:,0].astype(np.uint32)
            center=(attrs['POSITION'].min(axis=0)+attrs['POSITION'].max(axis=0))*.5
            cell=tuple(math.floor(float(x)/cell_size) for x in center)
            key=(family,primitive['material'],cell,tuple(sorted(attrs)))
            groups.setdefault(key,[]).append((source,attrs,inds))
    result=dict(asset=copy.deepcopy(doc['asset']),scene=0,scenes=[dict(nodes=[0])],nodes=[dict(name='CITY.ProvisionalLayout',extras=copy.deepcopy(root.get('extras',{})),children=[])],meshes=[],materials=copy.deepcopy(doc['materials']),buffers=[dict(byteLength=0)],bufferViews=[],accessors=[])
    for k in ['extensionsUsed','extensionsRequired']:
        if k in doc:result[k]=copy.deepcopy(doc[k])
    payload=bytearray();coverage=[];triangles=0;corners_checked=0
    def put(a,kind,target):
        a=np.ascontiguousarray(a);padding=(-len(payload))%4;payload.extend(b'\0'*padding);offset=len(payload);payload.extend(a.tobytes())
        view=len(result['bufferViews']);result['bufferViews'].append(dict(buffer=0,byteOffset=offset,byteLength=a.nbytes,target=target))
        component_type={np.dtype('uint16'):5123,np.dtype('uint32'):5125}.get(a.dtype,5126)
        rec=dict(bufferView=view,componentType=component_type,count=len(a),type=kind)
        if target==34962 and kind=='VEC3':rec.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
        idx=len(result['accessors']);result['accessors'].append(rec);return idx
    for key,members in sorted(groups.items()):
        family,material,cell,layout=key;name=f'Batch.{family}.{material:03d}.{cell[0]}.{cell[1]}.{cell[2]}.uv{int("TEXCOORD_0" in layout)}'
        attrs={k:np.concatenate([a[k] for _,a,_ in members]) for k in layout};offsets=np.cumsum([0]+[len(a['POSITION']) for _,a,_ in members[:-1]])
        inds=np.concatenate([ind+offset for (_,_,ind),offset in zip(members,offsets)]).astype('<u4')
        # Exact attribute-tuple deduplication only; normals/UV seams stay split.
        widths=[attrs[k].shape[1] for k in layout];joined=np.concatenate([attrs[k] for k in layout],axis=1);unique,inverse=np.unique(joined,axis=0,return_inverse=True)
        new_indices=inverse[inds].astype('<u2' if len(unique)<=65535 else '<u4');assert np.array_equal(unique[new_indices],joined[inds]);corners_checked+=len(inds)
        cuts=np.cumsum([0]+widths);packed={k:unique[:,cuts[j]:cuts[j+1]] for j,k in enumerate(layout)}
        attributes={k:put(v,'VEC'+str(v.shape[1]),34962) for k,v in packed.items()};index=put(new_indices.reshape(-1,1),'SCALAR',34963)
        mesh=len(result['meshes']);result['meshes'].append(dict(name=name,primitives=[dict(attributes=attributes,indices=index,material=material,mode=4)]))
        ni=len(result['nodes']);result['nodes'][0]['children'].append(ni);result['nodes'].append(dict(name=name,mesh=mesh,extras=dict(city_family=family,city_role=doc['materials'][material]['extras']['city_role'],source_count=len(members),batch_cell=list(cell))))
        count=len(inds)//3;triangles+=count;coverage.append(dict(batch=name,family=family,material=doc['materials'][material]['name'],cell=list(cell),triangles=count,members=[dict(source_object=s,triangles=len(ind)//3) for s,_,ind in members]))
    result['buffers'][0]['byteLength']=len(payload)
    return result,bytes(payload),dict(cell_size_BU=cell_size,groups=coverage,triangles=triangles,triangle_corners_exactly_checked=corners_checked,method='Family + exact original material + 32-BU 3D cell by primitive world-bounds center + attribute layout; each source primitive kept whole. Exact tuple dedup only. All transformed triangle attributes unchanged by batching.')
