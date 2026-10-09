"""Standard-library behavior tests for the offline beat-chart API."""

import hashlib
import importlib.util
import re
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "beat_chart.py"
SPEC = importlib.util.spec_from_file_location("beat_chart", MODULE_PATH)
beat_chart = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(beat_chart)


class ParseBeatsTests(unittest.TestCase):
    def test_parses_whitespace_and_blank_lines(self):
        self.assertEqual(beat_chart.parse_beats(" 0.25\n\n\t1.5 \n2\n"), [0.25, 1.5, 2.0])

    def test_empty_output_is_an_empty_sequence(self):
        self.assertEqual(beat_chart.parse_beats(" \n\t\n"), [])

    def test_rejects_non_numeric_cli_output(self):
        with self.assertRaises(ValueError):
            beat_chart.parse_beats("1.0\nnot a beat\n2.0")

    def test_rejects_headers_even_if_other_lines_are_numeric(self):
        with self.assertRaises(ValueError):
            beat_chart.parse_beats("Analyzing '/tmp/audio.wav'\n1.0\n")

    def test_rejects_non_finite_negative_duplicate_and_unsorted_values(self):
        for text in ("nan", "inf", "-inf", "-0.1", "1\n1", "2\n1"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                beat_chart.parse_beats(text)


class SelectNotesTests(unittest.TestCase):
    def test_selection_is_anchored_to_full_track_beat_indices(self):
        beats = [float(index) for index in range(180)]
        notes = beat_chart.select_notes(beats, stride=4)
        self.assertTrue(notes)
        self.assertEqual([n["source_beat_index"] for n in notes], sorted(n["source_beat_index"] for n in notes))
        self.assertTrue(all(n["source_beat_index"] % 4 == 0 for n in notes))
        self.assertEqual(notes[0]["source_beat_index"], 108)

    def test_records_source_and_excerpt_relative_times(self):
        notes = beat_chart.select_notes([107.1, 108.0, 109.2], stride=1)
        note = next(n for n in notes if n["source_time"] == 109.2)
        self.assertEqual(note["relative_time"], 2.1)
        self.assertEqual(note["source_beat_index"], 2)

    def test_lane_pattern_cycles_by_selected_beat_slot(self):
        beats = [110.0 + i for i in range(40)]
        notes = beat_chart.select_notes(beats, stride=1, lane_pattern=(3, 1))
        self.assertEqual([n["lane"] for n in notes[:4]], [3, 1, 3, 1])

    def test_rejects_invalid_stride_and_lane_pattern(self):
        for stride in (0, -1):
            with self.subTest(stride=stride), self.assertRaises(ValueError):
                beat_chart.select_notes([110.0], stride=stride)
        for pattern in ((), (0, 4), (0, -1)):
            with self.subTest(pattern=pattern), self.assertRaises(ValueError):
                beat_chart.select_notes([110.0], lane_pattern=pattern)

    def test_excludes_excerpt_edges_and_strict_boundary_guard_edges(self):
        # Centers at 0.35 and duration-0.85 are inclusive; boundary +/- 0.85
        # are strictly excluded. Other centers just outside are not shifted.
        source_start, duration, boundary = 10.0, 10.0, 5.0
        rels = [0.349999, 0.35, 4.149999, 4.15, 5.85, 5.850001, 9.15, 9.150001]
        notes = beat_chart.select_notes(
            [source_start + rel for rel in rels], source_start, duration, boundary, stride=1
        )
        self.assertEqual(
            [round(n["relative_time"], 6) for n in notes],
            [0.35, 4.149999, 5.850001, 9.15],
        )

    def test_does_not_reset_stride_at_boundary(self):
        source_start = 100.0
        beats = [source_start + i * 0.5 for i in range(140)]
        notes = beat_chart.select_notes(beats, source_start, 65.8, 30.0, stride=4)
        before = [n for n in notes if n["relative_time"] < 30.0]
        after = [n for n in notes if n["relative_time"] > 30.0]
        self.assertTrue(before and after)
        self.assertTrue(all(n["source_beat_index"] % 4 == 0 for n in before + after))

    def test_no_rounding_before_filtering_can_leak_across_guard(self):
        notes = beat_chart.select_notes([14.1499999], 10.0, 10.0, 5.0, stride=1)
        self.assertEqual(notes, [])

    def test_default_handoff_guard_matches_chart_timing_envelope(self):
        notes = beat_chart.select_notes([145.4499999], stride=1)
        self.assertEqual(notes, [])

    def test_output_is_sorted_and_contains_no_chords(self):
        notes = beat_chart.select_notes([110.0 + i * 0.25 for i in range(60)], stride=1)
        times = [n["relative_time"] for n in notes]
        self.assertEqual(times, sorted(times))
        self.assertEqual(len(times), len(set(times)))


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.notes = beat_chart.select_notes([108.0 + i * 0.5 for i in range(120)])
        self.digest = hashlib.sha256(b"synthetic source audio").hexdigest()

    def test_renders_deterministic_mvp_chart_typescript_with_provenance(self):
        rendered = beat_chart.render_mvp_chart(self.notes, source_sha256=self.digest)
        self.assertEqual(rendered, beat_chart.render_mvp_chart(self.notes, source_sha256=self.digest))
        self.assertIn("MVP_CHART", rendered)
        self.assertIn("ChartConfig", rendered)
        self.assertIn(self.digest, rendered)
        self.assertIn("sourceStart: 107.1", rendered)

    def test_render_precision_matches_source_mapping_within_one_microsecond(self):
        notes = beat_chart.select_notes([108.0, 108.123456789], stride=1)
        rendered = beat_chart.render_mvp_chart(notes, source_sha256=self.digest)
        relative = next(n["relative_time"] for n in notes if n["source_time"] == 108.123456789)
        self.assertIn(f"{relative:.6f}", rendered)
        self.assertLessEqual(abs(float(f"{relative:.6f}") - relative), 1e-6)

    def test_config_roundtrip_preserves_source_mapping_within_one_microsecond(self):
        source_start = 107.123456789
        duration = 65.8123456789
        boundary = 39.2123456789
        source_time = source_start + 1.0
        notes = beat_chart.select_notes(
            [source_time], source_start, duration, boundary, stride=1
        )
        rendered = beat_chart.render_mvp_chart(
            notes,
            source_start=source_start,
            duration=duration,
            twilight_at=boundary,
            source_sha256=self.digest,
        )
        config_values = {}
        for name in ("sourceStart", "duration", "twilightAt"):
            match = re.search(rf"\b{name}: ([0-9]+(?:\.[0-9]+)?)", rendered)
            self.assertIsNotNone(match, f"missing numeric {name} in generated config")
            config_values[name] = float(match.group(1))
        note_time_match = re.search(r"time: ([0-9]+(?:\.[0-9]+)?)", rendered)
        self.assertIsNotNone(note_time_match, "missing numeric note time in generated config")
        rendered_source_time = config_values["sourceStart"] + float(note_time_match.group(1))
        self.assertLessEqual(abs(config_values["sourceStart"] - source_start), 1e-6)
        self.assertLessEqual(abs(config_values["duration"] - duration), 1e-6)
        self.assertLessEqual(abs(config_values["twilightAt"] - boundary), 1e-6)
        self.assertLessEqual(abs(rendered_source_time - source_time), 1e-6)

    def test_hash_mismatch_is_rejected(self):
        with self.assertRaises(ValueError):
            beat_chart.verify_source_sha256("a" * 64, "b" * 64)

    def test_matching_hash_is_accepted(self):
        digest = hashlib.sha256(b"source").hexdigest()
        self.assertIsNone(beat_chart.verify_source_sha256(digest, digest))


if __name__ == "__main__":
    unittest.main()
