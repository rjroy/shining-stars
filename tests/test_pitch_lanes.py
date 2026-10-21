"""Production lane-mapper contract tests against frozen pitch evidence.

The fixture contains only the approved 518-note pitch summaries, the cyclic
fallback pattern, and expected candidate lanes; it contains no audio.
"""

import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = ROOT / "tests/fixtures/music-lanes/the-rising-star-normal.json"


def load_fixture():
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    record_fields = ("pitch", "coverage", "mad", "stable")
    fixture["pitch_records"] = [
        dict(zip(record_fields, values, strict=True)) for values in fixture.pop("records")
    ]
    return fixture


class PitchLanesProductionContractTests(unittest.TestCase):
    def require_production_api(self):
        spec = importlib.util.find_spec("scripts.pitch_lanes")
        self.assertIsNotNone(
            spec,
            "Missing production behavior: scripts.pitch_lanes must expose the "
            "validated configurable lane mapper; the existing generator only "
            "uses its cyclic fallback.",
        )
        # Do not import a missing module: fail above with an explicit feature gap,
        # rather than a confusing import error.
        if spec is None:
            self.fail("Production pitch lane mapper is not implemented")
        import scripts.pitch_lanes as pitch_lanes

        return pitch_lanes

    def test_approved_518_note_golden_and_default_controls(self):
        mapper = self.require_production_api()
        fixture = load_fixture()
        expected_defaults = {
            "pitch_following": 1,
            "lane_balance": 1,
            "repetition_avoidance": 1,
            "wide_jump_avoidance": 1,
            "adaptation_block_notes": 32,
        }
        # Defaults are an input boundary, not an assertion about mutable
        # production tuning. Pin the test-owned profile while checking that
        # omitted and partial mappings resolve through that boundary.
        with patch.dict(mapper.DEFAULT_LANE_MAPPING, expected_defaults, clear=True):
            self.assertEqual(mapper.validate_lane_mapping(), expected_defaults)
            self.assertEqual(mapper.validate_lane_mapping({}), expected_defaults)
            self.assertEqual(
                mapper.validate_lane_mapping({"pitch_following": 0}),
                {**expected_defaults, "pitch_following": 0},
            )
            fallback = [
                fixture["fallback_pattern"][i % len(fixture["fallback_pattern"])]
                for i in range(len(fixture["pitch_records"]))
            ]
            self.assertEqual(
                mapper.map_lanes(fixture["pitch_records"], fallback),
                fixture["expected_lanes"],
            )

    def test_zero_pitch_following_leaves_stable_pitch_uninformed(self):
        mapper = self.require_production_api()
        controls = {
            "pitch_following": 0,
            "lane_balance": 0,
            "repetition_avoidance": 0,
            "wide_jump_avoidance": 0,
            "adaptation_block_notes": 32,
        }
        records = [
            {"pitch": 48 + index * 4, "coverage": 1.0, "mad": 0.0, "stable": True}
            for index in range(8)
        ]
        lanes = mapper.map_lanes(records, [0] * len(records), controls)
        self.assertEqual(lanes, [0] * len(records))

    def test_pitch_following_control_changes_lane_response(self):
        mapper = self.require_production_api()
        records = [
            {"pitch": 48 + index * 4, "coverage": 1.0, "mad": 0.0, "stable": True}
            for index in range(8)
        ]
        neutral = {
            "pitch_following": 0,
            "lane_balance": 0,
            "repetition_avoidance": 0,
            "wide_jump_avoidance": 0,
            "adaptation_block_notes": 32,
        }
        strong = {**neutral, "pitch_following": 4}
        fallback = [0] * len(records)
        no_follow = mapper.map_lanes(records, fallback, neutral)
        follow = mapper.map_lanes(records, fallback, strong)
        self.assertEqual(no_follow, [0] * len(records))
        self.assertGreater(len(set(follow)), 1)

    def test_zero_controls_keep_unknown_notes_on_cyclic_fallback(self):
        mapper = self.require_production_api()
        fixture = load_fixture()
        controls = {
            "pitch_following": 0,
            "lane_balance": 0,
            "repetition_avoidance": 0,
            "wide_jump_avoidance": 0,
            "adaptation_block_notes": 32,
        }
        unknowns = [
            {"pitch": None, "coverage": 0.0, "mad": None, "stable": False}
            for _ in range(12)
        ]
        fallback = [fixture["fallback_pattern"][i % 4] for i in range(12)]
        self.assertEqual(mapper.map_lanes(unknowns, fallback, controls), fallback)

    def test_balance_control_remains_soft_on_constant_pitch(self):
        mapper = self.require_production_api()
        records = [
            {"pitch": 60.0, "coverage": 1.0, "mad": 0.0, "stable": True}
            for _ in range(80)
        ]
        baseline = [0] * len(records)
        no_balance = {
            "pitch_following": 0,
            "lane_balance": 0,
            "repetition_avoidance": 0,
            "wide_jump_avoidance": 0,
            "adaptation_block_notes": 32,
        }
        stronger_balance = {**no_balance, "lane_balance": 4}
        unbalanced = mapper.map_lanes(records, baseline, no_balance)
        balanced = mapper.map_lanes(records, baseline, stronger_balance)
        squared_counts = lambda lanes: sum(lanes.count(lane) ** 2 for lane in range(4))
        self.assertLess(squared_counts(balanced), squared_counts(unbalanced))
        self.assertLessEqual(
            concentration32(balanced), concentration32(unbalanced)
        )

    def test_default_balance_is_soft_not_an_exact_lane_quota(self):
        mapper = self.require_production_api()
        records = [
            {"pitch": 60.0, "coverage": 1.0, "mad": 0.0, "stable": True}
            for _ in range(2)
        ]
        lanes = mapper.map_lanes(records, [3, 3])
        self.assertEqual(lanes, [0, 0])

    def test_repetition_and_wide_jump_controls_have_effect(self):
        mapper = self.require_production_api()
        unknown = [
            {"pitch": None, "coverage": 0.0, "mad": None, "stable": False}
            for _ in range(12)
        ]
        neutral = {
            "pitch_following": 0,
            "lane_balance": 0,
            "repetition_avoidance": 0,
            "wide_jump_avoidance": 0,
            "adaptation_block_notes": 32,
        }
        repeated_controls = {**neutral, "repetition_avoidance": 4}
        fallback = [0] * len(unknown)
        plain = mapper.map_lanes(unknown, fallback, neutral)
        repetition_avoided = mapper.map_lanes(unknown, fallback, repeated_controls)
        self.assertLess(max_run(repetition_avoided), max_run(plain))

        jump_records = unknown[:4]
        jump_fallback = [0, 0, 0, 3]
        jump_controls = {**neutral, "wide_jump_avoidance": 4}
        self.assertEqual(mapper.map_lanes(jump_records, jump_fallback, neutral), jump_fallback)
        self.assertNotEqual(
            mapper.map_lanes(jump_records, jump_fallback, jump_controls)[-1], 3
        )

    def test_adaptation_block_size_preserves_transposed_contour_without_forcing_identity(self):
        mapper = self.require_production_api()
        motif = [48 + index * 4 for index in range(8)]
        transposed_motif = [pitch + 12 for pitch in motif]
        pitches = motif + transposed_motif
        records = [
            {"pitch": pitch, "coverage": 1.0, "mad": 0.0, "stable": True}
            for pitch in pitches
        ]
        fallback = [0] * len(records)
        controls = {
            "pitch_following": 1,
            "lane_balance": 1,
            "repetition_avoidance": 1,
            "wide_jump_avoidance": 1,
        }
        adapted = mapper.map_lanes(
            records, fallback, {**controls, "adaptation_block_notes": 8}
        )
        pooled = mapper.map_lanes(
            records, fallback, {**controls, "adaptation_block_notes": 32}
        )
        adapted_distance = sum(a != b for a, b in zip(adapted[:8], adapted[8:]))
        pooled_distance = sum(a != b for a, b in zip(pooled[:8], pooled[8:]))
        self.assertGreater(adapted_distance, 0)
        self.assertLess(adapted_distance, pooled_distance)


def max_run(lanes):
    longest = current = 0
    previous = None
    for lane in lanes:
        current = current + 1 if lane == previous else 1
        longest = max(longest, current)
        previous = lane
    return longest


def concentration32(lanes):
    if len(lanes) < 32:
        return 0
    return max(
        max(lanes[start : start + 32].count(lane) for lane in range(4)) / 32
        for start in range(len(lanes) - 31)
    )


if __name__ == "__main__":
    unittest.main()
