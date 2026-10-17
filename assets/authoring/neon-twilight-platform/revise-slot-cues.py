"""Candidate ixp: remove the false timing curve and tint only four slot rings.

Reads the exact approved v8.3 source; never runs or edits build.py and never
exports. A relocated package containing platform.blend is sufficient to rebuild.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy

ROOT = Path(__file__).resolve().parent
GENERATED = ROOT / "generated"
SOURCE = ROOT / "platform.blend"
SOURCE_SHA = "ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af"
FALSE_CUE = "Timing | thin transverse light rule"
BORDER = "Lane %d | substantial continuous profiled border"
COLORS = ("cyan", "magenta", "amber", "green")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def revise():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=GENERATED / "ixp-candidate")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    out = args.output_dir.resolve()
    if not out.is_relative_to(GENERATED) or out == GENERATED:
        raise ValueError("Candidate must use a new generated/ subdirectory")
    if out.exists():
        raise FileExistsError(out)
    assert sha(SOURCE) == SOURCE_SHA, "Approved source changed"
    print("CANDIDATE SOURCE READ ATTEMPT", SOURCE, flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    false_cue = bpy.data.objects[FALSE_CUE]
    # Independently distinguish the small-radius cross-lane rule from the broad
    # closed rear ring and from the four actual recessed hit targets.
    assert false_cue.type == "CURVE"
    points = [tuple(p.co)[:3] for p in false_cue.data.splines[0].points]
    assert all(abs(y - 1.93) < 1e-6 and abs(z - .56) < 1e-6 for x, y, z in points)
    assert abs(false_cue.data.bevel_depth - .018) < 1e-6
    assert len(points) == 2 and abs(points[0][0] + 5.7) < 1e-6 and abs(points[1][0] - 5.7) < 1e-6
    print("FALSE CUE REMOVE ATTEMPT", FALSE_CUE, points, flush=True)
    bpy.data.objects.remove(false_cue, do_unlink=True)
    gold = bpy.data.materials["Gold | brushed warm alloy"]
    gold_rgb = gold.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value[:3]
    recipe = []
    for lane, color in enumerate(COLORS, 1):
        ring = bpy.data.objects[BORDER % lane]
        assert len(ring.data.materials) == 1 and ring.data.materials[0] == gold
        emitter = bpy.data.materials["Hit | %s pure emitter" % color]
        emit = next(n for n in emitter.node_tree.nodes if n.type == "EMISSION")
        lane_rgb = emit.inputs["Color"].default_value[:3]
        rgb = tuple(.75 * c + .25 * g for c, g in zip(lane_rgb, gold_rgb))
        tint = gold.copy()
        tint.name = "Slot border | %s 75 lane 25 gold" % color
        tint.diffuse_color = (*rgb, 1)
        tint.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*rgb, 1)
        ring.data.materials[0] = tint
        recipe.append({"object": ring.name, "material": tint.name, "linear_rgb": list(rgb),
                       "lane_rgb": list(lane_rgb), "gold_rgb": list(gold_rgb)})
    out.mkdir(parents=True, exist_ok=False)
    target = out / "platform.blend"
    print("CANDIDATE SAVE ATTEMPT", target, flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(target))
    assert sha(SOURCE) == SOURCE_SHA
    with (out / "revision.json").open("x") as f:
        json.dump({"status": "candidate, not approved or integrated", "blender": bpy.app.version_string,
                   "source_sha256": SOURCE_SHA, "removed_object": FALSE_CUE,
                   "removed_curve_points": points, "border_recipe": recipe,
                   "recipe": "Linear RGB: .75 authored Hit pure emitter color + .25 brushed gold base; retain gold metallic/roughness; no emission added",
                   "candidate_sha256": sha(target)}, f, indent=2)
    print("CANDIDATE SAVE SUCCESS", target, flush=True)


if __name__ == "__main__":
    revise()
