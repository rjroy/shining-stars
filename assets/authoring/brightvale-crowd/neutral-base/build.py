"""Explicit neutral character topology. No remeshing, subdivision, rig or export.

blender --background --threads 1 --python-exit-code 1 --python build.py --
  --output /absolute/new.blend [--study]
--study builds only the head/neck/shirt for the early visual gate.
"""
import argparse
import math
import sys
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

PALETTE = {
    'Skin': (.57, .315, .18), 'Skin.Shadow': (.30, .125, .075),
    'Hair': (.026, .022, .025), 'Hair.Plane': (.040, .032, .033),
    'Tee': (.035, .205, .225), 'Tee.Seam': (.027, .155, .174),
    'Pants': (.085, .099, .125), 'Pants.Seam': (.060, .068, .085),
    'Shoe': (.65, .62, .54), 'Sole': (.30, .29, .27),
    'Eye.White': (.88, .84, .73), 'Eye.Iris': (.22, .09, .036),
    'Eye.Dark': (.013, .008, .010), 'Eye.Light': (.98, .97, .91),
}
MATS = list(PALETTE)
ROOT = None
COLL = None
CHIN = 1.505


class Mesh:
    def __init__(self):
        self.v, self.f, self.mi = [], [], []
        self.lookup = {}

    def vert(self, p):
        p = tuple(float(c) for c in p)
        key = tuple(round(c, 9) for c in p)
        if key not in self.lookup:
            self.lookup[key] = len(self.v)
            self.v.append(p)
        return self.lookup[key]

    def face(self, points, material):
        ids = [p if isinstance(p, int) else self.vert(p) for p in points]
        ids = [i for j, i in enumerate(ids) if i != ids[j-1]]
        if len(set(ids)) >= 3:
            self.f.append(ids)
            self.mi.append(MATS.index(material))

    def bridge(self, a, b, mat):
        assert len(a) == len(b)
        for i in range(len(a)):
            self.face([a[i], a[(i+1) % len(a)], b[(i+1) % len(a)], b[i]], mat)

    def loft(self, rings, mat, caps=False):
        for a, b in zip(rings, rings[1:]):
            self.bridge(a, b, mat)
        if caps:
            self.face(list(reversed(rings[0])), mat)
            self.face(rings[-1], mat)

    def finish(self, name, role, boundaries=0, smooth=True):
        data = bpy.data.meshes.new(name + '.Mesh')
        data.from_pydata(self.v, [], self.f)
        # A boundary edge midpoint can make Blender's n-gon tessellator choose
        # a collapsed ear. Triangulate only those affected sewn panels around
        # an explicit interior vertex, retaining all shared boundary edges.
        data.calc_loop_triangles()
        bad={t.polygon_index for t in data.loop_triangles
             if (data.vertices[t.vertices[1]].co-data.vertices[t.vertices[0]].co).cross(
                 data.vertices[t.vertices[2]].co-data.vertices[t.vertices[0]].co).length<=2e-12}
        if bad:
            faces=[];regions=[]
            for index,(face,material) in enumerate(zip(self.f,self.mi)):
                if index not in bad:
                    faces.append(face);regions.append(material);continue
                assert len(face)>4,(name,'unexpected collapsed non-ngon',index)
                center=sum((Vector(self.v[i]) for i in face),Vector())/len(face)
                ci=self.vert(center)
                for i,a in enumerate(face):
                    faces.append([a,face[(i+1)%len(face)],ci]);regions.append(material)
            self.f=faces;self.mi=regions
            data.clear_geometry();data.from_pydata(self.v,[],self.f)
        for key in MATS:
            data.materials.append(bpy.data.materials[key])
        for face, material in zip(data.polygons, self.mi):
            face.material_index = material
            face.use_smooth = smooth
        bm = bmesh.new(); bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(data); bm.free()
        obj = bpy.data.objects.new(name, data); COLL.objects.link(obj)
        obj.parent = ROOT
        obj['role'] = role
        obj['expected_boundary_loops'] = boundaries
        used = sorted(set(p.material_index for p in data.polygons))
        slots = [data.materials[i] for i in used]
        remap = {old: new for new, old in enumerate(used)}
        indices = [remap[p.material_index] for p in data.polygons]
        data.materials.clear()
        for material in slots: data.materials.append(material)
        for p, index in zip(data.polygons, indices): p.material_index = index
        return obj


