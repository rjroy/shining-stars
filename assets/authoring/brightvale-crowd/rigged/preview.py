"""Read-only neutral-light pose diagnostics. Does not save the source."""
import argparse
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import apply_pose, POSES, sha


def aim(obj, target):
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def render(out, poses, views):
    source = Path(bpy.data.filepath)
    before = sha(source)
    paths = [out/(pose.lower()+'-'+view+'.png') for pose in poses for view in views]
    if any(p.exists() for p in paths):
        raise FileExistsError('Refusing existing preview output')
    scene = bpy.context.scene
    coll = bpy.data.collections.new('REVIEW_ONLY')
    scene.collection.children.link(coll)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.world = bpy.data.worlds.new('ReviewWorld')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.43,.43,.43,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .65
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    for name,location,energy,size in [('Key',(-3,-4,5),300,4),('Fill',(3,-3,3),170,4),('Rear',(1,3,4),220,3)]:
        data = bpy.data.lights.new(name,'AREA')
        data.energy, data.shape, data.size = energy, 'DISK', size
        obj = bpy.data.objects.new(name,data)
        coll.objects.link(obj)
        obj.location = location
        aim(obj,(0,0,1))
    data = bpy.data.cameras.new('ReviewCamera')
    camera = bpy.data.objects.new('ReviewCamera',data)
    coll.objects.link(camera)
    scene.camera = camera
    data.type = 'ORTHO'
    for pose in poses:
        rig = apply_pose(pose, use_action=True)
        for view in views:
            target = Vector((0,0,1.04))
            offset,scale,width,height = (0,-6,0),2.34,1000,1100
            if view == 'threequarter':
                offset = (3,-6,.9)
            elif view == 'shoulder':
                target = (rig.pose.bones['upper_arm.L'].head+rig.pose.bones['forearm.L'].head)*.5
                offset,scale,width,height = (1,-5,.9),.79,1000,1000
            elif view == 'hand':
                target = rig.pose.bones['hand.L'].head.lerp(rig.pose.bones['hand.L'].tail,.55)
                offset,scale,width,height = (1,-5,.7),.36,900,900
            elif view != 'front':
                raise ValueError(view)
            camera.location = target+Vector(offset)
            aim(camera,target)
            data.ortho_scale = scale
            scene.render.resolution_x,scene.render.resolution_y = width,height
            scene.render.resolution_percentage = 100
            scene.render.image_settings.file_format = 'PNG'
            path = out/(pose.lower()+'-'+view+'.png')
            scene.render.filepath = str(path)
            print('POSE RENDER BEGIN',pose,view,flush=True)
            bpy.ops.render.render(write_still=True)
            assert path.stat().st_size > 0
            print('POSE RENDER COMPLETE',path,flush=True)
    assert sha(source) == before, 'SOURCE MUTATED'
    print('SOURCE UNCHANGED',before,flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--poses', nargs='+', choices=list(POSES), default=list(POSES))
    parser.add_argument('--views', nargs='+', choices=['front','threequarter','shoulder','hand'], default=['front','threequarter'])
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    assert args.output_dir.is_dir()
    render(args.output_dir.resolve(),args.poses,args.views)
