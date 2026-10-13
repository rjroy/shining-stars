"""Deterministic architectural candidate. Blender --background --python-exit-code 1
--python /absolute/build.py -- --output /absolute/new.blend
No external inputs, references, textures, exports, or presentation scene required.
"""
import argparse
import math
import random
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

SEED = 422
MAT_NAMES = ['Limestone', 'Recess', 'Slate', 'Cornice', 'Gilt', 'Window']
PALETTES = {
    'audience': [(0.42, .31, .21), (.10, .085, .12), (.035, .085, .14),
                 (.62, .49, .30), (.65, .38, .105), (1.0, .47, .12)],
    'twilight': [(.24, .20, .34), (.055, .035, .09), (.065, .045, .16),
                 (.39, .32, .49), (.45, .30, .39), (.64, .32, 1.0)],
}


def palette(mode):
    for name, color in zip(MAT_NAMES, PALETTES[mode]):
        mat = bpy.data.materials.get(name)
        if mat is None:
            mat = bpy.data.materials.new(name)
            mat.use_nodes = True
        mat.diffuse_color = (*color, 1)
        node = mat.node_tree.nodes.get('Principled BSDF')
        node.inputs['Base Color'].default_value = (*color, 1)
        node.inputs['Roughness'].default_value = .68 if name != 'Gilt' else .39
        node.inputs['Metallic'].default_value = .48 if name == 'Gilt' else 0
        node.inputs['Emission Color'].default_value = (*color, 1)
        node.inputs['Emission Strength'].default_value = 1.8 if name == 'Window' else 0


