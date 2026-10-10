"""Deterministic Blender build for approved Neon Twilight platform concept v4."""
import bpy
import math
import argparse
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
GENERATED = ROOT / "generated"
parser = argparse.ArgumentParser(description="Regenerate v8.3 without overwriting the approved source")
parser.add_argument("--output-dir", type=Path, default=GENERATED / "build")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
OUTPUT_DIR = args.output_dir.resolve()
if not OUTPUT_DIR.is_relative_to(GENERATED) or OUTPUT_DIR == GENERATED:
    raise ValueError("Output must be a new subdirectory within this asset's generated/ directory")
OUTPUT_DIR.mkdir(parents=True, exist_ok=False)
OUT = str(OUTPUT_DIR / "platform.blend")

def material(name, color, metallic=0.0, roughness=0.35, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1.0)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*color, 1.0)
    bs.inputs["Metallic"].default_value = metallic
    bs.inputs["Roughness"].default_value = roughness
    if emission:
        bs.inputs["Emission Color"].default_value = (*emission, 1.0)
        bs.inputs["Emission Strength"].default_value = strength
    return m

def mineral_material(name, color):
    """Low-contrast fine mineral variation; deterministic and node-only."""
    m = material(name, color, 0.42, 0.31)
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    bs = nodes.get("Principled BSDF")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 26.0
    noise.inputs["Detail"].default_value = 2.0
    noise.inputs["Roughness"].default_value = 0.55
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.28
    ramp.color_ramp.elements[0].color = (*(c * 0.82 for c in color), 1)
    ramp.color_ramp.elements[1].position = 0.72
    ramp.color_ramp.elements[1].color = (*(min(1.0, c * 1.16 + 0.002) for c in color), 1)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
    rough = nodes.new("ShaderNodeMapRange")
    rough.inputs["From Min"].default_value = 0.0
    rough.inputs["From Max"].default_value = 1.0
    rough.inputs["To Min"].default_value = 0.27
    rough.inputs["To Max"].default_value = 0.34
    links.new(noise.outputs["Fac"], rough.inputs["Value"])
    links.new(rough.outputs["Result"], bs.inputs["Roughness"])
    return m

def emitter_surface(name, color, strength):
    """Pure saturated emission keeps the inset readable; compositor adds bloom separately."""
    m=bpy.data.materials.new(name)
    m.diffuse_color=(*color,1)
    m.use_nodes=True
    nodes=m.node_tree.nodes
    nodes.clear()
    emit=nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value=(*color,1)
    emit.inputs["Strength"].default_value=strength
    output=nodes.new("ShaderNodeOutputMaterial")
    m.node_tree.links.new(emit.outputs["Emission"],output.inputs["Surface"])
    return m

def bezier_segment(p0,p1,p2,p3,steps=20):
    pts=[]
    for i in range(steps):
        t=i/steps; u=1-t
        pts.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],
                    u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return pts

def crest_loop(inner=False):
    """Concept v4: round crown, concave necks, deep front-edge tip, thin edging."""
    left=(-1.05,-1.98); crown=(0,-1.24); right=(1.05,-1.98)
    neck=(.30,-2.59); tip=(0,-2.80); left_neck=(-.30,-2.59)
    segs=[(left,(-.80,-1.52),(-.43,-1.24),crown),
          (crown,(.43,-1.24),(.80,-1.52),right),
          (right,(.60,-2.02),(.38,-2.21),neck),
          (neck,(.19,-2.68),(.06,-2.74),tip),
          (tip,(-.06,-2.74),(-.19,-2.68),left_neck),
          (left_neck,(-.38,-2.21),(-.60,-2.02),left)]
    outline=[p for segment in segs for p in bezier_segment(*segment,steps=24)]
    if not inner:
        return outline
    return offset_loop(outline,.065)

