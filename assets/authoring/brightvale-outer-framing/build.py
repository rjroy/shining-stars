"""Deterministic outer framing. Run with Blender; explicit NEW output required."""
import argparse
import hashlib
import math
import sys
from pathlib import Path

import bpy
import bmesh

ROOT = Path(__file__).resolve().parent
SOURCES = {
    ROOT.parent / 'neon-twilight-platform/platform.blend': 'ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af',
    ROOT.parent / 'brightvale-platform-endcaps/endcaps.blend': 'c49ae80c34350ddb7281c3192c4ed90921852f0386fa047a9196087cc13b4207',
    ROOT.parent / 'brightvale-highway/highway.blend': '2f2eca2987cd42b105c579420ca2e2cbc71ad75d73bcbf164aca60afe32652e5',
}
ASSET = 'CANDIDATE | outer framing | UNAPPROVED'
REFERENCE = 'REFERENCE | approved assembly | context only'
STUDIO = 'STUDIO | preserved comparison rig'
MATERIAL_NAMES = ['Framing | midnight stone', 'Framing | alternate stone',
                  'Framing | blue gray capstone', 'Framing | recessed mortar',
                  'Framing | warm metal', 'Framing | amber lens']
# Provisional study coordinates, not physical crowd measurements or a game transform.
POSITIONS = {'long': .20, 'post': 5.00, 'short': 9.40}
CROWD = [((-11.10, -3., -.70), (-7.60, 18., 2.30)),
         ((7.60, -3., -.70), (11.10, 18., 2.30))]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def integrity():
    result = {p.name: sha(p) for p in SOURCES}
    for p, expected in SOURCES.items():
        assert result[p.name] == expected, f'Immutable source changed: {p}'
    return result


def allowed(path):
    p = Path(path).expanduser().resolve()
    assert any(p.is_relative_to(r) and p != r for r in (ROOT, Path('/tmp/opencode'))), f'Output outside authorized scope: {p}'
    return p


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def material(name, color, roughness=.8, metallic=0., emission=0.):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Emission Color'].default_value = (*color, 1)
    p.inputs['Emission Strength'].default_value = emission
    return m


def mesh(name, verts, faces, indices, materials, col, bevel=.012):
    m = bpy.data.meshes.new(name)
    m.from_pydata(verts, [], faces)
    m.update()
    for mat in materials:
        m.materials.append(mat)
    for polygon, index in zip(m.polygons, indices):
        polygon.material_index = index
    bm = bmesh.new()
    bm.from_mesh(m)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # All large faces become explicit triangles; shallow modeled seams remain.
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(m)
    bm.free()
    o = bpy.data.objects.new(name, m)
    col.objects.link(o)
    if bevel:
        b = o.modifiers.new('Small dressed stone edge bevel', 'BEVEL')
        b.width = bevel
        b.segments = 3
        b.limit_method = 'ANGLE'
        b.angle_limit = math.radians(60)
        b.use_clamp_overlap = True
    return o