class Mesh:
    """Closed architectural shells, joined by material into editable local meshes.
    No destructive boolean/modifier stack; seams/intersections represent masonry joints.
    """
    def __init__(self):
        self.v, self.f, self.m = [], [], []

    def shell(self, rings, mat):
        n, start = len(rings[0]), len(self.v)
        self.v.extend(p for ring in rings for p in ring)
        faces = [tuple(start + i for i in reversed(range(n)))]
        for r in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                faces.append((start+r*n+i, start+r*n+j,
                              start+(r+1)*n+j, start+(r+1)*n+i))
        faces.append(tuple(start+(len(rings)-1)*n+i for i in range(n)))
        self.f.extend(faces)
        self.m.extend([mat] * len(faces))

    def rect(self, x, y, w, d, profiles, mat=0, bevel=.08):
        # chamfered rectangles: deliberate flat planes, no toy-rounding
        b = min(w, d) * bevel
        points = [(-w/2+b,-d/2), (w/2-b,-d/2), (w/2,-d/2+b),
                  (w/2,d/2-b), (w/2-b,d/2), (-w/2+b,d/2),
                  (-w/2,d/2-b), (-w/2,-d/2+b)]
        self.shell([[(x+px*s, y+py*s, z) for px,py in points]
                    for z,s in profiles], mat)

    def round(self, x, y, profiles, mat=0, n=8, phase=math.pi/8):
        self.shell([[(x+rad*math.cos(phase+i*2*math.pi/n),
                      y+rad*math.sin(phase+i*2*math.pi/n),z)
                     for i in range(n)] for z,rad in profiles], mat)

    def panel(self, poly, depth, center, angle, mat):
        # A closed extruded profile in facade coordinates, local x horizontal, z up.
        cx, cy, cz = center
        co, si = math.cos(angle), math.sin(angle)
        self.shell([[(cx+u*co-v*si, cy+u*si+v*co, cz+z)
                     for u,z in poly] for v in (-depth/2, depth/2)], mat)

    def box(self,x,y,z,w,d,h,mat=0):
        self.rect(x,y,w,d,[(z,1),(z+h,1)],mat)

    def lancet(self, x,y,z,w,h,angle=0, lit=True,slope=0):
        # nested shallow stone reveal, dark recess, thin window; no wall booleans.
        start=len(self.v)
        shape = [(-.5,0),(.5,0),(.5,.69),(.34,.83),(0,1),(-.34,.83),(-.5,.69)]
        for factor, shift, mat in [(1.23,0,3),(1.04,-.055,1),(.72,-.085,5 if lit else 1)]:
            nx,ny = -math.sin(angle)*shift, math.cos(angle)*shift
            poly=[(u*w*factor,zz*h*factor) for u,zz in shape]
            self.panel(poly,.07,(x+nx,y+ny,z),angle,mat)
        # stone mullion splitting luminous lancet, retains pointed silhouette
        if w > .48:
            self.panel([(-w*.045,0),(w*.045,0),(w*.045,h*.80),(-w*.045,h*.80)],
                       .09,(x+math.sin(angle)*.105,y-math.cos(angle)*.105,z),angle,3)
        for j in range(start,len(self.v)):
            px,py,pz=self.v[j]
            self.v[j]=(px-math.sin(angle)*slope*(pz-z),
                       py+math.cos(angle)*slope*(pz-z),pz)

    def arch(self,x,y,z,span,rise,pier,depth,top,mat=0):
        # Open pointed arcade: each voussoir strip part has closed front/back.
        pts=[]
        steps=12
        for i in range(steps+1):
            t=i/steps
            xx=-span/2+span*t
            zz=rise*(1-abs(2*t-1)**1.65)
            pts.append((xx,zz))
        for a,b in zip(pts,pts[1:]):
            self.panel([a,b,(b[0],top),(a[0],top)],depth,(x,y,z),0,mat)
        for sign in (-1,1):
            self.box(x+sign*(span/2+pier/2),y,0,pier,depth,z+top,mat)
            self.box(x+sign*(span/2+pier/2),y-depth*.55,0,pier*.43,depth*.30,z+top+.6,3)
        # narrow projecting arch surround: follows opening rather than hiding it
        for a,b in zip(pts,pts[1:]):
            self.panel([a,b,(b[0],b[1]+.26),(a[0],a[1]+.26)],.20,
                       (x,y-depth/2-.08,z),0,3)

    def finish(self,name,coll,loc=(0,0,0),parent=None):
        mesh=bpy.data.meshes.new(name+'Mesh')
        mesh.from_pydata(self.v,[],self.f)
        for mn in MAT_NAMES:
            mesh.materials.append(bpy.data.materials[mn])
        for face, mi in zip(mesh.polygons,self.m):
            face.material_index=mi
        bm=bmesh.new(); bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(mesh); bm.free(); mesh.update()
        obj=bpy.data.objects.new(name,mesh); coll.objects.link(obj)
        obj.location=loc; obj.parent=parent
        obj['construction']='closed intersecting masonry shells; applied window reveals'
        return obj


def roof(m,x,y,z,w,d,h,kind=0):
    if kind == 0:
        # swept hipped spire with a flared eave and a narrowing shoulder
        m.rect(x,y,w,d,[(z,1.12),(z+.23,1.12),(z+.65,.93),
                       (z+h*.30,.66),(z+h*.68,.28),(z+h,.026)],2,.10)
        m.rect(x,y,w,d,[(z-.15,1.13),(z+.08,1.13)],3,.10)
    else:
        # long gabled roof, clipped eave, ridge cap: not a scaled cone
        verts=[(-w*.55,0),(w*.55,0),(w*.47,h*.18),(w*.05,h),
               (-w*.05,h),(-w*.47,h*.18)]
        m.panel(verts,d*1.08,(x,y,z),0,2)
        m.box(x,y,z+h,w*.13,d*1.13,.16,3)
        m.box(x,y,z-.12,w*1.13,d*1.14,.24,3)
    m.round(x,y,[(z+h-.1,.10),(z+h+.9,.065),(z+h+1.35,.014)],4,n=6)


