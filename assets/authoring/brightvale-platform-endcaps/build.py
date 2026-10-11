"""Reproduce the approved endcap shape into a NEW candidate directory only.

Blender --background --python-exit-code 1 --python build.py -- --output-dir NEW
Output must be a new directory in this package or /tmp/opencode. Never exports.
The approved endcaps.blend is never overwritten. Historical candidate labels and
the generated endcaps-candidate.blend filename remain deliberate rebuild safeguards.
"""
import argparse, sys, hashlib, json
from pathlib import Path
import bpy, bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
PLATFORM = ROOT.parent / 'neon-twilight-platform' / 'platform.blend'
APPROVED_SHA = 'ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af'
# Counterclockwise Y/Z outline: front -Y, rear +Y, bottom is a seated plinth.
PROFILE = [(-2.8,-.65),(2.7,-.65),(2.7,1.15),(1.65,1.15),
           (1.45,1.15),(1.30,1.0675),(.45,.60),(-2.10,.30),
           (-2.50,-.30),(-2.8,-.30)]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def output_path(path):
    p=path.resolve()
    if not any(p.is_relative_to(r) and p!=r for r in (ROOT,Path('/tmp/opencode'))):
        raise ValueError('Output outside authorized package/scratch')
    return p

def bounds(objects):
    dg=bpy.context.evaluated_depsgraph_get(); points=[]
    for o in objects:
        ev=o.evaluated_get(dg); me=ev.to_mesh()
        points.extend(o.matrix_world@v.co for v in me.vertices)
        ev.to_mesh_clear()
    lo=[min(v[i] for v in points) for i in range(3)]
    hi=[max(v[i] for v in points) for i in range(3)]
    return {'min':lo,'max':hi,'dimensions':[hi[i]-lo[i] for i in range(3)]}

def inset(loop, distance):
    result=[]
    for i,p in enumerate(loop):
        a,b,c=Vector(loop[i-1]),Vector(p),Vector(loop[(i+1)%len(loop)])
        t0=(b-a).normalized(); t1=(c-b).normalized()
        n0=Vector((-t0.y,t0.x)); n1=Vector((-t1.y,t1.x))
        bis=(n0+n1).normalized()
        result.append(tuple(b+bis*(distance/bis.dot(n0))))
    return result

def material(name,color,metal,rough):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Metallic'].default_value=metal
    bs.inputs['Roughness'].default_value=rough
    return m

def cap(side,collection,blue,gold):
    """One closed shaped extrusion, raised edge bands and inset side cheeks.

    Stations form real trim relief, not disconnected box/curve decorations.
    Faces retain blue/gold material regions for editing and later pipeline work.
    """
    # Outer gold ribs stand .022 above the recessed central profile.
    sections=[(6.0,PROFILE),(6.14,PROFILE),(6.17,inset(PROFILE,.022)),
              (6.81,inset(PROFILE,.022)),(6.84,PROFILE),(6.98,PROFILE)]
    n=len(PROFILE); vertices=[(side*x,y,z) for x,loop in sections for y,z in loop]
    faces=[]; mats=[]
    for k in range(len(sections)-1):
        for i in range(n):
            j=(i+1)%n
            faces.append((k*n+i,k*n+j,(k+1)*n+j,(k+1)*n+i))
            # Bottom plinth stays blue. Other outside strips follow all profile breaks.
            mats.append(1 if (k!=2 and i!=0) or i in {3,4,8} else 0)
    for end,x in [(0,6.0),(5,6.98)]:
        # Narrow gold outline around the integrated planar mounting/side cheek.
        start=len(vertices)
        vertices.extend((side*x,y,z)
                        for y,z in inset(PROFILE,.065))
        for i in range(n):
            j=(i+1)%n
            faces.append((end*n+i,end*n+j,start+j,start+i))
            mats.append(0 if i==0 else 1)
        faces.append(tuple(range(start,start+n))); mats.append(0)
    me=bpy.data.meshes.new('Endcap profile | '+('left' if side<0 else 'right'))
    me.from_pydata(vertices,[],faces); me.materials.append(blue); me.materials.append(gold)
    for p,m in zip(me.polygons,mats): p.material_index=m
    bm=bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4])
    bm.to_mesh(me); bm.free(); me.update()
    o=bpy.data.objects.new('Endcap | '+('left' if side<0 else 'right')+' | sculpted body and gold edging',me)
    collection.objects.link(o)
    # Mesh coordinates are expressed relative to a useful seated origin.
    origin=Vector((side*6.49,0,-.65))
    for v in me.vertices: v.co-=origin
    o.location=origin
    mod=o.modifiers.new('Machined silhouette bevel','BEVEL'); mod.width=.023; mod.segments=3
    mod=o.modifiers.new('Weighted panel normals','WEIGHTED_NORMAL'); mod.keep_sharp=True
    o['status']='candidate: awaiting user model approval'
    o['profile']='raised rear / steep drop / shallow middle / steep front / low foot'
    return o

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output-dir',required=True,type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    output=output_path(args.output_dir)
    if output.exists(): raise FileExistsError(output)
    assert sha(PLATFORM)==APPROVED_SHA, 'Approved platform changed'
    # Load the actual accepted scene, not a rebuild or new platform interpretation.
    bpy.ops.wm.open_mainfile(filepath=str(PLATFORM))
    scene=bpy.context.scene
    assert scene.camera.name=='Camera | concept v4 comparison'
    source_objects=list(scene.objects)
    source_geo=[o for o in source_objects if o.type in {'MESH','CURVE'} and not o.name.startswith('Studio')]
    measured=bounds(source_geo)
    assert abs(measured['max'][0]-6)<1e-6 and abs(measured['min'][0]+6)<1e-6
    # Local imported reference, structurally preserved. The sibling source remains authority.
    ref=bpy.data.collections.new('REFERENCE | approved platform v8.3 | read-only context')
    studio=bpy.data.collections.new('STUDIO | accepted comparison rig')
    candidate=bpy.data.collections.new('CANDIDATE | endcap pair | UNAPPROVED')
    for c in (ref,studio,candidate): scene.collection.children.link(c)
    for o in source_objects:
        dest=ref if o in source_geo else studio
        for c in list(o.users_collection): c.objects.unlink(o)
        dest.objects.link(o)
    for c in list(bpy.data.collections):
        if c not in {ref,studio,candidate} and not c.objects and not c.children:
            bpy.data.collections.remove(c)
    blue=material('Endcap body | midnight-blue enamel',(.015,.028,.065),.45,.32)
    gold=material('Endcap edging | warm brushed gold',(.72,.36,.075),.82,.25)
    pair=[cap(s,candidate,blue,gold) for s in (-1,1)]
    scene['endcap_authorization']='shining-stars-4f4.19: user selected Approve and model; no export/integration'
    scene['platform_source_sha256']=APPROVED_SHA
    scene['platform_reference_authority']='../neon-twilight-platform/platform.blend; local imported geometry is context only'
    scene['candidate_status']='UNAPPROVED; pending user review of actual model evidence'
    scene['measured_platform_bounds']=json.dumps(measured,sort_keys=True)
    scene.render.filepath='//preview-output.png'
    output.mkdir(parents=True,exist_ok=False)
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'endcaps-candidate.blend'))
    assert sha(PLATFORM)==APPROVED_SHA, 'Platform changed during build'
    print('BUILD_PASS',json.dumps({'platform':measured,'candidate':bounds(pair),'platform_sha_before_after':APPROVED_SHA}))

if __name__=='__main__': main()
