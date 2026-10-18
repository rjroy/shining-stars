"""Read-only package and scene validation; run inside Blender 5.2.1 LTS."""

import json
import math
from pathlib import Path
import sys

sys.dont_write_bytecode = True
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from package_checks import load_manifest, sha256_file, verify_manifest  # noqa: E402


def fail(message):
    raise RuntimeError(message)


manifest = load_manifest(ROOT)
errors = verify_manifest(ROOT, manifest)
if errors:
    fail("Package integrity errors: " + "; ".join(errors))

expected_path = (ROOT / manifest["model_path"]).resolve()
opened_path = Path(bpy.data.filepath).resolve()
if opened_path != expected_path:
    fail(f"Opened scene is not the packaged master: {opened_path}")
if sha256_file(opened_path) != manifest["approved_model_sha256"]:
    fail("Opened model does not match the approved source hash")

collections = {collection.name for collection in bpy.data.collections}
missing_families = [f"{family:02} |" for family in range(1, 9)
                    if not any(name.startswith(f"{family:02} |") for name in collections)]
if missing_families:
    fail("Missing city family collections: " + ", ".join(missing_families))

family_prefixes = tuple(f"{family:02} |" for family in range(1, 8))
meshes = [obj for obj in bpy.data.objects
          if obj.type == "MESH" and any(c.name.startswith(family_prefixes)
                                         for c in obj.users_collection)]
points = []
nonfinite = []
for obj in meshes:
    if any(not math.isfinite(value) for row in obj.matrix_world for value in row):
        nonfinite.append(obj.name + " (transform)")
    for vertex in obj.data.vertices:
        if any(not math.isfinite(value) for value in vertex.co):
            nonfinite.append(obj.name + " (vertex)")
            break
    points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
if nonfinite:
    fail("Non-finite mesh data: " + ", ".join(nonfinite[:20]))
if not points:
    fail("No mesh geometry found in city families 01-07")
if any(not math.isfinite(value) for point in points for value in point):
    fail("Non-finite world-space mesh bounds")

bounds = [[min(getattr(point, axis) for point in points) for axis in "xyz"],
          [max(getattr(point, axis) for point in points) for axis in "xyz"]]
expected_bounds = [[-105.0257339477539, -52.16445541381836, -13.647832870483398],
                   [103.47748565673828, 113.02069091796875, 97.00050354003906]]
if len(meshes) != 5368:
    fail(f"Unexpected family 01-07 mesh count: {len(meshes)} (expected 5368)")
if any(abs(actual - expected) > 1e-4
       for actual_row, expected_row in zip(bounds, expected_bounds)
       for actual, expected in zip(actual_row, expected_row)):
    fail(f"Unexpected family 01-07 bounds: {bounds}")

external = []
for library in bpy.data.libraries:
    external.append("library:" + library.filepath)
for image in bpy.data.images:
    if image.name in {"Render Result", "Viewer Node"} or not image.filepath:
        continue
    if image.packed_file:
        continue
    path = Path(bpy.path.abspath(image.filepath))
    if not path.is_file():
        external.append(f"image:{image.name}:{image.filepath}")
for font in bpy.data.fonts:
    if not font.filepath or font.filepath.startswith("<") or font.packed_file:
        continue
    path = Path(bpy.path.abspath(font.filepath))
    if not path.is_file():
        external.append(f"font:{font.name}:{font.filepath}")
if external:
    fail("Unresolved external Blender dependencies: " + ", ".join(external))

result = {
    "status": "passed",
    "blender_version": bpy.app.version_string,
    "opened_path": str(opened_path),
    "sha256": sha256_file(opened_path),
    "total_objects": len(bpy.data.objects),
    "family_01_07_meshes": len(meshes),
    "family_01_07_bounds_BU": bounds,
    "collections": sorted(collections),
    "unresolved_external_libraries_images_fonts": external,
    "scope": "Package hash/size, family presence, finite mesh data, recorded family bounds, and common external Blender dependencies only; no artistic, exhaustive geometry, runtime, or production certification.",
}
print("BRIGHTVALE_AUTHORING_VALIDATION " + json.dumps(result, sort_keys=True), flush=True)
