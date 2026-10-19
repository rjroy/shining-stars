"""Read-only Audience/Twilight renders from the saved comparison camera."""

import argparse
import subprocess
from pathlib import Path
import sys

sys.dont_write_bytecode = True
import bpy

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from package_checks import load_manifest, sha256_file, verify_manifest  # noqa: E402


def encode_preview(png):
    webp = png.with_suffix(".webp")
    partial = png.with_name(png.stem + ".partial.webp")
    if webp.exists():
        raise FileExistsError("Refusing existing preview output: " + str(webp))
    try:
        subprocess.run(["cwebp", "-quiet", "-q", "80", "-m", "6", "-alpha_q", "100",
                        str(png), "-o", str(partial)], check=True)
        if not partial.is_file() or partial.stat().st_size == 0:
            raise RuntimeError("WebP preview missing or empty: " + str(partial))
        partial.replace(webp)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    png.unlink()
    return webp


def arguments():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path,
                        help="Existing scratch directory outside this authoring package")
    parser.add_argument("--mode", choices=("audience", "twilight", "both"), default="both")
    return parser.parse_args(raw)


args = arguments()
manifest = load_manifest(ROOT)
errors = verify_manifest(ROOT, manifest)
if errors:
    raise RuntimeError("Package integrity errors: " + "; ".join(errors))

source = (ROOT / manifest["model_path"]).resolve()
if Path(bpy.data.filepath).resolve() != source:
    raise RuntimeError("Blender did not open the packaged city.blend")
initial_sha = sha256_file(source)
if initial_sha != manifest["approved_model_sha256"]:
    raise RuntimeError("Opened scene does not match the approved source checksum")

output_dir = args.output_dir.expanduser().resolve()
if not output_dir.is_dir():
    raise ValueError("Output directory must already exist: " + str(output_dir))
if output_dir == ROOT or ROOT in output_dir.parents:
    raise ValueError("Render output must be outside the authoring package")
modes = ("audience", "twilight") if args.mode == "both" else (args.mode,)
outputs = {mode: output_dir / f"city-{mode}.webp" for mode in modes}
render_paths = [path.with_suffix(".png") for path in outputs.values()]
existing = [str(path) for path in (*outputs.values(), *render_paths) if path.exists()]
if existing:
    raise FileExistsError("Refusing to overwrite render output(s): " + ", ".join(existing))

scene = bpy.context.scene
camera = bpy.data.objects.get("Camera.Reference")
if camera is None or camera.type != "CAMERA":
    raise RuntimeError("Missing saved comparison camera Camera.Reference")
lighting = {"audience": "Audience", "twilight": "Twilight"}
for mode, label in lighting.items():
    if bpy.data.worlds.get(label + ".world") is None:
        raise RuntimeError("Missing saved lighting world " + label + ".world")
    if not any(collection.name == "08 | Lighting." + label
               for collection in bpy.data.collections):
        raise RuntimeError("Missing saved lighting collection for " + label)
if scene.render.engine != "CYCLES":
    raise RuntimeError("Expected the saved Cycles renderer")

scene.camera = camera
scene.render.resolution_x = 1792
scene.render.resolution_y = 1008
scene.render.resolution_percentage = 100
scene.cycles.samples = 24
scene.render.image_settings.file_format = "PNG"
scene.render.use_file_extension = True

records = []
for mode in modes:
    label = lighting[mode]
    for collection in bpy.data.collections:
        if collection.name.startswith("08 | Lighting."):
            collection.hide_render = collection.name != "08 | Lighting." + label
        if collection.name in ("08 | Low ravine atmosphere", "08 | Local inhabited light anchors"):
            collection.hide_render = False
    scene.world = bpy.data.worlds[label + ".world"]
    png = outputs[mode].with_suffix(".png")
    scene.render.filepath = str(png)
    print(f"RENDER_ATTEMPT mode={label} source_sha256={initial_sha} output={outputs[mode]}", flush=True)
    bpy.ops.render.render(write_still=True)
    if not png.is_file() or png.stat().st_size == 0:
        raise RuntimeError("Render output missing or empty: " + str(png))
    path = encode_preview(png)
    records.append({"mode": label, "path": str(path), "bytes": path.stat().st_size,
                    "camera": scene.camera.name, "world": scene.world.name,
                    "resolution": [scene.render.resolution_x, scene.render.resolution_y],
                    "cycles_samples": scene.cycles.samples, "source_sha256": initial_sha})

if sha256_file(source) != initial_sha:
    raise RuntimeError("Source .blend changed during read-only preview")
print("BRIGHTVALE_PREVIEW_OUTPUTS " + __import__("json").dumps(records, sort_keys=True), flush=True)
print("SOURCE_UNCHANGED " + initial_sha, flush=True)