def tower(w=5,h=28,kind=0,detail=2):
    m=Mesh(); d=w*(.90 if kind%2 else 1)
    m.rect(0,0,w,d,[(0,1.15),(.65,1.15),(1.35,1),(h*.78,.89),(h,.96)])
    for z,s in [(1.15,1.09),(h*.46,.98),(h*.80,1.02),(h-.45,1.10)]:
        m.rect(0,0,w,d,[(z,s),(z+.26,s)],3)
    # long continuous corner buttresses with sloped shoulders
    for sx in (-1,1):
        for sy in (-1,1):
            m.rect(sx*w*.45,sy*d*.45,w*.15,d*.15,
                   [(0,1.4),(h*.63,1),(h*.75,.60),(h+.30,.60)],3)
    tiers=max(2,int(h/6.5))
    for face in range(4 if detail>1 else 2):
        angle=face*math.pi/2
        wall=(d if face%2==0 else w)/2
        for level in range(tiers):
            z=2.6+level*(h-6)/tiers
            taper=.11/(h*.78-1.35)
            radius=wall*(1-taper*(z-1.35))+.035
            for slot in (-1,1):
                u=slot*w*.19
                m.lancet(u*math.cos(angle)+radius*math.sin(angle),
                         u*math.sin(angle)-radius*math.cos(angle),
                         z,w*.105,min(2.7,h*.10),angle,
                         (level+face+slot+kind)%4!=0,slope=wall*taper)
        # Upper storey is not a blank cuboid: paired tall lancets below the crown.
        z=h*.82
        slope=-wall*.07/(h*.22)
        radius=wall*(.89+.07*(z-h*.78)/(h*.22))+.04
        for slot in (-1,1):
            u=slot*w*.18
            m.lancet(u*math.cos(angle)+radius*math.sin(angle),
                     u*math.sin(angle)-radius*math.cos(angle),z,
                     w*.14,h*.105,angle,True,slope=slope)
    if kind%3==1:
        # raised lantern storey, visibly open between stone supports
        b=h; r=w*.34
        m.box(0,0,b,w*1.08,d*1.08,.40,3)
        for sx in (-1,1):
            for sy in (-1,1):
                m.rect(sx*r,sy*r,w*.15,w*.15,[(b,1),(b+w*.63,.78)],0)
        m.box(0,0,b+w*.63,w*.86,d*.86,.32,3)
        roof(m,0,0,b+w*.63+.3,w*.93,d*.93,w*1.65)
        for sx in (-1,1):
            for sy in (-1,1):
                m.round(sx*w*.51,sy*d*.51,[(h,.27),(h+w*.52,.19),(h+w*.95,.018)],3,6)
    else:
        roof(m,0,0,h,w*1.07,d*1.07,w*(2.0 if kind%3==0 else 1.28))
        if detail>1:
            for sx in (-1,1):
                for sy in (-1,1):
                    m.round(sx*w*.48,sy*d*.48,[(h-.6,w*.10),(h+1,w*.085),
                                                          (h+w*.71,.014)],3,6)
    return m


def palace(w=10,d=7,h=10,kind=0):
    m=Mesh()
    m.rect(0,0,w,d,[(0,1.02),(.5,1.02),(.9,.97),(h,.96)])
    for z in [1,h*.50,h-.2]:
        m.box(0,0,z,w*1.04,d*1.04,.25,3)
    roof_h=h*(.63 if kind%3==0 else .40)
    roof(m,0,0,h,w,d,roof_h,1 if kind%3!=2 else 0)
    for face in range(4):
        angle=face*math.pi/2
        width=w if face%2==0 else d
        wall=d if face%2==0 else w
        bays=max(2,int(width/2.4))
        for j in range(bays):
            u=(j-(bays-1)/2)*width/(bays+.4)
            for z in ((1.6,h*.39,h*.69) if h>12 else (1.6,h*.55)):
                m.lancet(u*math.cos(angle)+wall*.482*math.sin(angle),
                         u*math.sin(angle)-wall*.482*math.cos(angle),
                         z,.62,min(h*.24,2.7),angle,(j+face+kind)%4!=0)
        for u in (-width*.44,0,width*.44):
            m.panel([(-.12,0),(.12,0),(.12,h),(-.12,h)],.27,
                    (u*math.cos(angle)+wall*.49*math.sin(angle),
                     u*math.sin(angle)-wall*.49*math.cos(angle),0),angle,3)
    # Roof dormers add inhabited silhouette, no uniform cone forest.
    for u in ((-w*.27,w*.27) if kind%3!=2 else (0,)):
        m.box(u,-d*.23,h+.5,1.0,1.5,1.65,0)
        roof(m,u,-d*.23,h+2.15,1.05,1.6,1.3,1)
        m.lancet(u,-d*.23-.79,h+.70,.44,1.1)
    # Start inside the roof volume; an elevated short chimney floated above low roofs.
    m.box(w*.29,d*.24,h+.12,.7,.65,roof_h*.70+.70,0)
    m.box(w*.29,d*.24,h+roof_h*.70+.65,.88,.83,.23,3)
    return m


