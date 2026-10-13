"""Three editable derivatives of the checksum-locked accepted FK rig.

Explicit NEW output only. No writes to either accepted source, no exports.
"""
import argparse
import hashlib
import json
import math
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import bpy
import bmesh
from mathutils import Euler, Vector

PACKAGE = Path(__file__).resolve().parent
BASE = PACKAGE.parent / 'neutral-base' / 'character.blend'
SOURCE = PACKAGE.parent / 'rigged' / 'rig.blend'
HASHES = {'base': '800ef1f869e69489e0ae049b2c952bfcbe227be17614e21843008aa19e5b33f8',
          'rig': '6758bb60c96ec14e912d71c06dc78dbfde4b46c57d9d05ccfd6d4c94ff74f1cb'}
CHARACTERS = {'A': ('Original', 'Reaching', -1.30),
              'B': ('Bob', 'Cheering', 0.),
              'C': ('Gathered', 'Calm', 1.30)}
CALM = {'clavicle.L': (0, 3, -2), 'upper_arm.L': (0, 65, -6),
        'forearm.L': (0, -10, -5), 'hand.L': (0, 0, 24),
        'clavicle.R': (0, -3, 2), 'upper_arm.R': (0, -68, 4),
        'forearm.R': (0, 12, 5), 'hand.R': (0, 0, -21),
        'head': (0, 0, 2)}
PALETTES = {
    'B': {'Skin': (.67,.40,.27), 'Skin.Shadow': (.35,.16,.105),
          'Hair': (.085,.029,.018), 'Hair.Plane': (.14,.052,.028),
          'Tee': (.47,.115,.082), 'Tee.Seam': (.32,.066,.044),
          'Pants': (.039,.063,.105), 'Pants.Seam': (.025,.038,.062),
          'Shoe': (.73,.69,.59), 'Sole': (.33,.29,.24)},
    'C': {'Skin': (.32,.155,.085), 'Skin.Shadow': (.15,.052,.026),
          'Hair': (.021,.016,.012), 'Hair.Plane': (.047,.030,.018),
          'Tee': (.47,.27,.066), 'Tee.Seam': (.25,.123,.028),
          'Pants': (.115,.135,.085), 'Pants.Seam': (.07,.078,.045),
          'Shoe': (.13,.105,.079), 'Sole': (.39,.34,.25)},
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sources():
    assert sha(BASE) == HASHES['base'], 'Accepted base checksum mismatch'
    assert sha(SOURCE) == HASHES['rig'], 'Accepted rig checksum mismatch'


def new_output(path, suffix):
    path = Path(path).resolve()
    if path.exists():
        raise FileExistsError('Refusing existing output: ' + str(path))
    if path.suffix != suffix or not path.parent.is_dir():
        raise ValueError('Existing directory and new ' + suffix + ' path required')
    if path in (BASE.resolve(), SOURCE.resolve()):
        raise ValueError('Immutable source path')
    return path


def obj(cid, role):
    return bpy.data.objects[cid + '::' + role]


def members(cid):
    return sorted((o for o in bpy.data.objects if o.get('character_id') == cid), key=lambda o:o.name)


def apply_pose(cid, name, use_action=True):
    rig = obj(cid, 'CrowdRig')
    poses = json.loads(rig['pose_definitions'])
    rig.animation_data_create()
    rig.animation_data.action = None
    rig.data.pose_position = 'POSE'
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.location = (0,0,0)
        pb.scale = (1,1,1)
        q = Euler(tuple(math.radians(v) for v in poses[name].get(pb.name,(0,0,0))), 'XYZ').to_quaternion()
        rest = pb.bone.matrix_local.to_quaternion()
        pb.rotation_quaternion = rest.inverted() @ q @ rest
    if use_action:
        rig.animation_data.action = bpy.data.actions[cid + '.Pose.' + name]
        bpy.context.scene.frame_set(1)
    rig['authoring_pose'] = name
    bpy.context.view_layer.update()
    return rig


def assigned_poses():
    for cid, (_, pose, _) in CHARACTERS.items():
        apply_pose(cid, pose)


def recalc(mesh):
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh); bm.free()
    mesh.update()