def offset_loop(outline,width):
    # Parallel inset, not an independently scaled diamond: preserves uniform trim width.
    inset=[]
    for i,p in enumerate(outline):
        a=Vector(outline[i-1]); b=Vector(p); c=Vector(outline[(i+1)%len(outline)])
        t0=(b-a).normalized(); t1=(c-b).normalized()
        n0=Vector((t0.y,-t0.x)); n1=Vector((t1.y,-t1.x))
        bisector=(n0+n1).normalized()
        distance=min(abs(width)*2.2,abs(width)/max(.25,bisector.dot(n0)))
        distance*=1 if width>0 else -1
        inset.append(tuple(b+bisector*distance))
    return inset

def crest_height(y, top):
    """The point rolls down the front lip rather than floating above a gold rail."""
    fold=max(0.0,min(1.0,(-y-2.50)/.30))
    return top-.36*fold

def crest_edging(outer, inner, mat):
    n=len(outer)
    # Explicit shallow chamfer shell avoids modifier-generated artifacts at the
    # acute point and concave shoulder junctions. Every cross section is closed.
    sections=[(outer,.425),(outer,.535),(offset_loop(outer,.009),.545),
              (offset_loop(inner,-.009),.545),(inner,.535),(inner,.425)]
    verts=[(x,y,crest_height(y,z)) for contour,z in sections for x,y in contour]
    faces=[]
    for section in range(len(sections)):
        next_section=(section+1)%len(sections)
        for i in range(n):
            j=(i+1)%n
            faces.append((section*n+i,section*n+j,next_section*n+j,next_section*n+i))
    me=bpy.data.meshes.new("Crest | curved front-lip edging mesh")
    me.from_pydata(verts,[],faces); me.materials.append(mat); me.update()
    obj=bpy.data.objects.new("Crest | narrow arched concave shield gold edging",me)
    bpy.context.collection.objects.link(obj)
    import bmesh
    bm=bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    bm.to_mesh(me); bm.free()
    return obj

def assign(obj, mat):
    obj.data.materials.append(mat)
    return obj

def bevel_box(name, loc, dims, mat, bevel=0.05, segments=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(o, mat)
    if bevel:
        mod = o.modifiers.new("Machined edge radius", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod = o.modifiers.new("Corner-weighted normals", "WEIGHTED_NORMAL")
        mod.keep_sharp = True
    return o

def curve(name, points, mat, radius=0.025, cyclic=False):
    c = bpy.data.curves.new(name, "CURVE")
    c.dimensions = "3D"
    c.resolution_u = 2
    c.bevel_depth = radius
    c.bevel_resolution = 3
    s = c.splines.new("POLY")
    s.points.add(len(points) - 1)
    for p, co in zip(s.points, points):
        p.co = (co[0], co[1], co[2], 1)
    s.use_cyclic_u = cyclic
    o = bpy.data.objects.new(name, c)
    bpy.context.collection.objects.link(o)
    assign(o, mat)
    return o

def chamfered_rect(cx, cy, hx, hy, cut):
    return [(cx-hx+cut,cy-hy),(cx+hx-cut,cy-hy),(cx+hx,cy-hy+cut),(cx+hx,cy+hy-cut),
            (cx+hx-cut,cy+hy),(cx-hx+cut,cy+hy),(cx-hx,cy+hy-cut),(cx-hx,cy-hy+cut)]

def ring_frame(name, outer, inner, z_bottom, z_top, mat, bevel=0.035):
    """Closed, profiled annular mesh; outer and inner loops are matching CCW points."""
    assert len(outer) == len(inner)
    n = len(outer)
    verts = ([(x,y,z_top) for x,y in outer] + [(x,y,z_top) for x,y in inner] +
             [(x,y,z_bottom) for x,y in outer] + [(x,y,z_bottom) for x,y in inner])
    faces = []
    for i in range(n):
        j=(i+1)%n
        faces.append((i,j,n+j,n+i))
        faces.append((i,2*n+i,2*n+j,j))
        faces.append((n+i,n+j,3*n+j,3*n+i))
        faces.append((2*n+i,3*n+i,3*n+j,2*n+j))
    me=bpy.data.meshes.new(name+" mesh")
    me.from_pydata(verts,[],faces)
    me.materials.append(mat)
    me.update()
    obj=bpy.data.objects.new(name,me)
    bpy.context.collection.objects.link(obj)
    import bmesh
    bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=bm.faces); bm.to_mesh(me); bm.free()
    if bevel:
        mod=obj.modifiers.new("Continuous machined profile", "BEVEL")
        mod.width=bevel; mod.segments=3
        obj.modifiers.new("Frame weighted normals", "WEIGHTED_NORMAL")
    return obj

def solid_crest_shield(name, outline, z_bottom, z_top, mat):
    """Closed, filled shield backing; covers the center seams below the crest star."""
    n = len(outline)
    verts = ([(x, y, crest_height(y,z_top)) for x, y in outline] +
             [(x, y, crest_height(y,z_bottom)) for x, y in outline])
    faces = [tuple(range(n)), tuple(reversed(range(n, 2*n)))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, n+i, n+j, j))
    me = bpy.data.meshes.new(name + " mesh")
    me.from_pydata(verts, [], faces)
    me.materials.append(mat)
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    # Split the surface at the lip before triangulating. A single nonplanar ngon
    # otherwise creates diagonals that pull the supposedly flat upper shield down.
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                          plane_co=(0,-2.50,0),plane_no=(0,1,0),dist=1e-8)
    for vertex in bm.verts:
        if abs(vertex.co.y+2.50)<1e-5:
            vertex.co.z=z_top if vertex.co.z>(z_top+z_bottom)/2 else z_bottom
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts)>4])
    bm.to_mesh(me)
    bm.free()
    # The backing's boundary is concealed by the modeled gold chamfer. Keep its
    # top clean and planar instead of beveling dense concave sampled boundaries.
    return obj

