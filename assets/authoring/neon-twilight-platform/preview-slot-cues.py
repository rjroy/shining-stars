"""Read-only ixp comparison render: original saved camera/light/material setup."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy

ROOT = Path(__file__).resolve().parent
GENERATED = ROOT / "generated"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output-dir", type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
source = Path(bpy.data.filepath).resolve()
out = args.output_dir.resolve()
assert source in {ROOT / "platform.blend", ROOT / "platform-slot-cues.blend"} or source.is_relative_to(GENERATED)
assert out.is_relative_to(GENERATED) and out != GENERATED
out.mkdir(parents=True, exist_ok=False)
before = hashlib.sha256(source.read_bytes()).hexdigest()
scene = bpy.context.scene
# Only sampling/output path change in memory; no source save, reframing, material,
# lighting, exposure or compositor edits. Same deterministic settings for both.
scene.cycles.samples = 16
scene.render.filepath = str(out / "comparison.png")
print("COMPARISON RENDER ATTEMPT", source, scene.render.filepath, flush=True)
bpy.ops.render.render(write_still=True)
assert (out / "comparison.png").stat().st_size > 0
assert hashlib.sha256(source.read_bytes()).hexdigest() == before
with (out / "render.json").open("x") as f:
    json.dump({"source": str(source.relative_to(ROOT)), "sha256_unchanged": before,
               "engine": scene.render.engine, "samples": scene.cycles.samples,
               "resolution": [scene.render.resolution_x, scene.render.resolution_y],
               "camera": scene.camera.name, "location": list(scene.camera.location),
               "lens": scene.camera.data.lens, "view_transform": scene.view_settings.view_transform,
               "lighting_materials_compositor_unchanged": True, "source_saved": False,
               "purpose": "Geometry/material comparison only; not runtime evidence"}, f, indent=2)
print("COMPARISON RENDER SUCCESS; SOURCE UNCHANGED", before, flush=True)
