"""Reopen ixp candidate, check exact scope against approved source, optional rebuild."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys

import bmesh
import bpy

ROOT = Path(__file__).resolve().parent
GENERATED = ROOT / "generated"
SOURCE = ROOT / "platform.blend"
SOURCE_SHA = "ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af"
FALSE_CUE = "Timing | thin transverse light rule"
BORDERS = {"Lane %d | substantial continuous profiled border" % i for i in range(1, 5)}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def node_state(tree):
    return {"nodes": [[n.name, n.bl_idname, [[i.name, list(i.default_value)
              if hasattr(i.default_value, "__len__") and not isinstance(i.default_value, str)
              else i.default_value] for i in n.inputs if hasattr(i, "default_value")]]
              for n in tree.nodes],
            "links": [[l.from_node.name, l.from_socket.name, l.to_node.name, l.to_socket.name] for l in tree.links]}


def snapshot():
    graph = bpy.context.evaluated_depsgraph_get()
    objects, checks, coords = {}, [], []
    for o in bpy.context.scene.objects:
        row = {"type": o.type, "matrix": [list(r) for r in o.matrix_world],
               "materials": [m.name for m in o.data.materials] if o.type in {"MESH", "CURVE"} else []}
        if o.type in {"MESH", "CURVE"}:
            ev = o.evaluated_get(graph)
            me = ev.to_mesh()
            row["geometry"] = digest({"verts": [list(v.co) for v in me.vertices],
                "edges": [list(e.vertices) for e in me.edges],
                "faces": [[list(p.vertices), p.material_index, p.use_smooth] for p in me.polygons],
                "normals": [list(n.vector) for n in me.corner_normals]})
            if not o.name.startswith("Studio"):
                coords.extend(o.matrix_world @ v.co for v in me.vertices)
            if o.type == "MESH":
                bm = bmesh.new(); bm.from_mesh(me); bm.normal_update()
                checks.append({"object": o.name, "nonmanifold_edges": sum(not e.is_manifold for e in bm.edges),
                               "zero_area_faces": sum(f.calc_area() < 1e-12 for f in bm.faces),
                               "signed_volume": bm.calc_volume(signed=True)})
                bm.free()
            ev.to_mesh_clear()
        elif o.type == "CAMERA":
            row["data"] = [o.data.type, o.data.lens, o.data.sensor_width, o.data.clip_start,
                           o.data.clip_end, o.data.shift_x, o.data.shift_y, o.data.dof.use_dof]
        elif o.type == "LIGHT":
            row["data"] = [o.data.type, o.data.energy, list(o.data.color), o.data.size]
        objects[o.name] = row
    scene = bpy.context.scene
    return {"objects": objects, "materials": {m.name: {"diffuse": list(m.diffuse_color),
            "nodes": node_state(m.node_tree)} for m in bpy.data.materials if m.node_tree},
            "presentation": {"world": node_state(scene.world.node_tree),
                "compositor": node_state(scene.compositing_node_group), "camera": scene.camera.name,
                "view": [scene.view_settings.view_transform, scene.view_settings.look,
                         scene.view_settings.exposure, scene.view_settings.gamma],
                "render": [scene.render.engine, scene.cycles.samples, scene.cycles.use_denoising,
                           scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage]},
            "bounds": {"min": [min(v[i] for v in coords) for i in range(3)],
                       "max": [max(v[i] for v in coords) for i in range(3)]}, "mesh_checks": checks}


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--report", type=Path, required=True)
parser.add_argument("--compare", type=Path)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
candidate = Path(bpy.data.filepath).resolve()
report = args.report.resolve()
assert (candidate == ROOT / "platform-slot-cues.blend" or candidate.is_relative_to(GENERATED)) and candidate.is_file()
assert report.is_relative_to(GENERATED) and not report.exists()
assert sha(SOURCE) == SOURCE_SHA
before = sha(candidate)
current = snapshot()
assert not bpy.data.libraries and not list(bpy.utils.blend_paths(absolute=True, packed=False, local=True))
assert FALSE_CUE not in current["objects"]
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
old = snapshot()
assert old["objects"].keys() - current["objects"].keys() == {FALSE_CUE}
assert not current["objects"].keys() - old["objects"].keys()
protected = []
for name, row in current["objects"].items():
    expected = old["objects"][name]
    if name in BORDERS:
        assert {k: v for k, v in row.items() if k != "materials"} == {k: v for k, v in expected.items() if k != "materials"}
        assert len(row["materials"]) == 1 and row["materials"] != expected["materials"]
    else:
        assert row == expected, ("Protected object changed", name)
        protected.append(name)
for name, material in old["materials"].items():
    assert current["materials"][name] == material, ("Original material changed", name)
added = current["materials"].keys() - old["materials"].keys()
assert len(added) == 4 and all(n.startswith("Slot border |") for n in added)
assert current["presentation"] == old["presentation"]
assert current["bounds"] == old["bounds"]
assert current["mesh_checks"] == old["mesh_checks"], "Retained mesh topology/volume changed"
assert all(not c["nonmanifold_edges"] and not c["zero_area_faces"] and c["signed_volume"] > 0 for c in current["mesh_checks"])
gold_rgb = old["materials"]["Gold | brushed warm alloy"]["diffuse"][:3]
for lane, color in enumerate(("cyan", "magenta", "amber", "green"), 1):
    rgb = bpy.data.materials["Hit | %s pure emitter" % color].diffuse_color[:3]
    tint = current["materials"]["Slot border | %s 75 lane 25 gold" % color]
    assert max(abs(a - (.75 * c + .25 * g)) for a, c, g in zip(tint["diffuse"][:3], rgb, gold_rgb)) < 1e-7
    expected_tint = copy.deepcopy(old["materials"]["Gold | brushed warm alloy"])
    expected_tint["diffuse"] = tint["diffuse"]
    for node in expected_tint["nodes"]["nodes"]:
        if node[1] == "ShaderNodeBsdfPrincipled":
            for socket in node[2]:
                if socket[0] == "Base Color":
                    socket[1] = tint["diffuse"]
    assert tint == expected_tint, "Tint changed non-color gold properties or failed to set shader color"
reproduced = False
if args.compare:
    other = args.compare.resolve()
    assert other.is_relative_to(GENERATED) and other != candidate
    other_sha = sha(other)
    bpy.ops.wm.open_mainfile(filepath=str(other))
    assert snapshot() == current, "Independent candidate regeneration differs"
    assert sha(other) == other_sha
    reproduced = True
assert sha(SOURCE) == SOURCE_SHA and sha(candidate) == before
with report.open("x") as f:
    json.dump({"pass": True, "candidate": str(candidate.relative_to(ROOT)), "candidate_sha256": before,
               "approved_sha256_unchanged": SOURCE_SHA, "removed_only": FALSE_CUE,
               "protected_objects_exact": protected, "slot_ring_geometry_normals_transforms_exact": sorted(BORDERS),
               "all_original_materials_exact": len(old["materials"]), "added_materials": sorted(added),
               "camera_lights_world_compositor_render_exact": True, "bounds_unchanged": current["bounds"],
               "retained_mesh_checks_exact": current["mesh_checks"],
               "independent_regeneration_exact": reproduced, "all_pairs_intersections_tested": False}, f, indent=2)
print("SLOT CUE VALIDATION PASS", report, flush=True)