def ellipse(x, y, z, w, d, n=16):
    return [(x+w*math.sin(i*math.tau/n), y-d*math.cos(i*math.tau/n), z) for i in range(n)]


# Rows are chin, jaw, cheek, nose, lower/upper eyelids, brow and cranium.
HEAD = [(0,.060,.060,.033),(.012,.067,.063,.040),(.029,.078,.067,.052),
        (.051,.088,.066,.064),(.075,.094,.071,.075),(.095,.096,.074,.084),
        (.114,.097,.077,.090),(.129,.098,.080,.094),(.146,.098,.079,.097),
        (.166,.096,.075,.098),(.184,.094,.073,.097),(.205,.089,.067,.091),
        (.229,.073,.053,.074),(.250,.044,.031,.044),(.259,.006,.005,.006)]
XS = [0,.13,.26,.53,.76,.91,1]
YS = [1,.995,.985,.97,.90,.61,0]


def face_point(row, col, side=1):
    z, w, depth, back = HEAD[row]
    x = w*XS[col]*side
    y = .008-depth*YS[col]
    # Rising mandibular border: chin remains low, jaw angle rises toward the ear.
    z += {0:.055,1:.048,2:.039,3:.025,4:.012,5:.004}.get(row,0)*XS[col]
    # Landmarks explicitly control bridge, nose tip and soft muzzle.
    if col == 0:
        y -= {3:.002,4:.004,5:.012,6:.008,7:.004,8:.003,9:.002}.get(row,0)
    elif col == 1:
        y -= {4:.002,5:.007,6:.003}.get(row,0)
    # Deliberate almond aperture: outer corner higher, upper lid relaxed.
    if row == 7 and 2 <= col <= 4:
        z += {2:.012,3:.000,4:.014}[col]
    if row == 9 and 2 <= col <= 4:
        z += {2:-.015,3:-.002,4:-.007}[col]
    if row == 8 and col in (2,4):
        z += .000 if col == 2 else .005
    return (x, y, CHIN+z)


def strip(mesh, points, widths, mat):
    a, b = [], []
    for i, p in enumerate(points):
        p = Vector(p)
        tangent = Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        perpendicular = Vector((-tangent.z,0,tangent.x)).normalized()*widths[i]
        a.append(tuple(p+perpendicular)); b.append(tuple(p-perpendicular))
    for i in range(len(a)-1): mesh.face([a[i],a[i+1],b[i+1],b[i]],mat)


