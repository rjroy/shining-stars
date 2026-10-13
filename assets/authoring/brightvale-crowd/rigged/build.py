"""Immutable-base FK rig; explicit new output only. No mesh edits or exports."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Euler, Vector

BASE_SHA256 = '800ef1f869e69489e0ae049b2c952bfcbe227be17614e21843008aa19e5b33f8'
BASE = Path(__file__).resolve().parent.parent / 'neutral-base' / 'character.blend'
POSES = {
    'Rest': {},
    'Cheering': {
        'clavicle.L': (0, -7, -3), 'upper_arm.L': (0, -30, -9),
        'forearm.L': (0, -43, 0), 'hand.L': (0, 9, -8),
        'clavicle.R': (0, 6, 2), 'upper_arm.R': (0, 26, 7),
        'forearm.R': (0, 56, 0), 'hand.R': (0, -12, 7),
        'head': (-3, 0, -3),
    },
    'Reaching': {
        'clavicle.L': (0, -2, -7), 'upper_arm.L': (0, 13, -43),
        'forearm.L': (-40, -17, -24), 'hand.L': (0, -18, 12),
        'clavicle.R': (0, -3, 0), 'upper_arm.R': (0, -49, 8),
        'forearm.R': (0, 43, 26), 'hand.R': (0, -6, -4),
        'head': (0, 0, -4),
    },
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def new_output(path, suffix):
    path = Path(path).resolve()
    if path.exists():
        raise FileExistsError('Refusing existing output: ' + str(path))
    if path.suffix != suffix or not path.parent.is_dir():
        raise ValueError('Existing directory and new ' + suffix + ' path required')
    return path


def smooth(a, b, x):
    t = max(0., min(1., (x-a)/(b-a)))
    return t*t*(3-2*t)


def mix(a, b, t):
    result = {k: v*(1-t) for k, v in a.items()}
    for k, v in b.items():
        result[k] = result.get(k, 0.) + v*t
    return {k: v for k, v in result.items() if v > 1e-9}


def bone_specs():
    # name, head, tail, parent, connected. Local Y follows bone; local Z
    # is aligned toward -Y (forward), including mirrored arms, no random roll.
    specs = [
        ('root', (0,0,0), (0,0,.18), None, False),
        ('pelvis', (0,.012,.86), (0,.012,1.025), 'root', False),
        ('spine', (0,.012,1.025), (0,0,1.235), 'pelvis', True),
        ('chest', (0,0,1.235), (0,-.012,1.409), 'spine', True),
        ('neck', (0,-.012,1.409), (0,.012,1.53), 'chest', True),
        ('head', (0,.012,1.53), (0,.012,1.755), 'neck', True),
    ]
    for side, suffix in ((1,'L'), (-1,'R')):
        specs += [
            ('clavicle.'+suffix, (0,-.012,1.409), (side*.20,-.012,1.409), 'chest', True),
            ('upper_arm.'+suffix, (side*.20,-.012,1.409), (side*.478,-.012,1.409), 'clavicle.'+suffix, True),
            ('forearm.'+suffix, (side*.478,-.012,1.409), (side*.687,-.012,1.409), 'upper_arm.'+suffix, True),
            ('hand.'+suffix, (side*.687,-.012,1.409), (side*.80,-.012,1.409), 'forearm.'+suffix, True),
            ('thigh.'+suffix, (side*.093,.012,.86), (side*.105,-.012,.537), 'pelvis', False),
            ('shin.'+suffix, (side*.105,-.012,.537), (side*.121,0,.153), 'thigh.'+suffix, True),
            ('foot.'+suffix, (side*.121,0,.153), (side*.121,-.106,.045), 'shin.'+suffix, True),
        ]
    return specs


def torso_weights(z):
    return mix(mix({'pelvis':1.}, {'spine':1.}, smooth(1.02,1.14,z)),
               {'chest':1.}, smooth(1.15,1.35,z))


def shoulder_weights(x, z, suffix):
    # Same spatial field for sleeve and covered upper arm, avoiding independent
    # rigid garment parenting. Cuff and covered shaft share full upper-arm motion.
    upper = smooth(.13,.24,x)
    shoulder = mix({'clavicle.'+suffix:1.}, {'upper_arm.'+suffix:1.}, upper)
    influence = smooth(.07,.20,x)*smooth(1.23,1.34,z)
    return mix(torso_weights(z), shoulder, influence)


def weights(obj, co):
    x,y,z = co
    suffix = 'L' if x >= 0 else 'R'
    ax = abs(x)
    if obj.name.startswith('ArmHand.'):
        result = shoulder_weights(ax,z,suffix) if ax < .275 else {'upper_arm.'+suffix:1.}
        result = mix(result, {'forearm.'+suffix:1.}, smooth(.432,.521,ax))
        return mix(result, {'hand.'+suffix:1.}, smooth(.660,.709,ax))
    if obj.name == 'Shirt':
        return shoulder_weights(ax,z,suffix)
    if obj.name == 'Head':
        return mix({'neck':1.}, {'head':1.}, smooth(1.466,1.530,z))
    if obj.name in ('Hair','Ears','Mouth') or obj.name.startswith(('EyeWhite.','Iris.','BrowLid.')):
        return {'head':1.}
    if obj.name == 'Waistband':
        return {'pelvis':1.}
    if obj.name == 'Trousers':
        result = mix({'pelvis':1.}, {'thigh.'+suffix:1.}, 1-smooth(.752,.94,z))
        return mix(result, {'shin.'+suffix:1.}, 1-smooth(.48,.59,z))
    if obj.name.startswith('Shoe.'):
        return {'foot.'+suffix:1.}
    raise ValueError('Unknown mesh '+obj.name)


def apply_pose(name, use_action=False):
    rig = bpy.data.objects['CrowdRig']
    rig.animation_data_create()
    rig.animation_data.action = None
    rig.data.pose_position = 'POSE'
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.location = (0,0,0)
        pb.scale = (1,1,1)
        # Angles are in the unposed global axes, converted explicitly to each
        # bone's rest-local axes. Hierarchical rotations then compose naturally.
        q = Euler(tuple(math.radians(v) for v in POSES[name].get(pb.name,(0,0,0))), 'XYZ').to_quaternion()
        rest = pb.bone.matrix_local.to_quaternion()
        pb.rotation_quaternion = rest.inverted() @ q @ rest
    if use_action:
        rig.animation_data.action = bpy.data.actions['Pose.'+name]
        bpy.context.scene.frame_set(1)
    bpy.context.scene['authoring_pose'] = name
    bpy.context.view_layer.update()
    return rig


def build(output):
    assert sha(BASE) == BASE_SHA256, 'Approved base checksum mismatch'
    print('RIG READ APPROVED BASE', BASE, BASE_SHA256, flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    coll = bpy.data.collections.new('AUTHORING_RIG')
    bpy.context.scene.collection.children.link(coll)
    data = bpy.data.armatures.new('CrowdRig.Skeleton')
    rig = bpy.data.objects.new('CrowdRig', data)
    coll.objects.link(rig)
    rig.parent = bpy.data.objects['NeutralBase']
    rig.show_in_front = True
    data.display_type = 'OCTAHEDRAL'
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name,head,tail,parent,connected in bone_specs():
        bone = data.edit_bones.new(name)
        bone.head, bone.tail = head, tail
        if parent:
            bone.parent = data.edit_bones[parent]
            bone.use_connect = connected
        bone.align_roll(Vector((0,-1,0)))
        bone.use_deform = name != 'root'
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in sorted(bpy.data.objects, key=lambda o:o.name):
        if obj.type != 'MESH':
            continue
        groups = {b.name:obj.vertex_groups.new(name=b.name) for b in data.bones if b.use_deform}
        for vertex in obj.data.vertices:
            values = weights(obj,vertex.co)
            total = sum(values.values())
            for key,value in values.items():
                groups[key].add([vertex.index], value/total, 'REPLACE')
        mod = obj.modifiers.new('Controlled skinning', 'ARMATURE')
        mod.object = rig
        mod.use_deform_preserve_volume = True
        mod.use_vertex_groups = True
        mod.use_bone_envelopes = False
    rig['pose_definitions'] = json.dumps(POSES, sort_keys=True)
    rig['source_sha256'] = BASE_SHA256
    rig['controls'] = 'Direct FK; local Y bone axis, local Z forward; no IK or finger/facial rig'
    for name in POSES:
        apply_pose(name)
        action = bpy.data.actions.new('Pose.'+name)
        rig.animation_data.action = action
        action.use_fake_user = True
        action['purpose'] = 'Single-frame authoring pose, not a game animation clip'
        for pb in rig.pose.bones:
            for field in ('location','rotation_quaternion','scale'):
                pb.keyframe_insert(data_path=field, frame=1, group=pb.name)
    apply_pose('Rest', use_action=True)
    scene = bpy.context.scene
    scene.frame_start = scene.frame_end = 1
    scene['status'] = 'Rig candidate pending review; approved base geometry unchanged; no runtime approval'
    assert sha(BASE) == BASE_SHA256
    # No save to BASE, even when accidentally invoked with an existing path.
    new_output(output, '.blend')
    print('RIG SAVE NEW CANDIDATE', output, flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    assert sha(BASE) == BASE_SHA256
    print('RIG BUILD COMPLETE; approved base unchanged', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    build(new_output(args.output, '.blend'))