def panel_with_recess(name, cx, cy, hx, hy, top, bottom, well_hx, well_hy, well_floor, mat, pocket_mat):
    """Solid panel with a true shallow top pocket, closed walls, and recessed floor."""
    outer=chamfered_rect(cx,cy,hx,hy,0.10)
    well=chamfered_rect(cx,1.45,well_hx,well_hy,0.07)
    n=len(outer)
    verts=([(x,y,top) for x,y in outer]+[(x,y,top) for x,y in well]+
           [(x,y,bottom) for x,y in outer]+[(x,y,well_floor) for x,y in well])
    faces=[]
    # Four top-surface quads per corresponding boundary edge.
    for i in range(n):
        j=(i+1)%n
        faces.append((i,j,n+j,n+i))
    for i in range(n):
        j=(i+1)%n
        faces.append((i,2*n+i,2*n+j,j))
    for i in range(n):
        j=(i+1)%n
        faces.append((n+i,n+j,3*n+j,3*n+i))
    faces.append(tuple(reversed(range(2*n,3*n))))
    faces.append(tuple(range(3*n,4*n)))
    me=bpy.data.meshes.new(name+" mesh")
    me.from_pydata(verts,[],faces)
    me.materials.append(mat); me.materials.append(pocket_mat)
    for p in me.polygons:
        if p.index == len(faces)-1: p.material_index=1
    me.update()
    obj=bpy.data.objects.new(name,me)
    bpy.context.collection.objects.link(obj)
    import bmesh
    bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=bm.faces); bm.to_mesh(me); bm.free()
    mod=obj.modifiers.new("Soft panel and pocket edges", "BEVEL")
    mod.width=0.025; mod.segments=3
    obj.modifiers.new("Panel weighted normals", "WEIGHTED_NORMAL")
    return obj

def sculpted_corner_cap(name, sx, sy, mat):
    footprint=[(5.98,2.64),(5.36,2.64),(5.52,2.34),(5.68,2.02),(5.98,2.12)]
    footprint=[(sx*x,sy*y) for x,y in footprint]
    n=len(footprint); zb=-.28; zt=.40
    verts=[(x,y,zb) for x,y in footprint]+[(x,y,zt) for x,y in footprint]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    for i in range(n):
        j=(i+1)%n; faces.append((i,j,n+j,n+i))
    me=bpy.data.meshes.new(name+" mesh"); me.from_pydata(verts,[],faces); me.materials.append(mat); me.update()
    obj=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(obj)
    import bmesh
    bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=bm.faces); bm.to_mesh(me); bm.free()
    mod=obj.modifiers.new("Forged chamfered cap edges","BEVEL"); mod.width=.055; mod.segments=3
    obj.modifiers.new("Cap weighted normals","WEIGHTED_NORMAL")
    return obj