def head():
    m = Mesh()
    for side in (-1,1):
        for j in range(len(HEAD)-1):
            for i in range(6):
                if not (j in (7,8) and i in (2,3)):
                    m.face([face_point(j,i,side),face_point(j,i+1,side),
                            face_point(j+1,i+1,side),face_point(j+1,i,side)],'Skin')
                # Matching back panels meet front along the temporal seam.
                def rear(r,c):
                    z,w,depth,back = HEAD[r]
                    lift={0:.055,1:.048,2:.039,3:.025,4:.012,5:.004}.get(r,0)
                    z+=lift+{0:.013,1:.013,2:.012,3:.009,4:.005}.get(r,0)*YS[c]
                    return (side*w*XS[c],.008+back*YS[c],CHIN+z)
                m.face([rear(j,i),rear(j+1,i),rear(j+1,i+1),rear(j,i+1)],'Skin')
    for row in (0,len(HEAD)-1):
        ring = [face_point(row,i,-1) for i in range(6,-1,-1)]
        ring += [face_point(row,i,1) for i in range(1,7)]
        z,w,d,back = HEAD[row]
        lift={0:.055}.get(row,0)
        ring += [(w*XS[i],.008+back*YS[i],CHIN+z+lift+(.013*YS[i] if row==0 else 0)) for i in range(5,-1,-1)]
        ring += [(-w*XS[i],.008+back*YS[i],CHIN+z+lift+(.013*YS[i] if row==0 else 0)) for i in range(1,6)]
        if row==0:
            # A real shared-edge jaw-to-neck surface, not intersecting shells.
            neckrings=[ring]
            for zz,ww,dd in [(1.530,.037,.034),(1.466,.044,.039),(1.425,.061,.049)]:
                neckrings.append([(-ww*math.cos(i*math.tau/24),.012-dd*math.sin(i*math.tau/24),zz-(.025*math.sin(i*math.tau/24) if zz==1.530 else 0)) for i in range(24)])
            m.loft(neckrings,'Skin');m.face(neckrings[-1],'Skin')
        else:m.face(ring,'Skin')
    # Eyelid rim is actually stitched to the head aperture, not floating eyeliner.
    for side in (-1,1):
        original = [face_point(r,c,side) for r,c in [(7,2),(7,3),(7,4),(8,4),(9,4),(9,3),(9,2),(8,2)]]
        # Local, explicit eyelid edge refinement only: soften corners, insert
        # eight edge points into adjoining face polygons. No surface modifier.
        ids=[m.vert(p) for p in original]
        curved=[tuple(Vector(original[i])*.60+Vector(original[i-1])*.20+Vector(original[(i+1)%8])*.20) for i in range(8)]
        for index,p in zip(ids,curved):m.v[index]=p
        mids=[tuple((Vector(original[i])+Vector(original[(i+1)%8]))*.5) for i in range(8)]
        midids=[m.vert(p) for p in mids]
        edgepoints={frozenset((ids[i],ids[(i+1)%8])):midids[i] for i in range(8)}
        for fi,face in enumerate(m.f):
            expanded=[]
            for j,index in enumerate(face):
                expanded.append(index)
                edge=frozenset((index,face[(j+1)%len(face)]))
                if edge in edgepoints:expanded.append(edgepoints[edge])
            m.f[fi]=expanded
        # Rebuild lookup after moving the corner vertices.
        m.lookup={tuple(round(c,9) for c in p):i for i,p in enumerate(m.v)}
        rim=[p for pair in zip(curved,mids) for p in pair]
        cx = side*.050
        inner = [(cx+(x-cx)*.96,y+.0015,CHIN+.148+(z-CHIN-.148)*.91) for x,y,z in rim]
        m.bridge(rim,inner,'Skin.Shadow')
        eye = Mesh()
        # Shallow socket insert follows lid shape; the iris meets the upper lid.
        center = (cx,-.0720,CHIN+.149)
        for i in range(len(inner)):
            eye.face([inner[i],inner[(i+1)%len(inner)],center],'Eye.White')
        eye.finish('EyeWhite.'+str(side),'eye',boundaries=1)
        iris = Mesh()
        # Elliptical iris is vertically clipped by the relaxed upper lid.
        rings=[]
        for rx,rz,yy,mat in [(.0108,.014,-.0740,'Eye.Dark'),(.0087,.0115,-.0744,'Eye.Iris'),(.0041,.0080,-.0748,'Eye.Dark')]:
            ring=[(cx+rx*math.cos(i*math.tau/20),yy,CHIN+min(.1585,.148+rz*math.sin(i*math.tau/20))) for i in range(20)]
            iris.face(ring,mat)
        ring=[(cx-.003+.0022*math.cos(i*math.tau/10),-.0750,CHIN+.154+.0022*math.sin(i*math.tau/10)) for i in range(10)]
        iris.face(ring,'Eye.Light')
        iris.finish('Iris.'+str(side),'face_overlay',boundaries=4,smooth=False)
        lines=Mesh()
        # Slight upper-lid weight and softly angled brows, not a fixed round stare.
        upper=[rim[i] for i in range(14,5,-1)]
        upper=[(x,y-.0016,z) for x,y,z in upper]
        strip(lines,upper,[.0004]+[.0011]*(len(upper)-2)+[.0003],'Eye.Dark')
        brow=[(side*x,y,CHIN+z) for x,y,z in [(.025,-.067,.180),(.041,-.065,.187),(.060,-.059,.186),(.076,-.050,.181)]]
        strip(lines,brow,[.001,.0027,.0025,.0003],'Hair')
        lines.finish('BrowLid.'+str(side),'face_overlay',boundaries=2,smooth=False)
    m.finish('Head','head',boundaries=2)
    # Restrained closed mouth. No teeth/tongue stacked on the skin.
    mouth=Mesh()
    strip(mouth,[(-.024,-.055,CHIN+.065),(-.013,-.060,CHIN+.060),(0,-.063,CHIN+.059),(.013,-.060,CHIN+.060),(.024,-.055,CHIN+.065)],
          [.0002,.00065,.0008,.00065,.0002],'Skin.Shadow')
    mouth.finish('Mouth','face_overlay',boundaries=1,smooth=False)
    ears=Mesh()
    for side in (-1,1):
        outline=[(.095,.004,.094),(.105,-.001,.091),(.115,.001,.104),(.119,.007,.132),(.115,.013,.152),(.104,.015,.160),(.097,.010,.149)]
        front=[(side*x,y-.009,CHIN+z) for x,y,z in outline]
        back=[(side*x,y+.009,CHIN+z) for x,y,z in outline]
        inner=[(side*(.103+(x-.103)*.51),y-.006,CHIN+.124+(z-.124)*.68) for x,y,z in outline]
        ears.bridge(front,back,'Skin'); ears.face(list(reversed(back)),'Skin')
        ears.bridge(front,inner,'Skin'); ears.face(inner,'Skin.Shadow')
    ears.finish('Ears','ears')
    hair()


