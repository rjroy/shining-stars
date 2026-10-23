import argparse
import importlib.util
import unittest
from pathlib import Path

import numpy as np


SCRIPT = Path(__file__).with_name("build-plaza-normal.py")
SPEC = importlib.util.spec_from_file_location("build_plaza_normal", SCRIPT)
normal_builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(normal_builder)


class BuildPlazaNormalTests(unittest.TestCase):
    def test_flat_field_encodes_neutral_normal(self):
        normal = normal_builder.build_normal(np.full((7, 9), 0.4, np.float32))
        np.testing.assert_array_equal(normal[..., :2], 0)
        np.testing.assert_array_equal(normal[..., 2], 1)

    def test_strength_changes_slope_direction_and_magnitude(self):
        _, x = np.mgrid[:12, :16]
        field = (0.5 + 0.2 * np.sin(2 * np.pi * x / 16)).astype(np.float32)
        gentle = normal_builder.build_normal(field, strength=0.01)
        strong = normal_builder.build_normal(field, strength=0.1)
        self.assertGreater(np.max(np.abs(strong[..., 0])), np.max(np.abs(gentle[..., 0])))
        self.assertTrue(np.all(strong[..., 0] * gentle[..., 0] >= 0))

    def test_default_values_match_previous_recipe(self):
        y, x = np.mgrid[:8, :11]
        luminance = (0.5 + 0.2 * np.sin(2 * np.pi * x / 11) * np.cos(2 * np.pi * y / 8)).astype(np.float32)
        base = normal_builder.periodic_blur(luminance, 9.0)
        detail = luminance - normal_builder.periodic_blur(luminance, 1.4)
        relief = 0.78 * base + 0.22 * detail
        du = (np.roll(relief, -1, axis=1) - np.roll(relief, 1, axis=1)) * (11 * 0.5) * 0.035
        drow = (np.roll(relief, -1, axis=0) - np.roll(relief, 1, axis=0)) * (8 * 0.5) * 0.035
        expected = np.stack((-du, drow, np.ones_like(du)), axis=-1)
        expected /= np.linalg.norm(expected, axis=-1, keepdims=True)
        np.testing.assert_array_equal(normal_builder.build_normal(luminance), expected)

    def test_argument_ranges(self):
        for value in ("-1", "nan", "inf"):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                normal_builder.nonnegative_float(value)
        for value in ("-0.1", "1.1", "nan"):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                normal_builder.unit_interval_float(value)
        self.assertEqual(normal_builder.nonnegative_float("0"), 0)
        self.assertEqual(normal_builder.unit_interval_float("1"), 1)


if __name__ == "__main__":
    unittest.main()
