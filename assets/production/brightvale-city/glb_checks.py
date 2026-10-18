"""Standard-library GLB structure, assembly and count checks; no Blender dependency."""
import hashlib,json,struct
from pathlib import Path

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def read_glb(path):
    data=Path(path).read_bytes()
    if len(data)<20:raise ValueError('Truncated GLB')
    magic,version,length=struct.unpack_from('<4sII',data)
    if magic!=b'glTF' or version!=2 or length!=len(data):raise ValueError('Invalid GLB header/length')
    offset=12;document=None;binary=b''
    while offset<len(data):
        size,kind=struct.unpack_from('<II',data,offset);offset+=8
        if offset+size>len(data):raise ValueError('Truncated GLB chunk')
        chunk=data[offset:offset+size];offset+=size
        if kind==0x4e4f534a:document=json.loads(chunk)
        elif kind==0x004e4942:binary=chunk
    if document is None:raise ValueError('Missing JSON chunk')
    return document,binary

def mesh_triangles(doc,index):
    result=0
    for p in doc['meshes'][index]['primitives']:
        if p.get('mode',4)!=4:raise ValueError('Only triangle-list primitives supported')
        count=doc['accessors'][p['indices']]['count'] if 'indices' in p else doc['accessors'][p['attributes']['POSITION']]['count']
        if count%3:raise ValueError('Triangle-list count is not divisible by three')
        result+=count//3
    return result

def count_scene(doc):
    unique=sum(mesh_triangles(doc,i) for i in range(len(doc.get('meshes',[]))))
    placed=0;mesh_nodes=0;gpu_nodes=0;placements=0;referenced=set()
    def walk(index,ancestors):
        nonlocal placed,mesh_nodes,gpu_nodes,placements
        if index in ancestors:raise ValueError('Node hierarchy cycle')
        node=doc['nodes'][index]
        if 'mesh' in node:
            multiplicity=1;ext=node.get('extensions',{}).get('EXT_mesh_gpu_instancing')
            if ext is not None:
                counts={doc['accessors'][i]['count'] for i in ext['attributes'].values()}
                if len(counts)!=1:raise ValueError('Mismatched instance attribute counts')
                multiplicity=counts.pop();gpu_nodes+=1
            mesh_nodes+=1;placements+=multiplicity;referenced.add(node['mesh'])
            placed+=mesh_triangles(doc,node['mesh'])*multiplicity
        for child in node.get('children',[]):walk(child,ancestors|{index})
    for root in doc['scenes'][doc.get('scene',0)]['nodes']:walk(root,set())
    return dict(unique_meshes=len(doc.get('meshes',[])),referenced_meshes=len(referenced),unique_triangles=unique,placed_triangles=placed,mesh_nodes=mesh_nodes,mesh_placements=placements,gpu_instanced_nodes=gpu_nodes,materials=len(doc.get('materials',[])))

def identity(node):
    if 'matrix' in node:return all(abs(v-(1 if i%5==0 else 0))<1e-7 for i,v in enumerate(node['matrix']))
    return node.get('translation',[0,0,0])==[0,0,0] and node.get('rotation',[0,0,0,1])==[0,0,0,1] and node.get('scale',[1,1,1])==[1,1,1]

def check_contract(doc):
    roots=doc['scenes'][doc.get('scene',0)]['nodes']
    if len(roots)!=1:raise ValueError('Expected one assembly root')
    root=doc['nodes'][roots[0]]
    if root.get('name')!='CITY.ProvisionalLayout' or not identity(root):raise ValueError('Missing/nonidentity city root')
    if len([m for m in doc['materials'] if m.get('name')=='Window'])!=1:raise ValueError('Expected one genuine Window material')
    if any('uri' in b for b in doc.get('buffers',[])) or any('uri' in i for i in doc.get('images',[])):raise ValueError('External GLB dependency')
    if doc.get('cameras') or doc.get('animations') or doc.get('skins'):raise ValueError('Unexpected studio/animation payload')
    if 'KHR_lights_punctual' in doc.get('extensions',{}):raise ValueError('Unexpected studio lights')
    return True

def semantic_hash(doc,binary):
    return hashlib.sha256(json.dumps(doc,sort_keys=True,separators=(',',':')).encode()+binary).hexdigest()

def write_glb(path,doc,binary):
    payload=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode('utf-8');payload+=b' '*((-len(payload))%4)
    binary+=b'\0'*((-len(binary))%4)
    chunks=struct.pack('<II',len(payload),0x4e4f534a)+payload+struct.pack('<II',len(binary),0x004e4942)+binary
    Path(path).write_bytes(struct.pack('<4sII',b'glTF',2,12+len(chunks))+chunks)

def finalize_material_contract(doc,mapping):
    """Preserve metadata, IOR, and original emission color/strength factorization."""
    byname={m['export_material']:m for m in mapping};ior_names=[]
    if {m['name'] for m in doc['materials']}!=set(byname):raise ValueError('Exported material set changed')
    for m in doc['materials']:
        source=byname[m['name']]
        m['extras']={'city_role':source['city_role'],'source_material':source['source_material'],'surface_role':source['proposed_semantic_role']}
        if abs(source['ior']-1.5)>1e-7:
            m.setdefault('extensions',{})['KHR_materials_ior']={'ior':source['ior']};ior_names.append(m['name'])
        if source.get('emission_strength',0)>0:
            m['emissiveFactor']=source['emission_color']
            m.setdefault('extensions',{})['KHR_materials_emissive_strength']={'emissiveStrength':source['emission_strength']}
            doc['extensionsUsed']=sorted(set(doc.get('extensionsUsed',[]))|{'KHR_materials_emissive_strength'})
    if ior_names:doc['extensionsUsed']=sorted(set(doc.get('extensionsUsed',[]))|{'KHR_materials_ior'})
    return ior_names