def hair():
    m=Mesh()
    # One coherent crown with deliberately irregular hairline, not bead curls.
    rings=[]
    for row,t in enumerate([1,.84,.65,.45,.24,.045]):
        ring=[]
        for j in range(32):
            a=j*math.tau/32
            bottom=.225 if math.cos(a)>.45 else .079+.004*math.sin(7*a) if math.cos(a)<-.2 else .126
            theta=math.acos((bottom-.151)/.140)*t
            z=CHIN+.151+.140*math.cos(theta)
            x=.120*math.sin(a)*math.sin(theta)
            y=.014-(.103 if math.cos(a)>0 else .119)*math.cos(a)*math.sin(theta)
            ring.append((x,y,z))
        rings.append(ring)
    m.loft(rings,'Hair');m.face(rings[-1],'Hair')
    # Broad swept wedge masses with a ridge; each lock has an authored path/width.
    # The short style borrows the teal/charcoal characters' varied, swept silhouette.
    def lock(points,widths,depths):
        # One intermediate station per span eases the authored sweep without
        # multiplying the whole character's topology.
        def interpolate(values):
            result=[]
            for i in range(len(values)-1):
                a=Vector(values[max(0,i-1)]);b=Vector(values[i]);c=Vector(values[i+1]);d=Vector(values[min(len(values)-1,i+2)])
                result.extend([tuple(b),tuple((2*b+(-a+c)*.5+(2*a-5*b+4*c-d)*.25+(-a+3*b-3*c+d)*.125)*.5)])
            return result+[values[-1]]
        points=interpolate(points)
        sizes=interpolate([(w,d,0) for w,d in zip(widths,depths)])
        widths=[s[0] for s in sizes];depths=[s[1] for s in sizes]
        rr=[]
        for (x,y,z),w,d in zip(points,widths,depths):
            rr.append([(x-w,y,z),(x-w*.55,y-d*.65,z+.002),(x,y-d,z+.003),
                       (x+w*.6,y-d*.58,z+.001),(x+w,y,z),(x,y+d*.22,z-.001)])
        for k,(a,b) in enumerate(zip(rr,rr[1:])):
            for j in range(6):m.face([a[j],a[(j+1)%6],b[(j+1)%6],b[j]],'Hair.Plane' if j==1 else 'Hair')
        m.face(list(reversed(rr[0])),'Hair');m.face(rr[-1],'Hair')
    locks=[
      ([(-.075,-.014,.254),(-.085,-.049,.236),(-.089,-.070,.209),(-.078,-.079,.165)],[.016,.023,.020,.0008],[.010,.012,.010,.001]),
      ([(-.041,-.009,.278),(-.061,-.044,.259),(-.054,-.075,.226),(-.064,-.085,.187)],[.019,.030,.025,.0008],[.011,.017,.014,.001]),
      ([(-.001,-.004,.283),(-.013,-.047,.266),(-.024,-.083,.230),(-.038,-.089,.173)],[.021,.032,.023,.0008],[.011,.018,.012,.001]),
      ([(.036,.002,.282),(.029,-.043,.265),(.013,-.081,.232),(-.002,-.089,.192)],[.022,.032,.026,.0008],[.012,.017,.015,.001]),
      ([(.069,.003,.266),(.065,-.040,.253),(.049,-.075,.227),(.022,-.087,.202)],[.022,.028,.022,.0008],[.010,.016,.012,.001]),
      ([(.085,.010,.243),(.096,-.025,.229),(.082,-.066,.207),(.063,-.078,.176)],[.016,.021,.017,.0008],[.010,.014,.010,.001]),
    ]
    for pts,ww,dd in locks:lock([(x,y,CHIN+z) for x,y,z in pts],ww,dd)
    for side in (-1,1):
        lock([(side*.089,.017,CHIN+.245),(side*.109,-.001,CHIN+.217),(side*.109,-.020,CHIN+.176),(side*.100,-.019,CHIN+.129)],
             [.014,.017,.012,.0007],[.010,.012,.009,.001])
        lock([(side*.065,.064,CHIN+.259),(side*.104,.064,CHIN+.226),(side*.112,.054,CHIN+.182),(side*.104,.045,CHIN+.145)],
             [.019,.023,.019,.0007],[.012,.014,.009,.001])
    m.finish('Hair','hair',boundaries=1)


