import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.pitch_experiment import (
    candidate_with_lanes, eligible_contour_pairs, map_lanes, metrics,
    pitch_records, run_logged, summarize_pitch, temporary_audio_directory,
    worst_rolling32_concentration,
)


def records(pitches):
    return [{"pitch": p, "stable": p is not None, "coverage": 1 if p is not None else 0,
             "mad": 0 if p is not None else None} for p in pitches]


class PitchExperimentTests(unittest.TestCase):
    def test_source_start_applies_exact_inclusive_pitch_window(self):
        # For note 0.2 at sourceStart 5.0, only [5.23, 5.35] is included.
        rows = [(5.229, 10), (5.23, 60), (5.35, 62), (5.351, 100)]
        result = pitch_records(rows, 0.2, 5.0)
        self.assertEqual(result["pitch"], 61)
        self.assertAlmostEqual(result["coverage"], 2/11)

    def test_monotone_pitch_contour_is_mapped_upward(self):
        mapped, _ = map_lanes(records([48+i for i in range(16)]), [0]*16)
        self.assertGreater(mapped[-1], mapped[0])

    def test_constant_pitch_has_soft_balance_without_forced_exact_quota(self):
        mapped, _ = map_lanes(records([60]*80), [0]*80)
        shares = [mapped.count(i)/len(mapped) for i in range(4)]
        self.assertEqual(set(mapped), {0, 1, 2, 3})
        self.assertLessEqual(max(shares), 0.40)

    def test_unknown_pitch_has_no_preference_and_gaps_break_contour_pairs(self):
        items = records([48, None, 72])
        mapped, preferred = map_lanes(items, [2]*3)
        self.assertEqual(preferred, [0, None, 1])
        self.assertEqual(eligible_contour_pairs(items), [])
        self.assertTrue(all(0 <= lane <= 3 for lane in mapped))

    def test_silence_retains_unknown_state(self):
        self.assertEqual(summarize_pitch([]), {"pitch": None, "coverage": 0.0, "mad": None, "stable": False})

    def test_transposition_crossing_block_boundary_preserves_relative_preferences(self):
        motif = [48 + (i % 8) for i in range(64)]
        transposed = motif.copy()
        transposed[24:40] = [p + 12 for p in transposed[24:40]]
        _, pref = map_lanes(records(transposed), [0]*64)
        # These matching four-note contour fragments straddle boundary 32.
        self.assertEqual(pref[28:32], pref[36:40])

    def test_candidate_changes_only_normal_lanes(self):
        data = {"outside": {"keep": True}, "charts": {
            "normal": {"sourceStart": 4, "duration": 10, "notes": [{"id":"n1", "time":1, "lane":0}]},
            "hard": {"notes": [{"id":"h1", "lane":2, "time":3}]}}}
        result = candidate_with_lanes(data, [3])
        self.assertEqual(result["charts"]["normal"]["notes"][0], {"id":"n1", "time":1, "lane":3})
        self.assertEqual(result["charts"]["normal"]["sourceStart"], 4)
        self.assertEqual(result["charts"]["hard"], data["charts"]["hard"])
        self.assertEqual(data["charts"]["normal"]["notes"][0]["lane"], 0)

    def test_rolling32_uses_every_complete_sliding_window_and_ignores_tail(self):
        cyclic = [i % 4 for i in range(35)] + [2]*5
        self.assertEqual(worst_rolling32_concentration(cyclic), 12/32)
        self.assertIsNone(worst_rolling32_concentration([0, 1, 2]*10))

    def test_rolling32_detects_concentration_across_nonoverlap_boundary(self):
        lanes = [0]*20 + [1]*20
        self.assertEqual(worst_rolling32_concentration(lanes), 20/32)

    def test_baseline_and_candidate_agreement_share_exact_eligible_pairs(self):
        observed = records([60, 61, 62.26, 61.9, 65])
        result = metrics([0, 1, 2, 3, 0], [0, 2, 3, 1, 2], observed)
        self.assertEqual(result["stableUnequalPitchAdjacentPairs"], 4)
        self.assertIn("baselineExtractedF0DirectionAgreement", result)
        self.assertIn("candidateExtractedF0DirectionAgreement", result)

    def test_temporary_audio_directory_is_cleaned_after_failure(self):
        path = None
        with self.assertRaisesRegex(RuntimeError, "synthetic extraction failure"):
            with temporary_audio_directory() as directory:
                path = Path(directory)
                (path / "partial.wav").write_bytes(b"partial")
                raise RuntimeError("synthetic extraction failure")
        self.assertFalse(path.exists())

    def test_temporary_audio_directory_falls_back_when_preferred_parent_is_missing(self):
        with tempfile.TemporaryDirectory() as root:
            preferred = Path(root) / "missing" / "opencode"
            with patch("scripts.pitch_experiment.PREFERRED_TEMP_DIR", preferred):
                with self.assertRaisesRegex(RuntimeError, "synthetic extraction failure"):
                    with temporary_audio_directory() as directory:
                        path = Path(directory)
                        self.assertTrue(path.is_dir())
                        self.assertEqual(path.parent, Path(tempfile.gettempdir()))
                        self.assertNotEqual(path.parent, preferred)
                        (path / "partial.wav").write_bytes(b"partial")
                        raise RuntimeError("synthetic extraction failure")
                self.assertFalse(path.exists())
            self.assertFalse(preferred.exists())

    def test_failed_subprocess_attempt_is_persisted(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "attempts.json"
            with self.assertRaisesRegex(RuntimeError, "Command failed"):
                run_logged(["python3", "-c", "import sys; print('fail', file=sys.stderr); sys.exit(9)"],
                           timeout=10, attempt_log=[], attempt_log_path=path)
            entry = json.loads(path.read_text())[0]
            self.assertEqual(entry["status"], "failed")
            self.assertEqual(entry["returnCode"], 9)


if __name__ == "__main__":
    unittest.main()