def root(name,coll,loc=(0,0,0),parent=None):
    obj=bpy.data.objects.new(name,None);coll.objects.link(obj)
    obj.location=loc;obj.parent=parent;obj.empty_display_type='PLAIN_AXES'
    return obj


def landmark(coll,parent):
    m=Mesh()
    # Octagonal transition from clustered lower precinct into slender central shaft.
    m.round(0,0,[(0,8),(1.2,8),(2,7.1),(18,6.6),(21,5.3),(23,5.3)],0,8)
    for z,r in [(1,8.15),(17.6,6.9),(21,5.6),(32,4.65),(52,3.25),(64,2.6)]:
        m.round(0,0,[(z,r),(z+.42,r)],3,8)
    m.round(0,0,[(22,4.9),(31,4.45),(35,3.8),(52,3.0),(64,2.42),(68,2.3)],0,8)
    # Long vertical ribs articulate the stepped profile, ending in eight pinnacles.
    for i in range(8):
        a=math.pi/8+i*math.pi/4
        co,si=math.cos(a),math.sin(a)
        rings=[]
        for z,r,t in [(2,7.0,.50),(17,6.6,.46),(25,4.9,.34),(34,4.1,.30),
                      (52,3.10,.23),(68,2.44,.20),(73,2.42,.07)]:
            rings.append([(r*co+t*math.cos(k*math.pi/2),
                           r*si+t*math.sin(k*math.pi/2),z) for k in range(4)])
        m.shell(rings,3)
    # Pointed elongated windows on all eight shaft faces, tall but restrained.
    for face in range(8):
        a=face*math.pi/4
        for z,r,w,h,slope in [(5,6.50,1.35,8.7,.0289),(25,4.43,1.1,6.0,.0462),
                         (36,3.507,.88,10,.04348),(54,2.722,.65,7.4,.04465)]:
            m.lancet(r*math.sin(a),-r*math.cos(a),z,w,h,a,slope=slope)
    # Four slender intermediate pinnacles grow from the lower octagonal masonry.
    # Their staggered shoulders break the uninterrupted obelisk read of the core.
    for sx,sy,peak in [(-1,-1,65),(1,-1,62),(-1,1,73),(1,1,70)]:
        x,y=sx*4.7,sy*3.4
        spring=peak-12
        m.round(x,y,[(16,.86),(24,.72),(spring-5,.47),(spring,.48)],0,8)
        m.round(x,y,[(spring-.35,.63),(spring+.15,.63)],3,8)
        m.round(x,y,[(spring,.65),(spring+1,.57),(peak-4,.19),(peak,.018)],2,8)
        for z in (30,43):
            radius=.70-(z-24)*.009
            m.lancet(x,y-radius-.025,z,.35,4.4,slope=.009)
        # A tapered masonry web returns each pinnacle's lower stem to the core.
        m.panel([(sx*3.2,25),(sx*5.1,25),(sx*5.1,34),(sx*3.2,40)],
                .42,(0,y,0),0,3)
    # Open crown: eight columns carry a ring and the concave needle roof.
    for i in range(8):
        a=math.pi/8+i*math.pi/4
        m.round(2.1*math.cos(a),2.1*math.sin(a),
                [(68,.23),(74,.18)],3,6)
    m.round(0,0,[(73.6,2.64),(74.05,2.64)],3,8)
    m.round(0,0,[(74,2.8),(74.55,2.8),(77,1.90),(83,1.02),(91,.34),(96,.025)],2,8)
    # Narrow gilded roof edges, no floating symbol or fantastical sky ornament.
    for i in range(8):
        a=math.pi/8+i*math.pi/4
        points=[Vector((r*math.cos(a),r*math.sin(a),z))
                for z,r in [(74,2.82),(77,1.92),(83,1.04),(91,.36),(96,.025)]]
        for p,q in zip(points,points[1:]):
            v=(q-p).normalized(); side=v.cross(Vector((0,1,0))).normalized()*.038
            other=v.cross(side).normalized()*.038
            m.shell([[tuple(pt+side+other),tuple(pt-side+other),
                      tuple(pt-side-other),tuple(pt+side-other)] for pt in (p,q)],4)
    m.round(0,0,[(95.7,.075),(99,.016)],4,6)
    # Four flying masonry arms create honest air gaps around the upper shaft.
    for side in (-1,1):
        for back in (-1,1):
            poly=[(side*3.6,30),(side*7.8,19),(side*8.6,16),
                  (side*8.6,24),(side*4.1,39),(side*3.6,39)]
            m.panel(poly,.72,(0,back*2.1,0),0,3)
    obj=m.finish('Landmark.ArticulatedSpire',coll,parent=parent)
    obj['role']='distinctive tallest slender skyline spire'
    # Attached wings and smaller shoulder towers share an actual lower precinct.
    for sx in (-1,1):
        palace(10,12,16,2).finish(f'Landmark.Wing.{sx}',coll,(sx*9,1,0),parent)
        for sy,h in [(-1,28),(1,36)]:
            tower(3.8,h,0).finish(f'Landmark.Shoulder.{sx}.{sy}',coll,
                                (sx*7.3,sy*5.5,4),parent)
    facade=Mesh()
    facade.box(0,-6,0,8,5,12,0)
    roof(facade,0,-6,12,8,5,7,1)
    facade.lancet(0,-8.55,1.5,2.6,8)
    for sx in (-1,1):
        facade.rect(sx*3.25,-8.5,.7,.9,[(0,1),(10,1),(14,.6)],3)
        facade.round(sx*3.25,-8.5,[(14,.44),(17,.018)],3,6)
    facade.finish('Landmark.EntryGable',coll,parent=parent)


