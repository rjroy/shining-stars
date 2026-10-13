"""Source-preserving endcap baseline export. Run with Blender, explicit NEW output.

Only production-package root files or /tmp/opencode scratch are writable.
No source save, reduction, material replacement, texture bake or compression.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
sys.dont_write_bytecode = True
import bpy
import io_scene_gltf2

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parents[1] / 'authoring/brightvale-platform-endcaps/endcaps.blend'
SOURCE_SHA = 'c49ae80c34350ddb7281c3192c4ed90921852f0386fa047a9196087cc13b4207'
COLLECTION = 'CANDIDATE | endcap pair | UNAPPROVED'  # Frozen label; geometry is approved.
NAMES = {'Endcap | '+side+' | sculpted body and gold edging' for side in ('left', 'right')}
MATERIALS = {'Endcap body | midnight-blue enamel', 'Endcap edging | warm brushed gold'}
SETTINGS = dict(export_format='GLB', use_selection=True, use_active_scene=True,
                export_apply=True, export_normals=True, export_yup=True,
                export_materials='EXPORT', export_animations=False,
                export_cameras=False, export_lights=False, export_extras=False,
                export_texcoords=False, export_tangents=False, export_vertex_color='NONE',
                export_attributes=False, export_gpu_instances=False,
                export_hierarchy_full_collections=False,
                export_draco_mesh_compression_enable=False,
                export_meshopt_compression_enable=False, export_image_format='NONE')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def new_output(path, suffix):
    p = Path(path).resolve()
    if p.parent != ROOT and not p.is_relative_to(Path('/tmp/opencode')):
        raise ValueError('Only production root files or authorized scratch allowed')
    if p.suffix != suffix or not p.parent.is_dir():
        raise ValueError('New '+suffix+' in an existing directory required')
    if p.exists(): raise FileExistsError(p)
    return p


def source_objects(source=SOURCE):
    source = Path(source).resolve()
    assert sha(source) == SOURCE_SHA, 'Approved source checksum mismatch'
    bpy.ops.wm.open_mainfile(filepath=str(source))
    pair = list(bpy.data.collections[COLLECTION].objects)
    assert {o.name for o in pair} == NAMES and len(pair) == 2
    assert all(o.type == 'MESH' and not o.parent and not o.animation_data for o in pair)
    assert all(tuple(o.scale) == (1,1,1) and tuple(o.rotation_euler) == (0,0,0) for o in pair)
    assert all([m.type for m in o.modifiers] == ['BEVEL','WEIGHTED_NORMAL'] for o in pair)
    assert {s.material.name for o in pair for s in o.material_slots} == MATERIALS
    assert all(not o.data.uv_layers and not o.data.color_attributes for o in pair)
    for m in {s.material for o in pair for s in o.material_slots}:
        assert sorted(n.bl_idname for n in m.node_tree.nodes) == ['ShaderNodeBsdfPrincipled','ShaderNodeOutputMaterial']
        assert len(m.node_tree.links) == 1
        link = m.node_tree.links[0]
        assert link.from_node.type == 'BSDF_PRINCIPLED' and link.to_socket.name == 'Surface'
    return pair


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--source', type=Path, default=SOURCE, help='Relocated byte-identical approved source only')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    out = new_output(args.output, '.glb')
    report = new_output(args.report, '.json') if args.report else None
    sys.path.insert(0, str(ROOT))
    import validate as V
    # The installed RNA and source were inspected before these options were
    # chosen. Reject incompatible future installations rather than guessing.
    assert bpy.app.version_string == '5.2.1 LTS', 'Revalidate a different Blender version first'
    assert io_scene_gltf2.get_version_string() == '5.2.40', 'Exporter version changed'
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties
    assert all(k in properties for k in SETTINGS), 'Required exporter option unavailable'
    print('EXPORT READ APPROVED SOURCE ATTEMPT', args.source, flush=True)
    pair = source_objects(args.source); expected = V.snapshot(pair)
    print('EXPORT READ APPROVED SOURCE SUCCESS; two authoritative meshes', flush=True)
    # Disposable in-memory scene only. Physical removal is an additional
    # safeguard beyond selection filtering; never save this scene.
    for o in list(bpy.data.objects):
        if o not in pair: bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.scene.camera = None
    bpy.ops.object.select_all(action='DESELECT')
    for o in pair: o.select_set(True)
    bpy.context.view_layer.objects.active = pair[0]
    scratch = Path(tempfile.mkdtemp(prefix='endcap-export-', dir='/tmp/opencode'))
    try:
        temp = scratch/'endcaps.glb'
        print('EXPORT GLB ATTEMPT', temp, SETTINGS, flush=True)
        result = bpy.ops.export_scene.gltf(filepath=str(temp), **SETTINGS)
        assert result == {'FINISHED'} and temp.stat().st_size > 0, result
        print('EXPORT GLB SUCCESS; VALIDATION ATTEMPT', flush=True)
        evidence = V.check(temp, expected)
        assert sha(args.source) == SOURCE_SHA, 'Approved source changed'
        print('EXPORT VALIDATION SUCCESS; COPY ATTEMPT', out, flush=True)
        with out.open('xb') as dst, temp.open('rb') as src: shutil.copyfileobj(src, dst)
        assert sha(out) == evidence['glb_sha256']
        if report:
            with report.open('x') as stream: json.dump(evidence, stream, indent=2); stream.write('\n')
        print('EXPORT COPY SUCCESS', out, flush=True)
    except BaseException:
        print('EXPORT FAILED; diagnostic scratch retained', scratch, flush=True)
        raise
    else:
        shutil.rmtree(scratch)
    finally:
        assert sha(args.source) == SOURCE_SHA, 'Approved source changed'


if __name__ == '__main__': main()
