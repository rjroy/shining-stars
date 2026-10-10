"""Read-only structure/dependency validation and exact approved-model equivalence."""
import bpy, bmesh, json, hashlib, argparse, sys
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parent
GENERATED=ROOT/"generated"
parser=argparse.ArgumentParser(description="Validate against the exact preserved approved v8.3 source")
parser.add_argument("--report",type=Path,default=GENERATED/"structure.json")
args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
NEW=str(Path(bpy.data.filepath).resolve())
OLD=str(ROOT/"platform.blend")
OUT=args.report.resolve()
if Path(NEW)!=Path(OLD) and not Path(NEW).is_relative_to(GENERATED):
    raise ValueError("Load the approved source or a rebuilt blend within generated/")
if not OUT.is_relative_to(GENERATED) or OUT==GENERATED:
    raise ValueError("Validation report must be within this asset's generated/ directory")
if OUT.exists():
    raise FileExistsError("Do not overwrite an existing validation report")
OUT.parent.mkdir(parents=True,exist_ok=True)
APPROVED_SHA256="ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af"
assert hashlib.sha256(Path(OLD).read_bytes()).hexdigest()==APPROVED_SHA256, "Approved source bytes changed"

def dependencies():
    # Render output filepath is NOT a linked asset. The unchanged approved file
    # retains its historical output path; the relocatable renderer overrides it.
    result={"linked_libraries":[lib.filepath for lib in bpy.data.libraries],
            "unpacked_external_paths":list(bpy.utils.blend_paths(absolute=True,packed=False,local=True)),
            "images":[{"name":im.name,"source":im.source,"filepath":im.filepath,
                       "packed":bool(im.packed_file)} for im in bpy.data.images],
            "fonts":[{"name":font.name,"filepath":font.filepath} for font in bpy.data.fonts],
            "movie_clips":[clip.filepath for clip in bpy.data.movieclips],
            "sounds":[sound.filepath for sound in bpy.data.sounds]}
    assert not result["linked_libraries"], "Unexpected linked asset library"
    assert not result["unpacked_external_paths"], "Unexpected external file dependency"
    assert not result["movie_clips"] and not result["sounds"], "Unexpected media dependency"
    assert all(im["source"] not in {"FILE","MOVIE","SEQUENCE"} or im["packed"] for im in result["images"])
    return result

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(",",":"),default=str).encode()).hexdigest()

def geometry(me):
    return {"vertices":[list(v.co) for v in me.vertices],
            "edges":[list(e.vertices) for e in me.edges],
            "polygons":[[list(p.vertices),p.material_index,p.use_smooth] for p in me.polygons]}

def snapshot():
    result={}
    deps=bpy.context.evaluated_depsgraph_get()
    for o in bpy.context.scene.objects:
        data={"type":o.type,"matrix":[list(r) for r in o.matrix_world],
              "materials":[s.material.name if s.material else None for s in o.material_slots]}
        if o.type in {"MESH","CURVE"}:
            ev=o.evaluated_get(deps); me=ev.to_mesh()
            data["evaluated_geometry"]=geometry(me)
            ev.to_mesh_clear()
        elif o.type=="CAMERA":
            data["camera"]=[o.data.type,o.data.lens,o.data.sensor_width]
        elif o.type=="LIGHT":
            data["light"]=[o.data.type,o.data.energy,list(o.data.color),o.data.size]
        result[o.name]=digest(data)
    return result

def node_snapshot(tree):
    return {"nodes":[[n.name,n.bl_idname,[(i.name,list(i.default_value) if hasattr(i.default_value,"__len__") and not isinstance(i.default_value,str) else i.default_value)
                    for i in n.inputs if hasattr(i,"default_value")]] for n in tree.nodes],
            "links":[[l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name] for l in tree.links]}

def presentation():
    scene=bpy.context.scene
    return {"materials":{m.name:node_snapshot(m.node_tree) for m in bpy.data.materials if m.node_tree},
            "world":node_snapshot(scene.world.node_tree),
            "compositor":node_snapshot(scene.compositing_node_group),
            "view":[scene.view_settings.view_transform,scene.view_settings.look,scene.view_settings.exposure,scene.view_settings.gamma],
            "render":[scene.render.engine,scene.cycles.samples,scene.cycles.use_denoising,scene.render.resolution_x,scene.render.resolution_y,scene.render.resolution_percentage]}