def wall(name, length, seams, materials, col):
    # One closed, profiled masonry mass. Reveals are actual shallow recesses,
    # not strips laid over an unshaped box. Upper/lower joints drift subtly.
    levels = [(0., .68, .06, 0), (.035, .68, .06, 0), (.12, .68, .06, 0),
              (.16, .54, 0., 0), (.535, .54, 0., 0),
              (.555, .54, 0., 0), (.578, .54, 0., 0),
              (.598, .54, 0., 1), (.99, .54, 0., 1),
              (1.015, .66, .06, 2), (1.045, .68, .06, 2), (1.15, .68, .06, 2)]
    verts, faces, ids = [], [], []
    n = 2 + 4 * len(seams)
    size = 2 * n + 4
    for k, (z, depth, over, _) in enumerate(levels):
        h, d, c = length / 2 + over, depth / 2, .035
        shift = .055 if 3 <= k <= 4 else (-.035 if 7 <= k <= 8 else 0.)
        stations = [(-h + c, 0.)]
        for joint in seams:
            j = joint + shift
            stations += [(j-.020, 0.), (j-.010, .009), (j+.010, .009), (j+.020, 0.)]
        stations.append((h-c, 0.))
        def zz(recess):
            return z - (.007 if k == len(levels)-1 and recess else 0.)
        verts += [(x, -d+r, zz(r)) for x, r in stations]
        verts += [(h, -d+c, z), (h, d-c, z)]
        verts += [(x, d-r, zz(r)) for x, r in reversed(stations)]
        verts += [(-h, d-c, z), (-h, -d+c, z)]
    for k in range(len(levels)-1):
        for i in range(size):
            j = (i+1) % size
            faces.append((k*size+i, k*size+j, (k+1)*size+j, (k+1)*size+i))
            mat = levels[k][3]
            if i < n-1 or n+2 <= i < 2*n+1:
                a, b = verts[k*size+i], verts[k*size+j]
                if abs(a[0]-b[0]) < .021 and mat in (0, 1, 2):
                    mat = 3
                elif mat in (0, 1):
                    mat = (mat + int((a[0]+length/2)/(length/(len(seams)+1)))) % 2
            ids.append(mat)
    # Close top/bottom with cross-depth strips; top seam dips are fully modeled.
    for k in (0, len(levels)-1):
        off = k*size
        for i in range(n-1):
            faces.append(tuple(off+a for a in (i, i+1, 2*n-i, 2*n+1-i)))
            ids.append(3 if (i % 4 == 2 and i != n-2) else (2 if k else 0))
        faces += [tuple(off+a for a in (n-1, n, n+1, n+2)),
                  tuple(off+a for a in (2*n+3, 0, 2*n+1, 2*n+2))]
        ids += [2 if k else 0, 2 if k else 0]
    o=mesh(name, verts, faces, ids, materials[:4], col,bevel=0)
    # Few tapered diagonal fissures, shallow and contained within the stone.
    # They are geometry, not a crack texture or disconnected trim laid on top.
    paths = [(-length*.33,.22,-length*.21,.41,-length*.09,.51),
             (length*.09,.90,length*.18,.77,length*.33,.64)]
    if length<2.: paths=paths[:1]
    cv,cf=[] ,[]
    for front in (-1,1):
        for x0,z0,x1,z1,x2,z2 in paths:
            dx,dz=x2-x0,z2-z0;norm=math.hypot(dx,dz)
            nx,nz=-dz/norm*.006,dx/norm*.006
            shape=[(x0,z0),(x1+nx,z1+nz),(x2,z2),(x1-nx,z1-nz)]
            off=len(cv)
            cv += [(x,y,z) for y in (front*.29,front*.260) for x,z in shape]
            cf += [tuple(off+i for i in (3,2,1,0)),tuple(off+i for i in (4,5,6,7))]
            cf += [(off+i,off+(i+1)%4,off+(i+1)%4+4,off+i+4) for i in range(4)]
    cutter=mesh('TEMP | stone fissure cutter',cv,cf,[0]*len(cf),materials[:1],col,0)
    bpy.context.view_layer.objects.active=o
    bo=o.modifiers.new('Shallow modeled stone fissures','BOOLEAN')
    bo.operation='DIFFERENCE';bo.solver='EXACT';bo.object=cutter
    bpy.ops.object.modifier_apply(modifier=bo.name)
    cut_data=cutter.data
    bpy.data.objects.remove(cutter,do_unlink=True)
    bpy.data.meshes.remove(cut_data)
    bm=bmesh.new();bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4])
    bm.to_mesh(o.data);bm.free()
    be=o.modifiers.new('Small dressed stone edge bevel','BEVEL')
    be.width=.012;be.segments=3;be.limit_method='ANGLE';be.angle_limit=math.radians(60)
    return o


def rectangle_ring(hx, hy, z, c):
    return [(-hx+c,-hy,z), (hx-c,-hy,z), (hx,-hy+c,z), (hx,hy-c,z),
            (hx-c,hy,z), (-hx+c,hy,z), (-hx,hy-c,z), (-hx,-hy+c,z)]