def star(name, x, y, z, outer, inner, depth, mat, facet_mat=None, points=8, rotation=math.pi/2, elongation=1.0, vertical_scale=1.0):
    ring = []
    for i in range(points * 2):
        a = rotation + i * math.pi / points
        r = outer if i % 2 == 0 else inner
        r *= elongation if (i % 4 == 0 and i % 2 == 0) else 1.0
        ring.append((x + math.cos(a) * r, y + math.sin(a) * r * vertical_scale, z))
    n = len(ring)
    verts = ([(px, py, z - depth / 2) for px, py, _ in ring] +
             [(px, py, z + depth / 2) for px, py, _ in ring] + [(x,y,z+depth/2)])
    faces = [tuple(range(n - 1, -1, -1))]
    for i in range(n):
        faces.append((2*n,n+i,n+(i+1)%n))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    me = bpy.data.meshes.new(name + " mesh")
    me.from_pydata(verts, [], faces)
    me.materials.append(mat)
    if facet_mat:
        me.materials.append(facet_mat)
        for face_index, poly in enumerate(me.polygons):
            if 1 <= face_index <= n and face_index % 2 == 0:
                poly.material_index = 1
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    bevel = o.modifiers.new("Fine star edge bevel", "BEVEL")
    bevel.width = min(0.025, depth * 0.18)
    bevel.segments = 2
    o.modifiers.new("Star weighted normals", "WEIGHTED_NORMAL")
    return o

def point_camera(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.materials, bpy.data.curves, bpy.data.meshes, bpy.data.cameras, bpy.data.lights):
    for block in list(datablocks):
        if block.users == 0:
            datablocks.remove(block)

gold = material("Gold | brushed warm alloy", (0.72, 0.36, 0.075), 0.82, 0.23)
gold_light = material("Gold | illuminated edge", (0.95, 0.55, 0.16), 0.68, 0.2, (1.0, 0.36, 0.055), 0.35)
base = material("Midnight blue | chassis", (0.012, 0.025, 0.065), 0.58, 0.26)
crest_backing = material("Crest shield | solid midnight enamel", (0.018, 0.025, 0.064), 0.48, 0.29)
panel_mats = [
    mineral_material("Panel | sapphire mineral glass", (0.012, 0.038, 0.14)),
    mineral_material("Panel | plum mineral glass", (0.075, 0.012, 0.055)),
    mineral_material("Panel | amber mineral glass", (0.095, 0.038, 0.008)),
    mineral_material("Panel | emerald mineral glass", (0.008, 0.075, 0.038)),
]
well_dark = material("Hit well | recessed midnight", (0.008,0.012,0.025), .25, .38)
lane_edge = [material("Lane edge | cyan", (0.015, 0.24, 0.72), .55, .22, (.01, .16, 1), .7),
             material("Lane edge | magenta", (.58, .025, .29), .5, .23, (.9, .015, .32), .55),
             gold_light,
             material("Lane edge | green", (.01, .42, .19), .5, .23, (.01, .8, .22), .55)]
bar_mats = [emitter_surface("Hit | cyan pure emitter",(.001,.17,.88),1.25),
            emitter_surface("Hit | magenta pure emitter",(.82,.001,.18),1.25),
            emitter_surface("Hit | amber pure emitter",(.95,.16,.001),1.2),
            emitter_surface("Hit | green pure emitter",(.001,.72,.04),1.2)]
rim_mats = [emitter_surface("Hit rim | cyan emission",(.001,.18,.95),1.35),
            emitter_surface("Hit rim | magenta emission",(.82,.001,.18),1.35),
            emitter_surface("Hit rim | amber emission",(.95,.15,.001),1.3),
            emitter_surface("Hit rim | green emission",(.001,.72,.04),1.3)]