class Surface:
    def __init__(self):
        self.v, self.f, self.mi = [], [], []

    def ring(self, points):
        ids = list(range(len(self.v),len(self.v)+len(points)))
        self.v.extend(points)
        return ids

    def bridge(self, a, b, accent=False):
        for i in range(len(a)):
            self.f.append([a[i],a[(i+1)%len(a)],b[(i+1)%len(b)],b[i]])
            self.mi.append(1 if accent and i%7==2 else 0)

    def cap(self, ring, material=0):
        self.f.append(list(ring)); self.mi.append(material)

    def lock(self, points, widths, depths):
        # One interpolated station per span softens a broad sweep without a
        # subdivision modifier or multiplying the full character topology.
        def interpolate(values):
            result=[]
            for i in range(len(values)-1):
                a,b,c,d=[Vector(values[k]) for k in (max(0,i-1),i,i+1,min(len(values)-1,i+2))]
                result.extend([tuple(b),tuple((2*b+(-a+c)*.5+(2*a-5*b+4*c-d)*.25+(-a+3*b-3*c+d)*.125)*.5)])
            return result+[values[-1]]
        points=interpolate(points)
        sizes=interpolate([(w,d,0) for w,d in zip(widths,depths)])
        widths=[s[0] for s in sizes];depths=[s[1] for s in sizes]
        rings=[]
        for (x,y,z),w,d in zip(points,widths,depths):
            rings.append(self.ring([(x-w,y,z),(x-w*.55,y-d*.7,z+.002),
                                    (x,y-d,z+.003),(x+w*.6,y-d*.6,z+.001),
                                    (x+w,y,z),(x,y+d*.25,z-.001)]))
        self.cap(rings[0][::-1])
        for a,b in zip(rings,rings[1:]): self.bridge(a,b,True)
        self.cap(rings[-1])

    def mesh(self, name, materials):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.v,[],self.f)
        for mat in materials: mesh.materials.append(mat)
        for p,m in zip(mesh.polygons,self.mi):
            p.material_index=m; p.use_smooth=True
        recalc(mesh)
        return mesh


def hair_mesh(cid, materials):
    """Coherent open crown/skirt plus broad swept locks; no voxel surface."""
    s=Surface();rings=[]
    for t in (0,.10,.24,.40,.56,.70,.83,.93,.985):
        points=[]
        for j in range(40):
            a=j*math.tau/40;front=max(0,math.cos(a))
            if cid=='B':
                bottom=1.540+.192*front**3+.012*abs(math.sin(a))
            else:
                bottom=1.624+.107*front**3+.012*abs(math.sin(a))
            z=bottom+(1.812-bottom)*t
            r=math.sqrt(max(.002,1-((max(z,1.666)-1.666)/.147)**2))
            taper=(.94+.06*min(1,(z-1.54)/.11)) if cid=='B' else 1
            x=.127*math.sin(a)*r*taper
            y=.014-(.110 if math.cos(a)>0 else .138)*math.cos(a)*r*taper
            # Restrained panel breakup, not a noisy curl/bead surface.
            if cid=='B' and z<1.66: x*=1+.015*math.cos(5*a)
            points.append((x,y,z))
        rings.append(s.ring(points))
    for a,b in zip(rings,rings[1:]):s.bridge(a,b,True)
    s.cap(rings[-1])
    if cid=='B':
        # Off-center part and two swept banks, eyes left entirely open.
        for side in (-1,1):
            for offset in (0,.025):
                s.lock([(side*.020,-.037,1.801-offset*.12),
                        (side*.052,-.077,1.777-offset*.22),
                        (side*.082,-.093,1.726-offset*.20),
                        (side*(.108+offset*.10),-.070,1.678-offset*.12)],
                       [.015,.026,.022,.0012],[.009,.015,.012,.0015])
            s.lock([(side*.108,-.017,1.726),(side*.125,-.023,1.665),
                    (side*.126,-.028,1.595),(side*.113,-.017,1.552)],
                   [.008,.012,.013,.001],[.006,.008,.008,.001])
    else:
        # Lifted side-swept front keeps the eye line and brows exposed.
        for points,widths in [
            ([(-.038,-.016,1.800),(-.050,-.060,1.778),(-.073,-.090,1.741),(-.091,-.081,1.700)],[.015,.027,.022,.001]),
            ([(-.008,-.014,1.814),(-.013,-.065,1.786),(-.030,-.101,1.754),(-.046,-.099,1.706)],[.018,.029,.023,.001]),
            ([(.035,-.015,1.804),(.032,-.060,1.785),(.013,-.100,1.756),(-.008,-.107,1.726)],[.018,.030,.023,.001]),
            ([(.072,-.014,1.780),(.079,-.055,1.763),(.066,-.090,1.742),(.048,-.088,1.713)],[.014,.023,.020,.001]),
        ]:
            s.lock(points,widths,[.009,.014,.012,.001])
        # Flattened gathered rear knot, with broad radial creases. Attached
        # overlap with crown is intentional; not a separate bead-curl style.
        rr=[]
        for k in range(1,10):
            t=k*math.pi/10
            pts=[]
            for j in range(20):
                a=j*math.tau/20;ridge=1+.055*math.cos(5*a+2*t)
                pts.append((.050*math.sin(t)*math.cos(a)*ridge,
                            .150+.056*math.sin(t)*math.sin(a)*ridge,
                            1.777+.077*math.cos(t)))
            rr.append(s.ring(pts))
        s.cap(rr[0][::-1]);s.cap(rr[-1])
        for a,b in zip(rr,rr[1:]):s.bridge(a,b,True)
    return s.mesh(cid+'.Hair.Mesh',materials)


