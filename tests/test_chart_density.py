"""Isolated tests for read-only generated-chart density summaries."""

import json
import math
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path

from scripts import chart_density


class ChartDensitySummaryTests(unittest.TestCase):
    def test_duration_weighted_full_and_partial_blocks(self):
        chart = {
            "duration": 25,
            "notes": [
                {"time": 0}, {"time": 9.5},
                {"time": 20}, {"time": 21}, {"time": 24.9},
            ],
        }
        mean, stddev, maximum = chart_density.summarize_chart(chart)
        self.assertEqual(mean, 2.0)
        self.assertAlmostEqual(stddev, math.sqrt(4.8))
        self.assertEqual(maximum, 6.0)

    def test_zero_note_blocks_boundary_assignment_and_short_chart(self):
        mean, stddev, maximum = chart_density.summarize_chart({"duration": 20, "notes": []})
        self.assertEqual((mean, stddev, maximum), (0, 0, 0))

        chart = {"duration": 20, "notes": [{"time": 0}, {"time": 9.9}, {"time": 10}, {"time": 19.9}]}
        self.assertEqual(chart_density.summarize_chart(chart), (2, 0, 2))
        self.assertEqual(chart_density.summarize_chart({"duration": 2, "notes": [{"time": 0}]}), (5, 0, 5))

    def test_rejects_invalid_duration_notes_and_out_of_range_times(self):
        for duration in (0, -1, True, float("inf"), float("nan"), "10"):
            with self.subTest(duration=duration), self.assertRaises(ValueError):
                chart_density.summarize_chart({"duration": duration, "notes": []})

        for note in ({"time": -0.001}, {"time": 10}, {"time": float("inf")}, {"time": float("nan")}, {"time": True}, {}):
            with self.subTest(note=note), self.assertRaises(ValueError):
                chart_density.summarize_chart({"duration": 10, "notes": [note]})
        for chart in ({"duration": 10}, {"duration": 10, "notes": None}, []):
            with self.subTest(chart=chart), self.assertRaises(ValueError):
                chart_density.summarize_chart(chart)

    def test_display_rounds_only_at_two_decimal_report_format(self):
        rows = chart_density._format_report(
            "fixture",
            {
                difficulty: {"duration": 20, "notes": [{"time": 0}]}
                for difficulty in chart_density.DIFFICULTIES
            },
        )
        self.assertEqual(rows, [f"fixture\t{difficulty}\t0.50\t0.50\t1.00" for difficulty in chart_density.DIFFICULTIES])


class ChartDensityCliTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.write_bundle("fixture-one", 20, [0, 10])
        self.write_bundle("fixture-two", 5, [0])

    def tearDown(self):
        self.tempdir.cleanup()

    def write_bundle(self, song_id, duration, note_times):
        chart = {"duration": duration, "notes": [{"time": time} for time in note_times]}
        path = self.root / f"{song_id}.charts.json"
        path.write_text(json.dumps({
            "schemaVersion": 1,
            "songId": song_id,
            "charts": {difficulty: chart for difficulty in chart_density.DIFFICULTIES},
        }))
        return path

    def invoke(self, *args):
        output, errors = StringIO(), StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            result = chart_density.main(args, generated_dir=self.root)
        return result, output.getvalue(), errors.getvalue()

    def test_cli_all_and_song_selection_use_chart_bundle_catalog(self):
        result, output, errors = self.invoke("--all")
        self.assertEqual(result, 0, errors)
        self.assertEqual(len(output.strip().splitlines()), 1 + 2 * len(chart_density.DIFFICULTIES))
        self.assertIn("fixture-one\teasy\t1.00\t0.00\t1.00", output)
        self.assertIn("fixture-two\thard\t2.00\t0.00\t2.00", output)

        result, output, errors = self.invoke("--song", "fixture-two")
        self.assertEqual(result, 0, errors)
        self.assertEqual(len(output.strip().splitlines()), 1 + len(chart_density.DIFFICULTIES))
        self.assertTrue(all(line.startswith("fixture-two\t") for line in output.strip().splitlines()[1:]))

    def test_cli_unknown_song_and_malformed_bundle_have_useful_errors(self):
        result, output, errors = self.invoke("--song", "missing-song")
        self.assertEqual(result, 1)
        self.assertEqual(output, "")
        self.assertIn("unknown song ID 'missing-song'", errors)

        (self.root / "fixture-bad.charts.json").write_text("{")
        result, output, errors = self.invoke("--all")
        self.assertEqual(result, 1)
        self.assertEqual(output, "")
        self.assertIn("cannot read chart bundle", errors)

    def test_cli_requires_exactly_one_selection(self):
        for args in ((), ("--all", "--song", "fixture-one")):
            with self.subTest(args=args), self.assertRaises(SystemExit) as raised:
                chart_density.main(args, generated_dir=self.root)
            self.assertEqual(raised.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