star_mats = [material("Inlay | sapphire", (.02, .22, .7), .65, .24, (.01, .11, .7), .35),
             material("Inlay | magenta", (.57, .025, .27), .65, .24, (.5, .01, .22), .3),
             gold_light,
             material("Inlay | emerald", (.015, .45, .18), .65, .24, (.01, .3, .08), .3)]
star_facets = [material("Inlay facet | cyan highlight",(.04,.36,.95),.58,.24,(.01,.18,.75),.35),
               material("Inlay facet | magenta highlight",(.78,.06,.36),.58,.24,(.55,.01,.25),.3),
               material("Inlay facet | amber highlight",(.98,.57,.17),.58,.24,(.65,.22,.03),.3),
               material("Inlay facet | green highlight",(.04,.62,.28),.58,.24,(.01,.35,.08),.3)]

# Normalized provisional authoring units: X=12, Y=5.4, Z~0.55.
bevel_box("Platform | continuous sculpted chassis", (0, 0, 0), (12, 5.4, .60), base, .20, 5)
bevel_box("Underside | inset shadow keel", (0, 0, -.34), (10.9, 4.45, .22), base, .10, 3)
centers = [-4.5, -1.5, 1.5, 4.5]
lane_w = 2.75
for i, x in enumerate(centers):
    panel_with_recess("Inset lane %d | mineral glass and recessed hit well" % (i + 1),
                      x,.25,lane_w/2,2.20,.44,.24,.84,.28,.315,panel_mats[i],well_dark)
    ring_frame("Lane %d | substantial continuous profiled border" % (i+1),
               chamfered_rect(x,.25,1.48,2.32,.14), chamfered_rect(x,.25,1.34,2.18,.10),
               .34,.49,gold,.035)
    for side in (-1, 1):
        px = x + side * (lane_w / 2 - .045)
        curve("Lane %d | fine luminous inner seam %d" % (i + 1, side), [(px, -1.82, .47), (px, 2.28, .47)], lane_edge[i], .018)
    ring_frame("Lane %d | sculpted front apron surround" % (i+1),
               chamfered_rect(x,-2.28,1.42,.31,.16), chamfered_rect(x,-2.28,1.30,.20,.11),
               .34,.48,gold,.03)
    star("Lane %d | elongated faceted star inlay" % (i + 1), x, .05, .51, .35, .085, .075,
         star_mats[i], facet_mat=star_facets[i], elongation=1.35)
    star("Lane %d | apron diamond" % (i + 1), x, -1.80, .52, .14, .045, .055,
         gold_light, facet_mat=gold, points=4, rotation=math.pi/4, elongation=1.4)

    # Machined well bezel surrounds an actual recessed floor; illuminated ring and lens stay below its lip.
    ring_frame("Hit bar %d | flush machined gold bezel" % (i+1),
               chamfered_rect(x,1.45,.84,.28,.07), chamfered_rect(x,1.45,.75,.19,.05),
               .37,.43,gold_light,.015)
    ring_frame("Hit bar %d | fine colored luminous perimeter" % (i+1),
               chamfered_rect(x,1.45,.745,.185,.05), chamfered_rect(x,1.45,.715,.155,.04),
               .405,.425,rim_mats[i],.005)
    bevel_box("Hit bar %d | recessed luminous center" % (i+1), (x,1.45,.365), (1.42,.30,.09), bar_mats[i], .045, 4)

ring_frame("Perimeter | broad continuous profiled gold frame",
           chamfered_rect(0,0,5.92,2.61,.30), chamfered_rect(0,0,5.74,2.43,.24),
           .20,.36,gold,.045)
for sx in (-1, 1):
    for sy in (-1,1):
        sculpted_corner_cap("Corner forging | %s %s" % (sx,sy),sx,sy,gold_light)

