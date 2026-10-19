"""Read-only ixp comparison render: original saved camera/light/material setup."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import subprocess

import bpy

def encode_preview(png):
    webp=png.with_suffix('.webp')
    partial=png.with_name(png.stem+'.partial.webp')
    if webp.exists(): raise FileExistsError('Refusing existing preview output: '+str(webp))
    try:
        subprocess.run(['cwebp','-quiet','-q','80','-m','6','-alpha_q','100',str(png),'-o',str(partial)],check=True)
        if not partial.is_file() or partial.stat().st_size==0: raise RuntimeError('WebP preview missing or empty: '+str(partial))
        partial.replace(webp)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    png.unlink()
    return webp

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
png = out / "comparison.png"
scene.render.filepath = str(png)
print("COMPARISON RENDER ATTEMPT", source, scene.render.filepath, flush=True)
bpy.ops.render.render(write_still=True)
assert png.stat().st_size > 0
preview = encode_preview(png)
assert hashlib.sha256(source.read_bytes()).hexdigest() == before
with (out / "render.json").open("x") as f:
    json.dump({"source": str(source.relative_to(ROOT)), "sha256_unchanged": before,
               "engine": scene.render.engine, "samples": scene.cycles.samples,
               "resolution": [scene.render.resolution_x, scene.render.resolution_y],
               "camera": scene.camera.name, "location": list(scene.camera.location),
               "lens": scene.camera.data.lens, "view_transform": scene.view_settings.view_transform,
               "lighting_materials_compositor_unchanged": True, "source_saved": False,
               "preview": preview.name,
               "purpose": "Geometry/material comparison only; not runtime evidence"}, f, indent=2)
print("COMPARISON RENDER SUCCESS; SOURCE UNCHANGED", before, flush=True)
