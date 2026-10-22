"""Pure asset-algorithm tests with tiny test-owned RGBA fixtures, not live art."""
import unittest
import produce as p


class AtlasTests(unittest.TestCase):
    def test_crop_uses_rows_and_rejects_out_of_bounds(self):
        raw=bytes(range(48))
        self.assertEqual(p.crop(raw,3,4,[1,1,2,2]),raw[16:24]+raw[28:36])
        with self.assertRaises(ValueError): p.crop(raw,3,4,[2,1,2,2])

    def test_extrusion_keeps_straight_alpha_and_all_channels(self):
        pixels=bytes([201,37,15,1, 20,140,80,253, 2,4,9,0, 80,70,60,255])
        atlas=bytearray(6*6*4)
        p.paste_extruded(atlas,6,6,pixels,[2,2,2,2],1)
        self.assertEqual(p.crop(atlas,6,6,[2,2,2,2]),pixels)
        self.assertEqual(atlas[(1*6+1)*4:(1*6+1)*4+4],pixels[:4])
        self.assertEqual(atlas[(4*6+4)*4:(4*6+4)*4+4],pixels[12:16])
        self.assertEqual(atlas[(4*6+1)*4:(4*6+1)*4+4],pixels[8:12])
        self.assertEqual(atlas[:4],bytes(4))
        with self.assertRaises(ValueError): p.paste_extruded(atlas,6,6,pixels,[0,0,2,2],1)

    def test_rectangles_allow_touching_not_overlap(self):
        self.assertFalse(p.overlaps([0,0,4,4],[4,0,2,2]))
        self.assertTrue(p.overlaps([0,0,4,4],[3,3,2,2]))
        self.assertEqual(p.padded_rect([4,5,8,9],2),[2,3,12,13])

    def test_local_coordinate_signs_common_scale(self):
        old=p.PIXELS_PER_UNIT
        try:
            p.PIXELS_PER_UNIT=8
            self.assertEqual(p.local([12,4],[4,12]),[1,1])
            self.assertEqual(p.local([4,12],[4,12]),[0,0])
        finally: p.PIXELS_PER_UNIT=old


if __name__=='__main__': unittest.main()