def modify_shirt(cid, mesh):
    """Keep the fitted shoulder crown; vary hem cut and sleeve length only."""
    for v in mesh.vertices:
        x,y,z=v.co
        if z<1.265:
            f=max(0,(1.265-z)/.265)
            if cid=='B':
                v.co.z += .044*f
                v.co.x *= 1+.065*f
                v.co.y *= 1+.035*f
            else:
                v.co.z -= .042*f
                v.co.x *= 1+.035*f
                v.co.y *= 1+.05*f
        if abs(x)>.22:
            f=min(1,(abs(x)-.22)/.126)
            # Shorter boxy tee vs longer short sleeve; keep original coverage.
            v.co.x += (1 if x>0 else -1)*(-.012 if cid=='B' else .022)*f
    recalc(mesh)


def garment_details(cid, shirt, collection, rig):
    """A small split collar and front placket, following the underlying panel."""
    s=Surface()
    for side in (-1,1):
        # Four-vertex tapered turn-down collar, away from the neck/head.
        pts=[(side*.008,-.047,1.466),(side*.052,-.029,1.476),
             (side*.086,-.068,1.423),(side*.037,-.086,1.433)]
        a=s.ring(pts); b=s.ring([(x,y+.003,z-.001) for x,y,z in pts])
        s.cap(a);s.cap(b[::-1]);s.bridge(a,b)
    # Trace each existing front-center shirt section instead of an intersecting
    # arbitrary straight strip across a curved torso.
    centers=sorted({(round(v.co.z,6),round(v.co.y,6)) for v in shirt.data.vertices
                    if abs(v.co.x)<1e-6 and v.co.y<-.04 and v.co.z<1.45})
    centers.append((1.456,-.043))
    pairs=[]
    for z,y in centers:
        pairs.append(s.ring([(-.010,y-.003,z),(.010,y-.003,z)]))
    for a,b in zip(pairs,pairs[1:]):
        s.f.append([a[0],a[1],b[1],b[0]]);s.mi.append(1)
    mats=[shirt.material_slots[0].material,shirt.material_slots[1].material]
    mesh=s.mesh(cid+'.CollarPlacket.Mesh',mats)
    detail=bpy.data.objects.new(cid+'::CollarPlacket',mesh);collection.objects.link(detail)
    detail.parent=obj(cid,'NeutralBase');detail['character_id']=cid;detail['source_role']='CollarPlacket'
    # Interpolate the unchanged core torso field used by the accepted rig.
    def smooth(a,b,x):
        t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
    groups={name:detail.vertex_groups.new(name=name) for name in ('pelvis','spine','chest')}
    for v in mesh.vertices:
        f=smooth(1.02,1.14,v.co.z);c=smooth(1.15,1.35,v.co.z)
        for name,w in [('pelvis',(1-f)*(1-c)),('spine',f*(1-c)),('chest',c)]:
            if w>1e-9:groups[name].add([v.index],w,'REPLACE')
    mod=detail.modifiers.new('Controlled skinning','ARMATURE');mod.object=rig;mod.use_deform_preserve_volume=True