# Local crest rebuild: slender crown and concave flanks reach the actual front lip.
crest_outer=crest_loop(inner=False)
crest_inner=crest_loop(inner=True)
# Remove only the two center apron surrounds' portions inside the shield footprint.
# This closes the exposed rail ends cleanly against the new concave crest sides;
# retaining the full old rings would make tiny gold protrusions through the shield.
cutter=solid_crest_shield("TEMP shield footprint trim cutter",crest_outer,-1.0,1.5,crest_backing)
for modifier in list(cutter.modifiers): cutter.modifiers.remove(modifier)
for lane in (2,3):
    obj=bpy.data.objects["Lane %d | sculpted front apron surround" % lane]
    cut=obj.modifiers.new("Local shield apron junction cut","BOOLEAN")
    cut.operation="DIFFERENCE"; cut.solver="EXACT"; cut.object=cutter
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.modifier_move_up(modifier=cut.name)
    bpy.ops.object.modifier_move_up(modifier=cut.name)
    bpy.ops.object.modifier_apply(modifier=cut.name)
bpy.data.objects.remove(cutter,do_unlink=True)
solid_crest_shield("Crest | solid shaped midnight shield backing",crest_inner,.345,.510,crest_backing)
crest_edging(crest_outer,crest_inner,gold_light)
# Thin tapered shoulder transitions terminate inside the existing front-apron rail.
for side in (-1,1):
    wing=[(1.015,-1.95),(1.30,-1.976),(2.88,-1.976),(2.88,-2.08),
          (1.55,-2.08),(1.04,-2.035)]
    solid_crest_shield("Crest junction | %s tapered apron gold shoulder" % side,
                       [(side*x,y) for x,y in wing],.365,.500,gold_light)
star("Crest | raised elongated faceted compass star",0,-1.94,.605,.57,.12,.18,gold_light,
     facet_mat=gold,elongation=1.10,vertical_scale=1.20)

curve("Timing | thin transverse light rule", [(-5.70,1.93,.56),(5.70,1.93,.56)], gold_light, .018)

groundmat = material("Studio | charcoal violet", (.035,.026,.055), .18, .32)
bevel_box("Studio ground (render only)", (0,0,-.80), (200,200,.15), groundmat, .02, 1)
world = bpy.data.worlds.new("Twilight neutral studio")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (.035,.032,.065,1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = .32

def area(name, loc, power, color, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    point_camera(obj, (0,0,0))
    return obj

area("Studio key | soft warmbox", (-4,-4,8), 330, (1.0,.73,.45), 7)
area("Studio fill | cool sky", (4,1,7), 285, (.28,.48,1.0), 6)
area("Studio rim | violet", (0,5,5), 235, (.55,.22,1.0), 5)
area("Studio front strip", (1,-6,4), 150, (.35,.72,1.0), 4)
cam_data = bpy.data.cameras.new("Concept comparison perspective")
cam = bpy.data.objects.new("Camera | concept v4 comparison", cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (0,-16.0,12.5)
point_camera(cam, (0,0,.15))
cam_data.lens = 50
cam_data.sensor_width = 36
scene = bpy.context.scene
scene.camera = cam
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 1200
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.view_settings.view_transform = "AgX"
scene.render.filepath = str(OUTPUT_DIR / "previews" / "concept-comparison.png")
scene.camera.data.dof.use_dof = False
scene.render.use_file_extension = True
scene.use_nodes = True
compositor = bpy.data.node_groups.new("Platform | restrained emitter bloom", "CompositorNodeTree")
scene.compositing_node_group = compositor
layers = compositor.nodes.new("CompositorNodeRLayers")
glow = compositor.nodes.new("CompositorNodeGlare")
glow.inputs["Type"].default_value = "Fog Glow"
glow.inputs["Quality"].default_value = "Medium"
glow.inputs["Threshold"].default_value = 0.1
glow.inputs["Size"].default_value = 0.8
glow.inputs["Strength"].default_value = 0.95
output = compositor.nodes.new("NodeGroupOutput")
compositor.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
compositor.links.new(layers.outputs["Image"], glow.inputs["Image"])
compositor.links.new(glow.outputs["Image"], output.inputs["Image"])
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print("SAVED", OUT)