def terrace(coll,parent,w,d,h,arcaded=True):
    m=Mesh()
    # Retaining foundation, with a recessed open colonnade in front.
    m.rect(0,d*.10,w,d*.80,[(-h,1),(0,1)],0,.12)
    m.box(0,0,0,w*1.03,d*1.03,.50,3)
    if arcaded:
        n=max(2,round(w/7))
        pitch=(w-2)/n; span=pitch-1.2
        for i in range(n):
            x=(i-(n-1)/2)*pitch
            # arch() base is zero; local lower gallery moved into place after creation
            start=len(m.v)
            m.arch(x,-d*.50,max(1.8,h-5.5),span,min(3,h*.45),.85,1.45,
                   h-max(1.8,h-5.5),0)
            for j in range(start,len(m.v)):
                px,py,pz=m.v[j];m.v[j]=(px,py,pz-h)
        m.box(0,-d*.51,.5,w,1.3,.65,3)
        for i in range(int(w/2.5)):
            m.box(-w*.48+i*2.5,-d*.51,1.10,.28,.36,.78,3)
        m.box(0,-d*.51,1.86,w,.38,.16,3)
    else:
        for i in range(max(2,int(w/5))):
            x=-w*.40+i*5
            m.rect(x,-d*.30,.65,1.2,[(-h,1.3),(-.8,.75)],3)
    return m.finish(parent.name+'.Terrace',coll,parent=parent)


