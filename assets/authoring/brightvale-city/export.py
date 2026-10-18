import bpy
import sys

args = sys.argv[sys.argv.index('--') + 1:]
output = args[0]
bpy.ops.export_scene.gltf(
    filepath=output,
    export_format='GLB',
    export_image_format='NONE',
    export_materials='EXPORT',
    export_normals=True,
    export_texcoords=True,
    export_attributes=False,
    export_extras=True,
    export_yup=True,
    export_apply=False,
    export_shared_accessors=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
    export_unused_images=False,
    export_unused_textures=False,
    export_meshopt_compression_enable=False,
    export_original_specular=True,
)