def shirt():
    m=Mesh()
    # Front/back panel grid. The outer boundary above the armpit becomes the
    # sleeve root; both panels share the actual shoulder and side seam vertices.
    rows=[(1.00,.180,.116),(1.017,.182,.116),(1.07,.178,.112),(1.17,.177,.104),
          (1.265,.189,.098),(1.322,.201,.096),(1.389,.211,.088),(1.442,.211,.069)]
    fractions=[0,.26,.52,.78,1]
    panel={}
    for side in (-1,1):
        for back in (False,True):
            for j,(z,w,d) in enumerate(rows):
                for i,t in enumerate(fractions):
                    zz=z
                    # Raise the axilla with the abducted arm, while preserving
                    # the torso interior and waist. One clavicle-to-sleeve crown.
                    if j in (4,5,6):zz += {4:.050,5:.042,6:.041}[j]*t*t
                    if j==7:zz={0:1.463,1:1.477,2:1.487,3:1.485,4:1.479}[i]
                    yy=(1 if back else -1)*d*(1-.20*t*t)
                    if j==7 and i>=2:yy=0  # shared shoulder seam
                    if j==7 and i<2: yy=(1 if back else -1)*(.043 if i==0 else .026)
                    if j<4 and i==4:yy=0  # side seam below axilla
                    # Small designed hem compression rather than periodic noise.
                    if j==2 and i==3:yy*=.93
                    xx=side*w*t
                    if j==7:
                        xx=side*[0,.047,.065,.157,.211][i]
                        if i<2:zz=([1.486,1.487] if back else [1.456,1.466])[i]
                        elif i==2:zz=1.487
                    if i==4 and j>=4:
                        # Round the sleeve root around the covered deltoid.
                        # Old vertical panel spacing pinched its top-front arc.
                        xx=side*[.189,.207,.211,.211][j-4]
                        yy=-.012+(1 if back else -1)*[.060,.079,.049,0][j-4]
                        zz=[1.335,1.408,1.459,1.479][j-4]
                    p=(xx,yy,zz)
                    panel[side,back,j,i]=p
            for j in range(7):
                for i in range(4):
                    m.face([panel[side,back,j,i],panel[side,back,j,i+1],panel[side,back,j+1,i+1],panel[side,back,j+1,i]],'Tee')
        # Close the small wedge from side seam to the armpit root.
        m.face([panel[side,False,3,4],panel[side,False,4,4],panel[side,True,4,4]],'Tee')
        ring=[panel[side,False,j,4] for j in (4,5,6,7)]+[panel[side,True,j,4] for j in (6,5,4)]
        # Refine the seven sewn shoulder/armpit edges locally into fourteen.
        ids=[m.vert(p) for p in ring]
        midpoints=[tuple((Vector(ring[i])+Vector(ring[(i+1)%7]))*.5) for i in range(7)]
        edgepoints={frozenset((ids[i],ids[(i+1)%7])):m.vert(midpoints[i]) for i in range(7)}
        for fi,face in enumerate(m.f):
            expanded=[]
            for j,index in enumerate(face):
                expanded.append(index)
                edge=frozenset((index,face[(j+1)%len(face)]))
                if edge in edgepoints:expanded.append(edgepoints[edge])
            m.f[fi]=expanded
        ring=[p for pair in zip(ring,midpoints) for p in pair]
        target=[]
        center=Vector((side*.346,-.012,1.409));across=Vector((0,0,1))
        # Ring starts at underarm/front and passes over shoulder to underarm/back.
        angles=[-2.45,-1.55,-.72,0,.72,1.55,2.45]
        refined=[]
        for i,a in enumerate(angles):
            b=angles[i+1] if i<6 else angles[0]+math.tau
            refined.extend([a,(a+b)*.5])
        for a in refined:
            p=center+across*(.061*math.cos(a))+Vector((0,.056*math.sin(a),0))
            target.append(tuple(p))
        mid=[tuple(Vector(a).lerp(Vector(b),.62)) for a,b in zip(ring,target)]
        m.loft([ring,mid,target],'Tee')
        inner=[tuple(center+(Vector(p)-center)*.97+Vector((-side*.002,0,0))) for p in target]
        m.bridge(target,inner,'Tee.Seam')
    collar=[panel[-1,False,7,i] for i in (2,1,0)]+[panel[1,False,7,i] for i in (1,2)]
    collar += [panel[1,True,7,i] for i in (1,0)]+[panel[-1,True,7,1]]
    collar_inner=[(x*.94,y*.94,z-.0015) for x,y,z in collar]
    m.bridge(collar,collar_inner,'Tee.Seam')
    # Leave collar, hem and two cuff openings intentionally open.
    obj=m.finish('Shirt','garment',boundaries=4)
    return obj