def infrastructure(coll,master,districts):
    """Stepped urban retaining fabric, not a stage or gameplay plane.
    Connects module foundations; covered by their local courtyard surfaces.
    """
    par=root('Infrastructure.SteppedRetainingFabric',coll,parent=master)
    m=Mesh()
    # An irregular perimeter and sloped masonry toe supply a common architectural datum.
    outline=[(-133,10),(-108,-1),(-85,-8),(-53,-12),(-28,-10),(-8,1),
             (23,5),(52,-9),(78,-2),(107,7),(130,18),(133,83),
             (126,99),(84,96),(37,96),(-9,93),(-52,90),(-96,91),(-133,87)]
    m.shell([[(x*.985,y,-13) for x,y in outline],
             [(x,y,-7.0) for x,y in outline]],0)
    # Narrow connective street ribbons at each depth; profile follows district elevation.
    for indices in (range(8),range(8,14),range(14,21)):
        row=[districts[i] for i in indices]
        for left,right in zip(row,row[1:]):
            x1,y1,z1,w1,d1,_=left;x2,y2,z2,w2,d2,_=right
            # covered overlaps are deliberate masonry construction, no boolean dependency
            a=x1+w1*.43;b=x2-w2*.43
            if b<=a:continue
            poly=[(a,y1-d1*.30),(b,y2-d2*.30),(b,y2+d2*.30),(a,y1+d1*.30)]
            m.shell([[(x,y,-7) for x,y in poly],
                     [(poly[0][0],poly[0][1],z1),(poly[1][0],poly[1][1],z2),
                      (poly[2][0],poly[2][1],z2),(poly[3][0],poly[3][1],z1)]],0)
            m.shell([[(poly[0][0],poly[0][1],z1),(poly[1][0],poly[1][1],z2),
                      (poly[2][0],poly[2][1],z2),(poly[3][0],poly[3][1],z1)],
                     [(poly[0][0],poly[0][1],z1+.24),(poly[1][0],poly[1][1],z2+.24),
                      (poly[2][0],poly[2][1],z2+.24),(poly[3][0],poly[3][1],z1+.24)]],3)
    m.finish('Infrastructure.MasonryAndStreets',coll,parent=par)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    palette('audience')
    coll=bpy.data.collections.new('CITY_ASSET');bpy.context.scene.collection.children.link(coll)
    master=root('CITY.ProvisionalLayout',coll)
    master['status']='candidate pending user model approval; no runtime placement authority'
    master['axes']='Z up; viewer from -Y; X lateral; provisional meters'
    rng=random.Random(SEED)
    # Explicit nonuniform district composition: lowered central basin, taller flanks.
    # x,y,z,width,depth,layer. Roots expose placement independently of local detailing.
    districts=[(-107,17,17,28,22,'front'),(-78,9,11,27,24,'front'),
               (-44,3,5,30,23,'front'),(-12,13,0,28,22,'front'),
               (21,19,-2,26,22,'front'),(51,7,4,28,24,'front'),
               (83,13,11,28,23,'front'),(110,25,17,26,21,'front'),
               (-102,48,23,30,24,'middle'),(-61,39,19,38,30,'landmark'),
               (-20,44,8,30,25,'middle'),(17,48,4,28,25,'middle'),
               (56,43,15,32,26,'middle'),(96,53,23,31,27,'middle'),
               (-117,77,20,27,22,'rear'),(-79,76,18,30,22,'rear'),
               (-41,77,12,29,21,'rear'),(-2,77,7,29,22,'rear'),
               (35,81,9,31,22,'rear'),(73,78,16,29,22,'rear'),
               (112,84,23,29,23,'rear')]
    tower_data={}; palace_data={}
    def place_library(key, maker, name, local, parent, scale=(1,1,1),rotation=0):
        cache=tower_data if key.startswith('T') else palace_data
        if key not in cache:
            obj=maker().finish(name,coll,local,parent); cache[key]=obj.data
        else:
            obj=bpy.data.objects.new(name,cache[key]);coll.objects.link(obj)
            obj.location=local;obj.parent=parent
        obj.scale=scale;obj.rotation_euler.z=rotation
        obj['library_variant']=key
        return obj
    for index,(x,y,z,w,d,layer) in enumerate(districts):
        par=root(f'District.{index:02d}.{layer}',coll,(x,y,z),master)
        par['depth_layer']=layer
        par['placement']='provisional editable district root'
        terrace(coll,par,w,d,z+7,index in {0,1,6,7,8,9,13})
        if layer=='landmark':
            landmark(coll,par)
            continue
        # Connected palace street: unequal footprints/depth offsets, not a tower grid.
        house_positions=[(-w*.31,-d*.22),(rng.uniform(-.06,.05)*w,-d*.27),
                         (w*.30,-d*.12),(-w*.28,d*.25),
                         (w*.06,d*.24),(w*.33,d*.29)]
        for j,(px,py) in enumerate(house_positions):
            k=(index*3+j*5)%9
            ww=5.5+(k%3)*1.5; dd=5.8+(k//3)*.95; hh=6.2+(k%4)*2.4
            place_library('P'+str(k),lambda ww=ww,dd=dd,hh=hh,k=k:palace(ww,dd,hh,k),
                          f'District.{index:02d}.Palazzo.{j}',(px,py,.52),par,
                          (rng.uniform(.91,1.08),rng.uniform(.92,1.14),rng.uniform(.80,1.24)),
                          rng.uniform(-.16,.16))
        count=2 if layer=='rear' else 2+(index%3==0)
        for j in range(count):
            k=(index*7+j*3)%12
            ww=3.25+(k%3)*.68
            hh=17+(k%5)*4.2
            # strongest secondary silhouette at side districts, never second hero
            if layer=='front': hh*=.84
            # Separate cache classes preserve front/rear heights deterministically.
            key='T'+str(k)+('.F' if layer=='front' else '.B')
            px=(-.28 if j==0 else .27 if j==1 else 0)*w
            py=(.28 if j==0 else .09 if j==1 else -.26)*d
            place_library(key,lambda ww=ww,hh=hh,k=k:tower(ww,hh,k,2),
                          f'District.{index:02d}.Tower.{j}',(px,py,.52),par,
                          (1,1,rng.uniform(.93,1.09)))
    infrastructure(coll,master,districts)
    # Short lateral elevated streets tie terrace clusters together, not a central stage.
    for label,x,y,z in [('West',-88,25,14),('East',70,26,14)]:
        par=root('Connector.'+label,coll,(x,y,z),master)
        m=Mesh()
        for i in range(3):
            m.arch((i-1)*6.4,0,-3,5.2,4.8,1.2,3.4,6.0)
        m.box(0,0,3,20.5,4.1,.65,3)
        m.box(0,-1.85,3.65,20.5,.25,1.2,0)
        m.box(0,1.85,3.65,20.5,.25,1.2,0)
        m.finish('Connector.'+label+'.ArcadedStreet',coll,parent=par)
    scene=bpy.context.scene
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    scene['asset']='Brightvale distant city'
    scene['seed']=SEED;scene['schema']=1
    scene['approval']='MODEL CANDIDATE ONLY; integration not authorized'
    scene['presentation']='Audience base materials; preview.py provides read-only variants'
    bpy.context.view_layer.update()
    return scene


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    output=args.output.resolve()
    if output.exists():
        raise FileExistsError('Refusing to overwrite existing candidate: '+str(output))
    if not output.parent.is_dir():
        raise FileNotFoundError(output.parent)
    print('CITY BUILD BEGIN',output,flush=True)
    build()
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    print('CITY BUILD SAVED',output,flush=True)
