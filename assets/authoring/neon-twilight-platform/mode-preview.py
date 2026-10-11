"""Read-only Audience/Twilight presentation study of the approved platform.

Loads the saved source, reuses its exact comparison camera and geometry, changes
only studio lights/world/floor tint in memory, and never saves the .blend.
Run with Blender's --background source.blend --python this_script --
--output-dir /tmp/opencode/<unique-dir>.
"""
import bpy
import hashlib
import json
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "platform.blend"
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) != 2 or args[0] != "--output-dir":
    raise ValueError("Pass --output-dir /tmp/opencode/<new-unique-directory> after --")
OUTPUT = Path(args[1]).expanduser().resolve()
SCRATCH_ROOT = Path("/tmp/opencode").resolve()
if not OUTPUT.is_relative_to(SCRATCH_ROOT) or OUTPUT == SCRATCH_ROOT:
    raise ValueError("Output must be a new task-specific directory under /tmp/opencode")
OUTPUT.mkdir(parents=True, exist_ok=False)

if Path(bpy.data.filepath).resolve() != SOURCE:
    raise ValueError(f"Expected exact approved source {SOURCE}, got {bpy.data.filepath}")
source_hash_before = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
scene = bpy.context.scene
camera = scene.camera
if camera is None or camera.name != "Camera | concept v4 comparison":
    raise ValueError("Saved comparison camera is missing or unexpected; refusing substitute")
if camera.data.type != "PERSP":
    raise ValueError(f"Expected saved perspective comparison camera, got {camera.data.type}")

expected_lights = {
    "Studio key | soft warmbox",
    "Studio fill | cool sky",
    "Studio rim | violet",
    "Studio front strip",
}
lights = {obj.name: obj for obj in scene.objects if obj.type == "LIGHT"}
if set(lights) != expected_lights:
    raise ValueError(f"Unexpected saved light rig: {sorted(lights)}")
world = scene.world
if world is None or not world.use_nodes:
    raise ValueError("Expected the saved node-based studio world")
background = world.node_tree.nodes.get("Background")
if background is None:
    raise ValueError("Saved world Background node is missing")
ground = bpy.data.materials.get("Studio | charcoal violet")
if ground is None or not ground.use_nodes:
    raise ValueError("Saved studio ground material is missing or not node-based")
ground_bsdf = ground.node_tree.nodes.get("Principled BSDF")
if ground_bsdf is None:
    raise ValueError("Saved studio ground Principled BSDF is missing")

settings = {
    "Audience": {
        "world": ((0.10, 0.055, 0.022, 1.0), 0.32),
        "ground": (0.050, 0.030, 0.018, 1.0),
        "lights": {
            "Studio key | soft warmbox": (330.0, (1.00, 0.72, 0.43)),
            "Studio fill | cool sky": (225.0, (1.00, 0.78, 0.54)),
            "Studio rim | violet": (180.0, (1.00, 0.48, 0.22)),
            "Studio front strip": (150.0, (1.00, 0.86, 0.68)),
        },
    },
    "Twilight": {
        "world": ((0.010, 0.012, 0.050, 1.0), 0.28),
        "ground": (0.012, 0.016, 0.050, 1.0),
        "lights": {
            "Studio key | soft warmbox": (300.0, (0.58, 0.63, 1.00)),
            "Studio fill | cool sky": (260.0, (0.32, 0.42, 1.00)),
            "Studio rim | violet": (255.0, (0.62, 0.30, 1.00)),
            "Studio front strip": (135.0, (0.48, 0.58, 1.00)),
        },
    },
}

original_material_names = sorted({
    slot.material.name
    for obj in scene.objects
    for slot in obj.material_slots
    if slot.material is not None
})
model_points = [
    obj.matrix_world @ Vector(corner)
    for obj in scene.objects
    if obj.type in {"MESH", "CURVE"} and not obj.name.startswith("Studio ground")
    for corner in obj.bound_box
]
if not model_points:
    raise ValueError("No platform geometry found in saved source")
bounds_min = [min(p[i] for p in model_points) for i in range(3)]
bounds_max = [max(p[i] for p in model_points) for i in range(3)]

# Preserve source renderer, camera, composition, exposure/color management and
# compositor. Only render output settings and presentation lights/tints vary.
render_setup = {
    "engine": scene.render.engine,
    "samples": scene.cycles.samples if scene.render.engine == "CYCLES" else None,
    "resolution": [scene.render.resolution_x, scene.render.resolution_y],
    "percentage": scene.render.resolution_percentage,
    "view_transform": scene.view_settings.view_transform,
    "look": scene.view_settings.look,
    "exposure": scene.view_settings.exposure,
    "camera": camera.name,
    "projection": camera.data.type,
    "lens_mm": camera.data.lens,
    "camera_location": list(camera.location),
    "camera_rotation": list(camera.rotation_euler),
    "camera_sensor_width_mm": camera.data.sensor_width,
    "compositor_unchanged": scene.use_nodes,
}
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.use_file_extension = True

for mode, config in settings.items():
    background.inputs["Color"].default_value = config["world"][0]
    background.inputs["Strength"].default_value = config["world"][1]
    ground.diffuse_color = config["ground"]
    ground_bsdf.inputs["Base Color"].default_value = config["ground"]
    for name, (energy, color) in config["lights"].items():
        lights[name].data.energy = energy
        lights[name].data.color = color
    destination = OUTPUT / f"platform-{mode.lower()}.png"
    scene.render.filepath = str(destination)
    print("MODE_SETUP", json.dumps({"mode": mode, "world": config["world"],
          "ground": config["ground"], "lights": config["lights"],
          "output": str(destination)}), flush=True)
    bpy.ops.render.render(write_still=True)
    if not destination.is_file() or destination.stat().st_size == 0:
        raise RuntimeError(f"Missing or empty render: {destination}")

source_hash_after = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
if source_hash_before != source_hash_after:
    raise RuntimeError("Approved source checksum changed during render")
manifest = {
    "source": str(SOURCE),
    "source_sha256_before": source_hash_before,
    "source_sha256_after": source_hash_after,
    "source_unchanged": True,
    "render_setup": render_setup,
    "geometry": {
        "object_count": len(scene.objects),
        "mesh_count": sum(obj.type == "MESH" for obj in scene.objects),
        "bounds_min_excluding_studio_ground": bounds_min,
        "bounds_max_excluding_studio_ground": bounds_max,
        "dimensions_excluding_studio_ground": [bounds_max[i] - bounds_min[i] for i in range(3)],
    },
    "material_slots": original_material_names,
    "presentation_changes_in_memory_only": [
        "studio light colors and energies",
        "world background color and strength",
        "studio ground base color",
        "PNG output settings",
    ],
    "model_material_nodes_geometry_camera_compositor_saved_source": "unchanged",
    "modes": settings,
    "runtime_three_js_fidelity": "not validated",
}
(OUTPUT / "mode-preview-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("MODE_PREVIEW_PASS", json.dumps({"source_sha256": source_hash_after,
      "outputs": [str(OUTPUT / "platform-audience.png"), str(OUTPUT / "platform-twilight.png")],
      "camera": render_setup, "geometry": manifest["geometry"],
      "material_slots": original_material_names}, sort_keys=True), flush=True)
