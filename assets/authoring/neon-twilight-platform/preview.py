"""Disposable read-only geometry evidence; no source save and no presentation tuning."""
import bpy, json, hashlib, argparse, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
GENERATED=ROOT/"generated"
parser=argparse.ArgumentParser(description="Read-only disposable geometry evidence")
parser.add_argument("--output-dir",type=Path,default=GENERATED/"previews")
args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
SOURCE=str(Path(bpy.data.filepath).resolve())
output=args.output_dir.resolve()
if Path(SOURCE)!=ROOT/"platform.blend" and not Path(SOURCE).is_relative_to(GENERATED):
    raise ValueError("Load the approved source or a rebuilt blend within generated/")
if not output.is_relative_to(GENERATED) or output==GENERATED:
    raise ValueError("Preview output must be a new subdirectory within generated/")
output.mkdir(parents=True,exist_ok=False)
OUT=str(output)
assert bpy.data.filepath==SOURCE
with open(SOURCE,"rb") as f: before=hashlib.sha256(f.read()).hexdigest()
scene=bpy.context.scene
# Match the v6/v7 comparison evidence's sample count and image size exactly.
scene.cycles.samples=24
scene.render.resolution_x,scene.render.resolution_y=1000,700
scene.render.image_settings.color_mode="RGBA"
views=[]
def render(name):
    scene.render.filepath=OUT+"/"+name+".png"
    views.append({"image":scene.render.filepath,"camera":scene.camera.name,
                  "position":list(scene.camera.location),"projection":scene.camera.data.type,
                  "lens":scene.camera.data.lens,"ortho_scale":scene.camera.data.ortho_scale,
                  "material_override":bool(bpy.context.view_layer.material_override)})
    bpy.ops.render.render(write_still=True)
    print("RENDERED",scene.render.filepath)

def camera(name,loc,target,scale):
    data=bpy.data.cameras.new(name); data.type="ORTHO"; data.ortho_scale=scale
    obj=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(obj)
    obj.location=loc; obj.rotation_euler=(Vector(target)-obj.location).to_track_quat("-Z","Y").to_euler()
    return obj

render("concept-comparison")
close=camera("TEMP crest comparison",(0,-5.8,4.4),(0,-1.82,.35),6.4)
scene.camera=close; render("detail-crest")
neutral=bpy.data.materials.new("TEMP neutral geometry diagnostic")
neutral.use_nodes=True
bs=neutral.node_tree.nodes.get("Principled BSDF")
bs.inputs["Base Color"].default_value=(.42,.42,.42,1)
bs.inputs["Metallic"].default_value=.05
bs.inputs["Roughness"].default_value=.7
bpy.context.view_layer.material_override=neutral
render("neutral-crest")
for name,loc,target,scale in [
    ("neutral-front",(0,-12,1.05),(0,-1.85,.25),6.4),
    ("neutral-side",(9,-2.6,1.6),(0,-1.9,.30),4.5),
    ("neutral-top",(0,-1.82,10),(0,-1.82,.30),6.4),
    ("neutral-full",(0,-16,12.5),(0,0,.15),13.5)]:
    scene.camera=camera("TEMP "+name,loc,target,scale)
    render(name)
with open(SOURCE,"rb") as f: after=hashlib.sha256(f.read()).hexdigest()
assert before==after, "Preview unexpectedly mutated source"
with open(OUT+"/render-manifest.json","w") as f:
    json.dump({"source":SOURCE,"sha256_before":before,"sha256_after":after,"engine":scene.render.engine,
               "samples":scene.cycles.samples,"resolution":[1000,700],"view_transform":scene.view_settings.view_transform,
               "views":views,"no_source_saved":True},f,indent=2)
print("READ_ONLY_RENDER_PASS",before,after)