def arm_hand(side):
    m=Mesh()
    # True T: common horizontal humerus/forearm axis, palms -Y, thumbs +Z.
    across=Vector((0,0,-1));down=Vector((side,0,0))
    wrist=Vector((side*.687,-.012,1.409))
    def world(x,y,z):return tuple(wrist+across*x+Vector((0,y,0))+down*z)
    def contour(w,d):
        front=[(w*t,-d*math.sqrt(1-(.92*t)**2)) for t in [-1,-.75,-.5,-.25,0,.25,.5,.75,1]]
        return front+[(x,-y) for x,y in reversed(front)]
    # Shared eighteen-vertex sections at upper arm, elbow, forearm and wrist.
    rings=[]
    # Deltoid maximum sits UNDER the sleeve, not on the exposed cuff exit.
    for along,shift,width,depth in [(-.487,0,.044,.038),(-.433,0,.058,.049),
                                  (-.373,0,.053,.047),(-.321,0,.048,.043),
                                  (-.255,0,.040,.037),(-.222,0,.035,.033),
                                  (-.197,0,.036,.032),(-.166,.001,.038,.033),
                                  (-.090,.002,.032,.027),(-.027,0,.024,.019),(0,0,.022,.017)]:
        rings.append([world(x+shift,y,along) for x,y in contour(width,depth)])
    m.loft(rings,'Skin');m.face(list(reversed(rings[0])),'Skin')
    # Palm panels branch into four fingers and thumb through shared boundaries.
    panel={}
    palm=[(0,.022,.017),(.022,.030,.019),(.047,.035,.020),(.066,.036,.018),(.077,.036,.014)]
    for back in (False,True):
        for j,(z,w,d) in enumerate(palm):
            for i,t in enumerate([-1,-.75,-.5,-.25,0,.25,.5,.75,1]):
                yy=(1 if back else -1)*d*math.sqrt(1-(.92*t)**2)
                zz=z
                if j==4:zz += (.001 if i%2 else -.006) - .011*max(0,t)
                # The outer little-finger root must follow, not reverse over,
                # the preceding .066 m palm station. Move only its shared
                # front/back corner and derived edge midpoint: .060 -> .067.
                # All other palm, finger, wrist and arm coordinates stay fixed.
                if j==4 and i==8:zz=.067
                panel[back,j,i]=world(t*w,yy,zz)
        for j in range(4):
            for i in range(8):m.face([panel[back,j,i],panel[back,j,i+1],panel[back,j+1,i+1],panel[back,j+1,i]],'Skin')
    # Wrist panel order matches arm contour exactly.
    for i in (0,8):
        for j in range(4):
            if i==0 and j in (1,2):continue  # thumb branch, not an overlapping part
            m.face([panel[False,j,i],panel[False,j+1,i],panel[True,j+1,i],panel[True,j,i]],'Skin')
    for digit,length,spread in [(0,.060,-.13),(1,.073,-.035),(2,.068,.055),(3,.051,.18)]:
        i=digit*2
        front=[panel[False,4,k] for k in (i,i+1,i+2)]
        back=[panel[True,4,k] for k in (i+2,i+1,i)]
        right=tuple((Vector(front[-1])+Vector(back[0]))*.5)
        left=tuple((Vector(back[-1])+Vector(front[0]))*.5)
        root=front+[right]+back+[left]
        # Side midpoint is also used by neighboring digit roots. At the outside,
        # split the corresponding palm side edge to avoid a T-junction.
        for edge_a,edge_b,mid in [(front[-1],back[0],right),(back[-1],front[0],left)]:
            a=m.vert(edge_a);b=m.vert(edge_b);midid=m.vert(mid)
            for fi,f in enumerate(m.f):
                expanded=[]
                for k,index in enumerate(f):
                    expanded.append(index)
                    if {index,f[(k+1)%len(f)]}=={a,b}:expanded.append(midid)
                m.f[fi]=expanded
        cx=(-.027+digit*.018);base=.077-.011*max(0,cx/.036)
        sections=[root]
        radius=.0084 if digit<3 else .0071
        for fraction,scale in [(.23,1),(.48,.96),(.74,.83),(.94,.67),(1,.32)]:
            z=base+length*fraction;x=cx+spread*length*fraction
            yy=-.006*fraction*fraction
            octagon=[(-.75,-.66),(0,-1),(.75,-.66),(1,0),(.75,.66),(0,1),(-.75,.66),(-1,0)]
            sections.append([world(x+u*radius*scale,yy+v*radius*.85*scale,z) for u,v in octagon])
        m.loft(sections,'Skin');m.face(sections[-1],'Skin')
    root=[panel[False,j,0] for j in (1,2,3)]+[panel[True,j,0] for j in (3,2,1)]
    sections=[root]
    for x,z,w,d in [(-.044,.047,.012,.014),(-.055,.063,.010,.011),(-.064,.078,.008,.009),(-.067,.084,.004,.004)]:
        # Six-point thumb cross section has distinct thenar base and two joints.
        sections.append([world(x+u*w*.707,yy*d-.005,z+u*w*.707) for u,yy in [(-.8,-.6),(0,-1),(.8,-.6),(.8,.6),(0,1),(-.8,.6)]])
    m.loft(sections,'Skin');m.face(sections[-1],'Skin')
    obj=m.finish('ArmHand.'+str(side),'arm_hand')
    obj['wrist']=list(wrist);obj['elbow']=list(wrist+down*(-.209));obj['digits']=5
    obj['shoulder']=list(wrist+down*(-.487))
    obj['palm_normal']=[0,-1,0];obj['thumb_direction']=[0,0,1]
    obj['palm_center']=list(wrist+down*.045)