assert bpy.data.filepath==NEW, "Validator must start on the exact new saved source"
current=snapshot(); settings=presentation(); dependency_report=dependencies()
bpy.ops.wm.open_mainfile(filepath=OLD)
old=snapshot(); old_settings=presentation(); approved_dependencies=dependencies()
assert old==current, "Regenerated geometry, transforms, material slots, cameras or lights differ from the approved model"
assert old_settings==settings, "Existing presentation settings changed"
bpy.ops.wm.open_mainfile(filepath=NEW)
scene=bpy.context.scene
mesh_report=[]
deps=bpy.context.evaluated_depsgraph_get()
for o in scene.objects:
    if o.type!="MESH": continue
    for evaluated in (False,True):
        ev=o.evaluated_get(deps) if evaluated else o
        me=ev.to_mesh() if evaluated else o.data
        bm=bmesh.new(); bm.from_mesh(me); bm.normal_update()
        bad=sum(not e.is_manifold for e in bm.edges)
        volume=bm.calc_volume(signed=True)
        degenerate=sum(f.calc_area()<1e-12 for f in bm.faces)
        mesh_report.append({"object":o.name,"evaluated":evaluated,"nonmanifold_edges":bad,
                            "signed_volume":volume,"zero_area_faces":degenerate,
                            "verts":len(bm.verts),"faces":len(bm.faces)})
        assert not bad, (o.name,evaluated,"nonmanifold",bad)
        assert volume>0, (o.name,evaluated,"negative or zero signed volume",volume)
        assert not degenerate, (o.name,evaluated,"zero area faces",degenerate)
        bm.free()
        if evaluated: ev.to_mesh_clear()
names=[o.name for o in scene.objects]
assert sum(n.startswith("Inset lane") for n in names)==4
assert sum(n.startswith("Hit bar") and "recessed luminous center" in n for n in names)==4
edge=bpy.data.objects["Crest | narrow arched concave shield gold edging"]
co=[v.co for v in edge.data.vertices]
assert max(v.y for v in co)>-1.42 and min(v.y for v in co)<-2.75
assert max(v.x for v in co)-min(v.x for v in co)<2.3
shield=bpy.data.objects["Crest | solid shaped midnight shield backing"]
coverage=[]
for y in (-1.5,-1.75,-2.0,-2.25,-2.45):
    hit,loc,normal,index=shield.ray_cast(Vector((0,y,2)),Vector((0,0,-1)))
    assert hit and loc.z>.49, ("Center seam not covered",y,hit,list(loc))
    coverage.append([y,list(loc),list(normal)])
corners=[o.matrix_world@Vector(c) for o in scene.objects if o.type in {"MESH","CURVE"} and not o.name.startswith("Studio ground") for c in o.bound_box]
lo=[min(v[i] for v in corners) for i in range(3)]
hi=[max(v[i] for v in corners) for i in range(3)]
assert hi[0]-lo[0]<12.1 and hi[1]-lo[1]<5.6 and hi[2]-lo[2]<1.5
result={"approved_source":OLD,"validated_source":NEW,"approved_sha256":APPROVED_SHA256,
        "all_objects_exact_match":len(current),"object_hashes":current,
        "presentation_exact_match":True,"objects":len(scene.objects),
        "external_dependency_check":dependency_report,"approved_external_dependency_check":approved_dependencies,
        "bounds_min":lo,"bounds_max":hi,"dimensions":[hi[i]-lo[i] for i in range(3)],
        "crest_center_seam_coverage_rays":coverage,"mesh_checks":mesh_report,
        "all_pairs_intersections_tested":False}
with open(OUT,"w") as f: json.dump(result,f,indent=2,sort_keys=True)
print("VALIDATION_PASS",json.dumps({k:v for k,v in result.items() if k not in {"object_hashes","mesh_checks","crest_center_seam_coverage_rays"}},sort_keys=True))
