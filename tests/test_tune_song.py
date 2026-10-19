"""Isolated orchestration tests for the single-song helper."""

import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import call, patch

from scripts import tune_song


class TuneSongTests(unittest.TestCase):
    @patch("scripts.tune_song.subprocess.run")
    def test_runs_generation_then_density_with_same_interpreter(self, run):
        run.return_value.returncode = 0

        result = tune_song.main(["fixture-song"])

        self.assertEqual(result, 0)
        self.assertEqual(
            run.call_args_list,
            [
                call(
                    [sys.executable, str(Path(tune_song.__file__).resolve().parent / "beat_chart.py"), "--song", "fixture-song"],
                    check=False,
                ),
                call(
                    [sys.executable, str(Path(tune_song.__file__).resolve().parent / "chart_density.py"), "--song", "fixture-song"],
                    check=False,
                ),
            ],
        )

    @patch("scripts.tune_song.subprocess.run")
    def test_failure_stops_pipeline_and_propagates_exit_code(self, run):
        run.return_value.returncode = 17

        self.assertEqual(tune_song.main(["fixture-song"]), 17)
        run.assert_called_once()

    def test_song_id_is_required(self):
        with self.assertRaises(SystemExit) as raised:
            tune_song.main([])
        self.assertEqual(raised.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