def trousers():
    m=Mesh();panel={}
    rows=[(1.025,.158,.091),(.996,.163,.097),(.937,.173,.105),(.884,.175,.103),(.833,.168,.096)]
    for side in (-1,1):
        for back in (False,True):
            for j,(z,w,d) in enumerate(rows):
                for i,t in enumerate([0,.25,.5,.75,1]):
                    yy=(1 if back else -1)*d*math.sqrt(max(0,1-t*t))
                    zz=z
                    if j==4:
                        yy=(1 if back else -1)*d*math.sin(math.pi*t)
                        zz=.815+.048*t
                    panel[side,back,j,i]=(side*w*t,yy+.012,zz)
            for j in range(4):
                for i in range(4):m.face([panel[side,back,j,i],panel[side,back,j,i+1],panel[side,back,j+1,i+1],panel[side,back,j+1,i]],'Pants')
        root=[panel[side,False,4,i] for i in range(5)]+[panel[side,True,4,i] for i in (3,2,1)]
        sections=[root]
        # Hip, thigh, patella support rows, tapered calf, slight ankle break.
        for z,cx,cy,w,d in [(.752,.093,.010,.082,.092),(.641,.099,.000,.074,.077),
                            (.571,.103,-.009,.064,.067),(.537,.105,-.012,.062,.065),
                            (.500,.107,-.005,.063,.065),(.412,.112,.011,.062,.065),
                            (.288,.117,.016,.053,.058),(.184,.120,.010,.050,.052),
                            (.153,.121,.004,.055,.054),(.131,.121,.000,.052,.051)]:
            sections.append([(side*(cx-w*math.cos(i*math.tau/8)),cy-d*math.sin(i*math.tau/8),z+(.005*math.cos(i*math.tau/8) if z==.153 else 0)) for i in range(8)])
        m.loft(sections,'Pants')
        inset=[(x*.995,y*.99,z+.003) for x,y,z in sections[-1]]
        m.bridge(sections[-1],inset,'Pants.Seam')
    m.finish('Trousers','trousers',boundaries=3)
    waistband=Mesh()
    waistband.loft([ellipse(0,.012,z,w,d,24) for z,w,d in [(1.001,.163,.097),(1.008,.164,.098),(1.027,.159,.092)]],'Pants.Seam')
    waistband.finish('Waistband','trim',boundaries=2)