def build(output):
    new_output(output,'.blend');sources()
    print('TRIO READ IMMUTABLE RIG',SOURCE,HASHES['rig'],flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    originals=sorted(list(bpy.data.objects),key=lambda o:o.name)
    roles={o:o.name for o in originals}
    source_rig=bpy.data.objects['CrowdRig']
    poses=json.loads(source_rig['pose_definitions']);poses['Calm']=CALM
    actions={name:bpy.data.actions['Pose.'+name] for name in ('Rest','Cheering','Reaching')}
    old_collections=list(bpy.data.collections)
    # Copy first, before changing names or colors of the original instance.
    groups={}
    for cid,(label,assigned,x) in CHARACTERS.items():
        collection=bpy.data.collections.new(cid+'.'+label)
        bpy.context.scene.collection.children.link(collection)
        mapping={old:old if cid=='A' else old.copy() for old in originals}
        groups[cid]=(collection,mapping)
        for old,new in mapping.items():
            if cid!='A' and old.type=='ARMATURE': new.data=old.data.copy()
            collection.objects.link(new)
        for old,new in mapping.items():
            if old.parent:new.parent=mapping[old.parent]
            for mod in new.modifiers:
                if mod.type=='ARMATURE':mod.object=mapping[source_rig]
    for cid,(collection,mapping) in groups.items():
        mats={}
        for old,new in mapping.items():
            role=roles[old];new.name=cid+'::'+role
            new['character_id']=cid;new['source_role']=role
            if new.type=='MESH' and cid!='A':
                for slot in new.material_slots:
                    material=slot.material;key=material.name
                    if key not in mats:
                        if key in PALETTES[cid]:
                            mats[key]=material.copy();mats[key].name=cid+'.'+key
                            color=(*PALETTES[cid][key],1)
                            mats[key].diffuse_color=color
                            mats[key].node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=color
                        else:
                            mats[key]=material  # identical eye/lace regions stay shared
                    slot.link='OBJECT';slot.material=mats[key]
        root=mapping[next(o for o in originals if roles[o]=='NeutralBase')]
        root.location.x=CHARACTERS[cid][2]
        root['purpose']='Diagnostic lineup offset only; not game placement'
        rig=mapping[source_rig];rig.data.name=cid+'.Skeleton'
        rig['pose_definitions']=json.dumps(poses,sort_keys=True)
        rig['source_rig_sha256']=HASHES['rig'];rig['assigned_pose']=CHARACTERS[cid][1]
        if cid!='A':
            hair=obj(cid,'Hair');hair.data=hair_mesh(cid,[mats['Hair'],mats['Hair.Plane']])
            # Replacing topology requires explicit fresh head weights.
            hair.vertex_groups.clear();g=hair.vertex_groups.new(name='head');g.add(list(range(len(hair.data.vertices))),1.,'REPLACE')
            for slot,material in zip(hair.material_slots,[mats['Hair'],mats['Hair.Plane']]):
                slot.link='DATA';slot.material=material
            shirt=obj(cid,'Shirt');shirt.data=shirt.data.copy();shirt.data.name=cid+'.Shirt.Mesh'
            modify_shirt(cid,shirt.data)
            if cid=='B':
                # High-rise jeans meet the cropped hem. The source has no
                # hidden nude torso, so a crop must never reveal a void.
                for role in ('Trousers','Waistband'):
                    garment=obj(cid,role);garment.data=garment.data.copy();garment.data.name=cid+'.'+role+'.Mesh'
                    for v in garment.data.vertices:
                        f=max(0,min(1,(v.co.z-.884)/(.996-.884)))
                        v.co.z+=.030*f
                    recalc(garment.data)
            # Restrained closed smile: preserve the mouth strip, move only its
            # lateral stations up 2–4 mm; head/eyes/facial anatomy are untouched.
            mouth=obj(cid,'Mouth');mouth.data=mouth.data.copy();mouth.data.name=cid+'.Mouth.Mesh'
            for v in mouth.data.vertices:v.co.z+=(.004 if cid=='B' else .0025)*(abs(v.co.x)/.024)**2
            recalc(mouth.data)
            if cid=='C':garment_details(cid,shirt,collection,rig)
        for name in poses:
            if name in actions:
                action=actions[name].copy();action.name=cid+'.Pose.'+name
            else:
                apply_pose(cid,name,False)
                action=bpy.data.actions.new(cid+'.Pose.'+name)
                rig.animation_data.action=action
                for pb in rig.pose.bones:
                    for field in ('location','rotation_quaternion','scale'):
                        pb.keyframe_insert(data_path=field,frame=1,group=pb.name)
            action.use_fake_user=True
            action['purpose']='Single-frame authored review pose; not a runtime clip'
    for collection in old_collections:bpy.data.collections.remove(collection)
    for action in actions.values():bpy.data.actions.remove(action)
    assigned_poses()
    scene=bpy.context.scene;scene.frame_start=scene.frame_end=1
    scene['status']='Three-character variation candidate; user review pending; no runtime approval'
    scene['source_hashes']=json.dumps(HASHES,sort_keys=True)
    scene['lineup']='A original reaching; B bob/coral cheering; C gathered/mustard calm'
    scene['construction']='Accepted anatomy/joints; explicit economical hair/garment derivatives; no remeshing'
    sources();new_output(output,'.blend')
    print('TRIO SAVE NEW CANDIDATE',output,flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output),compress=True)
    sources();print('TRIO BUILD COMPLETE; sources unchanged',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    build(new_output(args.output,'.blend'))
