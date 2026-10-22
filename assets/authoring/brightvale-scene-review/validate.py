"""Validate shared city/playfield composition without the retired 3D crowd."""
import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
import bpy

PACKAGE = Path(__file__).resolve().parent
sys.path.insert(0, str(PACKAGE))
sys.path.insert(0, str(PACKAGE / 'scripts'))
import assemble as A
import checks as L


def validate_scene():
    scene = bpy.context.scene
    assert not bpy.data.libraries and not bpy.data.images, 'External scene dependencies'
    assert scene.camera is not None and len(bpy.data.cameras) == 1, 'One review camera required'
    assert len(bpy.data.lights) == 4, 'Four shared review lights required'
    for asset in ('platform', 'endcaps', 'highway', 'framing', 'city'):
        assert any(o.get('review_asset') == asset for o in scene.objects), f'Missing shared asset {asset}'
    assert not any(o.get('review_asset') == 'crowd' for o in scene.objects), 'Retired crowd objects are not part of this study'

    arc = L.arc_check()
    ground = L.ground_checks()
    lanes = L.lane_checks()
    assert arc['sections'] == 26 and arc['complete_posts'] == 27
    assert lanes == 820
    return {
        'shared_assets': ['platform', 'endcaps', 'highway', 'framing', 'city'],
        'crowd': 'excluded; use current waist-up atlas/runtime pipeline',
        'arc': arc,
        'ground': ground,
        'unobstructed_lane_rays': lanes,
    }


def negative_tests():
    scene = bpy.context.scene
    results = {}

    city = next(o for o in scene.objects if o.get('review_asset') == 'city')
    saved_city = city.location.copy()
    try:
        city.location.z -= .1
        bpy.context.view_layer.update()
        try:
            L.ground_checks()
        except AssertionError as error:
            assert 'City base not on lower' in str(error)
            results['buried_city_rejected'] = True
        else:
            raise AssertionError('Buried city defect accepted')
    finally:
        city.location = saved_city
        bpy.context.view_layer.update()

    plaza = bpy.data.objects[L.G.PLAZA]
    saved_plaza = plaza.location.copy()
    try:
        plaza.location.z += .1
        bpy.context.view_layer.update()
        try:
            L.ground_checks()
        except AssertionError as error:
            assert 'Wrong local-ground elevation' in str(error)
            results['wrong_plaza_height_rejected'] = True
        else:
            raise AssertionError('Wrong plaza height accepted')
    finally:
        plaza.location = saved_plaza
        bpy.context.view_layer.update()

    post = next(o for o in scene.objects if o.get('arc_role') == 'post' and o['arc_index'] == 1)
    saved_post = post.location.copy()
    try:
        post.location.x += .2
        bpy.context.view_layer.update()
        try:
            L.arc_check()
        except AssertionError as error:
            assert 'Not circular' in str(error)
            results['noncircular_post_rejected'] = True
        else:
            raise AssertionError('Noncircular post accepted')
    finally:
        post.location = saved_post
        bpy.context.view_layer.update()
    return results


def run(report, negative=False):
    report = A.new_output(report, '.json')
    A.check_sources()
    result = {'pass': True, 'blender': bpy.app.version_string, **validate_scene()}
    if negative:
        result['negative_tests'] = negative_tests()
        A.check_sources()
        result.update(validate_scene())
    report.write_text(json.dumps(result, indent=2) + '\n')
    print('SHARED SCENE VALIDATION SUCCESS', report, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--negative-test', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    run(args.report, args.negative_test)