def shoes():
    for side in (-1,1):
        m=Mesh();rings=[]
        # Authored asymmetric-in-depth footprint: broad toe box, fitted heel.
        footprint=[(-.030,-.126),(-.046,-.109),(-.051,-.063),(-.045,.011),(-.033,.063),
                   (0,.070),(.033,.063),(.045,.011),(.051,-.063),(.046,-.109),(.030,-.126),(0,-.132)]
        for z,scale in [(0,.94),(.013,1),(.029,1)]:
            rings.append([(side*.121+x*scale,y*scale,z) for x,y in footprint])
        m.loft(rings,'Sole');m.face(list(reversed(rings[0])),'Sole')
        upper=[rings[-1]]
        for h,scale,toe_lift in [(.045,.96,.006),(.072,.87,-.012),(.098,.69,-.030),(.153,.52,-.020)]:
            upper.append([(side*.121+x*scale,y*(.46 if h==.153 else .77 if h==.098 else .96),h+toe_lift*max(0,-y/.132)) for x,y in footprint])
        m.loft(upper,'Shoe');m.face(upper[-1],'Shoe')
        # Laces are four restrained flat bands, not high-resolution cylinders.
        for j in range(3):
            yy=-.066+j*.023;zz=.078+j*.009
            m.face([(side*.121-.025,yy,zz),(side*.121+.025,yy,zz),(side*.121+.025,yy+.004,zz+.002),(side*.121-.025,yy+.004,zz+.002)],'Eye.White')
        m.finish('Shoe.'+str(side),'shoe',boundaries=3)


def build(study=False):
    global ROOT,COLL
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name,color in PALETTE.items():
        mat=bpy.data.materials.new(name);mat.use_nodes=True;mat.diffuse_color=(*color,1)
        node=mat.node_tree.nodes.get('Principled BSDF')
        node.inputs['Base Color'].default_value=(*color,1)
        node.inputs['Roughness'].default_value=.82
    COLL=bpy.data.collections.new('NEUTRAL_CHARACTER');bpy.context.scene.collection.children.link(COLL)
    ROOT=bpy.data.objects.new('NeutralBase',None);COLL.objects.link(ROOT)
    ROOT['forward']=[0,-1,0];ROOT['pose']='symmetric horizontal T-pose; palms forward, thumbs up; no rig'
    head();shirt()
    if not study:
        arm_hand(-1);arm_hand(1);trousers();shoes()
    scene=bpy.context.scene
    scene.unit_settings.system='METRIC';scene['study']=study
    scene['status']='Unapproved neutral geometry candidate; no rig or runtime authorization'
    scene['brief']='../brief.md';scene['concept']='../concept-cel-shaded-candidate.webp'
    scene['construction']='Explicit shared-edge topology; no remesh or subdivision'
    bpy.context.view_layer.update()


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--study',action='store_true')
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    output=args.output.resolve()
    if output.exists():raise FileExistsError('Refusing existing output: '+str(output))
    if output.suffix!='.blend' or not output.parent.is_dir():raise ValueError('Existing directory and new .blend path required')
    print('NEUTRAL BUILD BEGIN',output,flush=True)
    build(args.study);bpy.ops.wm.save_as_mainfile(filepath=str(output))
    print('NEUTRAL BUILD SAVED',output,flush=True)