def post(materials, col):
    levels = [(0.,.45,.42,0),(.04,.45,.42,0),(.14,.45,.42,0),
              (.18,.35,.32,0),(.57,.35,.32,0),(.59,.344,.314,3),
              (.61,.35,.32,1),(1.16,.35,.32,1),
              (1.18,.43,.39,2),(1.22,.47,.42,2),(1.35,.47,.42,2)]
    vs, fs, ids = [], [], []
    for z,hx,hy,_ in levels:
        vs += rectangle_ring(hx,hy,z,.025)
    for k in range(len(levels)-1):
        for i in range(8):
            fs.append((k*8+i,k*8+(i+1)%8,(k+1)*8+(i+1)%8,(k+1)*8+i))
            ids.append(levels[k][3])
    fs += [tuple(range(7,-1,-1)),tuple(range((len(levels)-1)*8,len(levels)*8))]
    ids += [0,2]
    o = mesh('Framing | post stone pier',vs,fs,ids,materials[:4],col,bevel=0)
    # Solid cutter makes a genuine front recess. Deleted after exact Boolean.
    outline = rectangle_ring(.17,.30,0.,.015)
    cv = [(x,y,.63+z) for y in (-.55,-.225) for x,z,_ in outline]
    cf = [tuple(range(7,-1,-1)),tuple(range(8,16))]
    cf += [(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
    cutter = mesh('TEMP | light pocket cutter',cv,cf,[0]*len(cf),materials[:1],col,0)
    bpy.context.view_layer.objects.active = o
    bo = o.modifiers.new('Actual recessed light pocket','BOOLEAN')
    bo.operation='DIFFERENCE'
    bo.solver='EXACT'
    bo.object=cutter
    bpy.ops.object.modifier_apply(modifier=bo.name)
    cut_data=cutter.data
    bpy.data.objects.remove(cutter,do_unlink=True)
    bpy.data.meshes.remove(cut_data)
    bm=bmesh.new();bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4])
    bm.to_mesh(o.data);bm.free()
    be=o.modifiers.new('Dressed post edges','BEVEL');be.width=.009;be.segments=3
    be.limit_method='ANGLE';be.angle_limit=math.radians(60)
    # A closed narrow metal bezel and recessed solid amber lens.
    rv=[]
    for y in (-.333,-.290):
        for hx,hz,c in ((.205,.335,.014),(.165,.290,.012)):
            rv += [(x,y,.63+z) for x,z,_ in rectangle_ring(hx,hz,0.,c)]
    rf=[]
    for i in range(8):
        j=(i+1)%8
        rf += [(i,j,8+j,8+i),(16+i,24+i,24+j,16+j),
               (i,16+i,16+j,j),(8+i,8+j,24+j,24+i)]
    bezel=mesh('Framing | post warm metal bezel',rv,rf,[0]*len(rf),materials[4:5],col,.003)
    lv=[(x,y,.63+z) for y in (-.275,-.253)
        for x,z,_ in rectangle_ring(.160,.285,0.,.011)]
    lf=[tuple(range(7,-1,-1)),tuple(range(8,16))]
    lf += [(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
    lens=mesh('Framing | post inset amber lens',lv,lf,[0]*len(lf),materials[5:6],col,.002)
    return [o,bezel,lens]


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output-dir',required=True)
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    out=allowed(args.output_dir)
    assert not out.exists(), 'Refusing existing output directory; choose a NEW directory'
    before=integrity()
    source=ROOT.parent/'brightvale-highway/highway.blend'
    print('BUILD_ATTEMPT',str(source),str(out),before,flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(source))
    refs=collection(REFERENCE);studio=collection(STUDIO)
    for o in list(bpy.context.scene.objects):
        dest=refs if o.type in {'MESH','CURVE'} and not o.name.startswith('Studio') else studio
        for c in list(o.users_collection):
            c.objects.unlink(o)
        dest.objects.link(o)
    for c in list(bpy.data.collections):
        if c not in (refs,studio):
            bpy.data.collections.remove(c)
    asset=collection(ASSET)
    mats=[material(MATERIAL_NAMES[0],(.025,.047,.098)),
          material(MATERIAL_NAMES[1],(.031,.056,.110)),
          material(MATERIAL_NAMES[2],(.135,.15,.18),.72),
          material(MATERIAL_NAMES[3],(.010,.016,.028)),
          material(MATERIAL_NAMES[4],(.48,.255,.060),.32,.72),
          material(MATERIAL_NAMES[5],(1.,.44,.07),.32,0.,1.5)]
    long=wall('Framing | long masonry section',2.80,[-2.80/6,2.80/6],mats,asset)
    short=wall('Framing | short masonry section',1.80,[0.],mats,asset)
    pieces={'long':[long],'short':[short],'post':post(mats,asset)}
    for side,x,rotation in (('left',-12.,math.pi/2),('right',12.,-math.pi/2)):
        for kind,objects in pieces.items():
            anchor=bpy.data.objects.new(f'Framing | {side} {kind} | floor origin',None)
            asset.objects.link(anchor)
            anchor.empty_display_type='PLAIN_AXES';anchor.empty_display_size=.20
            anchor.location=(x,POSITIONS[kind],-.70)
            anchor.rotation_euler[2]=rotation
            anchor['module']=kind;anchor['side']=side
            anchor['placement']='PROVISIONAL; crowd geometry and game camera unavailable'
            for prototype in objects:
                o=prototype if side=='left' else prototype.copy()
                if side=='right':
                    asset.objects.link(o)
                o.name=f'Framing | {side} {kind} | {prototype.data.name}'
                o.parent=anchor
    bpy.context.scene['framing_status']='CANDIDATE — user model approval pending'
    bpy.context.scene['crowd_corridor']='X +/-7.60..11.10, Y -3..18, Z -.70..2.30; provisional EMPTY reservation'
    bpy.context.scene.render.filepath='//preview-output.png'
    bpy.context.scene.unit_settings.system='NONE'
    bpy.context.view_layer.update()
    out.mkdir(parents=True)
    target=out/'framing-candidate.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(target),check_existing=False)
    assert before==integrity()
    print('BUILD_PASS',str(target),sha(target),flush=True)


if __name__=='__main__':
    main()
