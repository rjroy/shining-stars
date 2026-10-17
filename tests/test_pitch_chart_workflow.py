"""RED contracts for full-source pitch analysis in chart generation.

These tests use the existing public beat_chart.main/runner seam and temporary
outputs. The anticipated added seams are DEFAULT_PITCH_CACHE_DIR,
DEFAULT_REPORTS_DIR, PITCH_RECIPE_VERSION, PITCH_RECIPE_ARGS, and
_pitch_tool_identity(). They keep extraction/tool identity deterministic in
tests without installing or invoking audio tools.
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from scripts import beat_chart


DIFFICULTIES = ("easy", "normal", "hard")
DEFAULT_RECIPE_ARGS = {
    "sample_rate": 22050,
    "algorithm": "yinfft",
    "buffer_size": 2048,
    "hop_size": 256,
    "pitch_unit": "midi",
    "time_unit": "seconds",
    "silence_db": -90,
}


class PitchChartWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.source = self.root / "full-song.wav"
        self.source.write_bytes(b"synthetic full source")
        self.song_id = "pitch-fixture-song"
        self.song_config = self.root / "song-authoring.json"
        self.generated_dir = self.root / "generated"
        self.onsets_dir = self.root / "onsets"
        self.pitch_cache_dir = self.root / "pitch-cache"
        self.reports_dir = self.root / "reports"
        self.profile_path = self.root / "difficulty-profiles.json"
        self.profile_path.write_bytes(
            (beat_chart.PROJECT_ROOT / "data/charts/difficulty-profiles.json").read_bytes()
        )
        self.settings = self.make_settings()
        self.write_config()
        self.calls = []
        self.wav_outputs = []
        self.identity = {
            "ffmpeg_version": "ffmpeg test identity 1",
            "ffmpeg_sha256": "f" * 64,
            "aubiopitch_sha256": "a" * 64,
        }

    def tearDown(self):
        self.tempdir.cleanup()

    def make_settings(self):
        return {
            "source": str(self.source),
            "start_time": 10,
            "duration": 80,
            "twilight_time": 50,
            "lane_rules": {"type": "pattern", "data": [0, 2, 1, 3]},
            "difficulties": {
                "easy": {
                    "minimum_delta": 10,
                    "stride": 1,
                    "lane_mapping": {"pitch_following": 0},
                },
                "normal": {
                    "minimum_delta": 10,
                    "stride": 1,
                    "lane_mapping": {"pitch_following": 1},
                },
                "hard": {
                    "minimum_delta": 10,
                    "stride": 1,
                    "lane_mapping": {"pitch_following": 4},
                },
            },
        }

    def write_config(self):
        self.song_config.write_text(
            json.dumps({"schema_version": 2, "songs": {self.song_id: self.settings}}),
            encoding="utf-8",
        )

    def add_output_patches(self, stack):
        stack.enter_context(
            patch.object(beat_chart, "DEFAULT_GENERATED_DIR", self.generated_dir)
        )
        stack.enter_context(patch.object(beat_chart, "DEFAULT_ONSETS_DIR", self.onsets_dir))
        stack.enter_context(
            patch.object(
                beat_chart, "DEFAULT_PITCH_CACHE_DIR", self.pitch_cache_dir, create=True
            )
        )
        stack.enter_context(
            patch.object(beat_chart, "DEFAULT_REPORTS_DIR", self.reports_dir, create=True)
        )
        stack.enter_context(
            patch.object(
                beat_chart,
                "DEFAULT_DIFFICULTY_PROFILES",
                self.profile_path,
            )
        )

    @staticmethod
    def pitch_stdout():
        rows = []
        sample_index = 0
        while sample_index <= 1000:
            timestamp = sample_index / 100
            # An initial zero-pitch/silent section tests that zero estimates are
            # retained in the cache and treated as unknown, not dropped as data.
            pitch = 0 if timestamp < 2 else 48 + int(timestamp // 0.8) % 4
            rows.append(f"{timestamp:.2f} {pitch}")
            sample_index += 1
        return "\n".join(rows) + "\n"

    def make_runner(
        self,
        *,
        fail_pitch=False,
        mutate_source_on_pitch=False,
        pitch_zero=False,
    ):
        def runner(command, **kwargs):
            command = [str(part) for part in command]
            executable = Path(command[0]).name
            self.calls.append((command, kwargs))
            if executable == "ffprobe":
                return subprocess.CompletedProcess(command, 0, "10.0\n", "")
            if executable == "ffmpeg":
                output = Path(command[-1])
                self.wav_outputs.append(output)
                with wave.open(str(output), "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(22050)
                    wav.writeframes(b"\x00\x00" * 4410)
                return subprocess.CompletedProcess(command, 0, "", "")
            if executable == "aubioonset":
                onsets = [0.4 + index * 0.2 for index in range(47)]
                return subprocess.CompletedProcess(
                    command, 0, "\n".join(map(str, onsets)) + "\n", ""
                )
            if executable == "aubiopitch":
                if mutate_source_on_pitch:
                    self.source.write_bytes(b"source changed during pitch extraction")
                if fail_pitch:
                    return subprocess.CompletedProcess(command, 1, "", "synthetic pitch failure")
                stdout = (
                    "".join(f"{index / 100:.2f} 0\n" for index in range(1001))
                    if pitch_zero
                    else self.pitch_stdout()
                )
                return subprocess.CompletedProcess(command, 0, stdout, "")
            if executable in {"--version", "-version", "-h", "--help"}:
                return subprocess.CompletedProcess(command, 0, "synthetic tool identity\n", "")
            raise AssertionError(f"unexpected subprocess: {command!r}")

        return runner

    def generate(
        self,
        *,
        check=False,
        runner=None,
        identity=None,
        recipe_version="yinfft-midi-v1",
        recipe_args=None,
        fail_identity=False,
    ):
        identity = self.identity if identity is None else identity
        identity_calls = []

        def identity_provider(*_args, **_kwargs):
            identity_calls.append(True)
            if fail_identity:
                raise AssertionError("check mode must not resolve current tool identity")
            return dict(identity)

        from contextlib import ExitStack

        with ExitStack() as stack:
            self.add_output_patches(stack)
            stack.enter_context(
                patch.object(
                    beat_chart,
                    "_pitch_tool_identity",
                    side_effect=identity_provider,
                    create=True,
                )
            )
            stack.enter_context(
                patch.object(
                    beat_chart,
                    "PITCH_RECIPE_VERSION",
                    recipe_version,
                    create=True,
                )
            )
            stack.enter_context(
                patch.object(
                    beat_chart,
                    "PITCH_RECIPE_ARGS",
                    DEFAULT_RECIPE_ARGS if recipe_args is None else recipe_args,
                    create=True,
                )
            )
            argv = ["--song-config", str(self.song_config), "--all"]
            if check:
                argv.append("--check")
            result = beat_chart.main(argv, runner=runner or self.make_runner())
        return result, identity_calls

    def pitch_calls(self):
        return [call for call in self.calls if Path(call[0][0]).name == "aubiopitch"]

    def onset_cache_path(self):
        return self.onsets_dir / f"{self.song_id}.beats.json"

    def generated_path(self):
        return self.generated_dir / f"{self.song_id}.charts.json"

    def report_path(self):
        return self.reports_dir / f"{self.song_id}.lanes.json"

    def pitch_cache_files(self):
        return sorted(self.pitch_cache_dir.rglob("*.json"))

    def published_snapshot(self):
        result = {}
        for directory in (
            self.generated_dir,
            self.onsets_dir,
            self.pitch_cache_dir,
            self.reports_dir,
        ):
            if directory.exists():
                for path in directory.rglob("*"):
                    if path.is_file():
                        result[path] = (path.read_bytes(), path.stat().st_mtime_ns)
        return result

    def test_generate_extracts_once_for_three_difficulties_and_reports_full_source(self):
        runner = self.make_runner()
        result, _ = self.generate(runner=runner)
        self.assertEqual(result, 0)

        self.assertEqual(len(self.pitch_calls()), 1)
        self.assertEqual(len(self.pitch_cache_files()), 1)
        self.assertTrue(self.report_path().exists(), "generation must publish a lane report")
        cache = json.loads(self.pitch_cache_files()[0].read_text(encoding="utf-8"))
        self.assertEqual(cache["source_sha256"], hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertEqual(cache["recipe_version"], "yinfft-midi-v1")
        self.assertEqual(cache["normalized_args"], DEFAULT_RECIPE_ARGS)
        self.assertEqual(cache["tool_identity"], self.identity)
        self.assertEqual(len(cache["analysis_key"]), 64)
        self.assertEqual(len(cache["payload_sha256"]), 64)
        self.assertGreaterEqual(cache["frames"][0]["time"], 0)
        self.assertEqual(cache["frames"][0]["time"], 0)
        self.assertGreaterEqual(cache["frames"][-1]["time"], 9.9)
        self.assertTrue(any(frame["pitch"] == 0 for frame in cache["frames"]))

        bundle = json.loads(self.generated_path().read_text(encoding="utf-8"))
        self.assertEqual(set(bundle["charts"]), set(DIFFICULTIES))
        report = json.loads(self.report_path().read_text(encoding="utf-8"))
        self.assertEqual(report["pitch_analysis_key"], cache["analysis_key"])
        self.assertTrue(report["mapper_version"])
        self.assertEqual(set(report["controls"]), set(DIFFICULTIES))
        self.assertEqual(report["controls"]["easy"]["pitch_following"], 0)
        self.assertEqual(report["controls"]["normal"]["pitch_following"], 1)
        self.assertEqual(report["controls"]["hard"]["pitch_following"], 4)
        self.assertEqual(report["controls"]["easy"]["lane_balance"], 1)
        self.assertEqual(set(report["metrics"]), set(DIFFICULTIES))

        onset_data = json.loads(self.onset_cache_path().read_text(encoding="utf-8"))
        profiles = beat_chart.load_difficulty_profiles(self.profile_path)
        for difficulty in DIFFICULTIES:
            expected, _, _ = beat_chart._difficulty_chart(
                onset_data["onsets"],
                self.settings,
                onset_data["source_duration_seconds"],
                profiles[difficulty],
                difficulty,
                self.song_id,
                onset_data["source_sha256"],
            )
            actual = bundle["charts"][difficulty]
            self.assertEqual(
                {key: value for key, value in actual.items() if key != "notes"},
                {key: value for key, value in expected.items() if key != "notes"},
            )
            self.assertEqual(
                [(note["id"], note["time"]) for note in actual["notes"]],
                [(note["id"], note["time"]) for note in expected["notes"]],
            )
            fallback_lanes = [note["lane"] for note in expected["notes"]]
            self.assertTrue(all(lane in range(4) for lane in fallback_lanes))
            self.assertIn(difficulty, report["metrics"])

        pitch_call = self.pitch_calls()[0]
        timeout = pitch_call[1].get("timeout")
        self.assertIsInstance(timeout, (int, float))
        self.assertGreater(timeout, 0)
        self.assertTrue(all(not path.exists() for path in self.wav_outputs))

    def test_omitted_difficulty_controls_resolve_defaults_for_every_difficulty(self):
        for difficulty in DIFFICULTIES:
            self.settings["difficulties"][difficulty].pop("lane_mapping")
        self.write_config()

        result, _ = self.generate(runner=self.make_runner())
        self.assertEqual(result, 0)
        self.assertEqual(len(self.pitch_calls()), 1)
        report = json.loads(self.report_path().read_text(encoding="utf-8"))
        expected_defaults = {
            "pitch_following": 1,
            "lane_balance": 1,
            "repetition_avoidance": 1,
            "wide_jump_avoidance": 1,
            "adaptation_block_notes": 32,
        }
        self.assertEqual(
            report["controls"],
            {difficulty: expected_defaults for difficulty in DIFFICULTIES},
        )

    def test_controls_stride_and_profile_edits_reuse_full_source_pitch_cache(self):
        first_runner = self.make_runner()
        first_result, _ = self.generate(runner=first_runner)
        self.assertEqual(first_result, 0)
        self.assertEqual(len(self.pitch_cache_files()), 1)
        self.assertTrue(self.report_path().exists())
        first_cache = json.loads(self.pitch_cache_files()[0].read_text(encoding="utf-8"))
        first_bundle = json.loads(self.generated_path().read_text(encoding="utf-8"))
        first_report = self.report_path().read_bytes()

        self.settings["difficulties"]["normal"]["lane_mapping"] = {
            "pitch_following": 4
        }
        self.settings["difficulties"]["normal"]["stride"] = 2
        self.write_config()
        profiles = json.loads(self.profile_path.read_text(encoding="utf-8"))
        profiles["profiles"]["normal"]["twilight"]["perfect"]["damage"] += 1
        self.profile_path.write_text(json.dumps(profiles), encoding="utf-8")

        self.calls.clear()
        second_result, _ = self.generate(runner=self.make_runner())
        self.assertEqual(second_result, 0)
        self.assertEqual(len(self.pitch_calls()), 0)
        self.assertEqual(len(self.pitch_cache_files()), 1)
        second_cache = json.loads(self.pitch_cache_files()[0].read_text(encoding="utf-8"))
        second_bundle = json.loads(self.generated_path().read_text(encoding="utf-8"))
        second_report = self.report_path().read_bytes()
        self.assertEqual(first_cache["analysis_key"], second_cache["analysis_key"])
        self.assertNotEqual(
            first_bundle["charts"]["normal"]["notes"],
            second_bundle["charts"]["normal"]["notes"],
        )
        self.assertNotIn("twilightStrength", second_bundle["charts"]["normal"])
        self.assertNotEqual(first_report, second_report)

    def test_source_recipe_arguments_and_tool_identity_each_change_analysis_key(self):
        self.assertEqual(self.generate()[0], 0)
        self.assertEqual(len(self.pitch_cache_files()), 1)
        initial = json.loads(self.pitch_cache_files()[0].read_text(encoding="utf-8"))
        keys = {initial["analysis_key"]}

        self.calls.clear()
        args = {**DEFAULT_RECIPE_ARGS, "buffer_size": 1024}
        self.assertEqual(
            self.generate(recipe_args=args, runner=self.make_runner())[0], 0
        )
        changed_args = [
            json.loads(path.read_text(encoding="utf-8"))
            for path in self.pitch_cache_files()
        ]
        self.assertEqual(len(changed_args), 2)
        keys.add(next(item["analysis_key"] for item in changed_args if item["normalized_args"] == args))

        self.calls.clear()
        new_identity = {**self.identity, "aubiopitch_sha256": "b" * 64}
        self.assertEqual(
            self.generate(identity=new_identity, recipe_args=args, runner=self.make_runner())[0],
            0,
        )
        changed_identity = [
            json.loads(path.read_text(encoding="utf-8"))
            for path in self.pitch_cache_files()
        ]
        self.assertEqual(len(changed_identity), 3)
        keys.add(
            next(
                item["analysis_key"]
                for item in changed_identity
                if item["tool_identity"] == new_identity
            )
        )

        self.source.write_bytes(b"a changed full source with new content hash")
        self.onset_cache_path().unlink()
        self.calls.clear()
        self.assertEqual(
            self.generate(identity=new_identity, recipe_args=args, runner=self.make_runner())[0],
            0,
        )
        changed_source = [
            json.loads(path.read_text(encoding="utf-8"))
            for path in self.pitch_cache_files()
        ]
        self.assertEqual(len(changed_source), 4)
        keys.add(
            next(
                item["analysis_key"]
                for item in changed_source
                if item["source_sha256"] == hashlib.sha256(self.source.read_bytes()).hexdigest()
            )
        )
        self.assertEqual(len(keys), 4)
        self.assertEqual(len(self.pitch_cache_files()), 4)

    def test_check_mode_uses_cache_without_tools_identity_resolution_or_writes(self):
        self.assertEqual(self.generate()[0], 0)
        self.assertEqual(len(self.pitch_cache_files()), 1)
        self.assertTrue(self.report_path().exists())
        before = self.published_snapshot()
        self.calls.clear()
        result, identity_calls = self.generate(
            check=True,
            runner=self.make_runner(),
            fail_identity=True,
        )
        self.assertEqual(result, 0)
        self.assertEqual(self.calls, [])
        self.assertEqual(identity_calls, [])
        self.assertEqual(self.published_snapshot(), before)

    def test_check_mode_rejects_corrupt_pitch_payload_without_tools_or_writes(self):
        self.assertEqual(self.generate()[0], 0)
        self.assertEqual(len(self.pitch_cache_files()), 1)
        cache_path = self.pitch_cache_files()[0]
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        original = cache["frames"][0]["pitch"]
        cache["frames"][0]["pitch"] = 1 if original != 1 else 2
        cache_path.write_text(json.dumps(cache), encoding="utf-8")
        before = self.published_snapshot()
        self.calls.clear()

        result, identity_calls = self.generate(
            check=True,
            runner=self.make_runner(),
            fail_identity=True,
        )
        self.assertNotEqual(result, 0)
        self.assertEqual(self.calls, [])
        self.assertEqual(identity_calls, [])
        self.assertEqual(self.published_snapshot(), before)

    def test_pitch_extraction_failure_preserves_published_outputs_and_cleans_temp_audio(self):
        self.assertEqual(self.generate()[0], 0)
        self.assertEqual(len(self.pitch_cache_files()), 1)
        self.assertTrue(self.report_path().exists())
        before = self.published_snapshot()
        self.calls.clear()
        self.wav_outputs.clear()
        result, _ = self.generate(
            recipe_args={**DEFAULT_RECIPE_ARGS, "buffer_size": 1024},
            runner=self.make_runner(fail_pitch=True),
        )
        self.assertNotEqual(result, 0)
        self.assertEqual(len(self.pitch_calls()), 1)
        self.assertEqual(self.published_snapshot(), before)
        self.assertTrue(self.wav_outputs)
        self.assertTrue(all(not path.exists() for path in self.wav_outputs))

    def test_source_change_during_pitch_analysis_blocks_staged_publication(self):
        self.assertEqual(self.generate()[0], 0)
        self.assertEqual(len(self.pitch_cache_files()), 1)
        self.assertTrue(self.report_path().exists())
        before = self.published_snapshot()
        original_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.calls.clear()
        self.wav_outputs.clear()
        result, _ = self.generate(
            recipe_args={**DEFAULT_RECIPE_ARGS, "buffer_size": 1024},
            runner=self.make_runner(mutate_source_on_pitch=True),
        )
        self.assertNotEqual(result, 0)
        self.assertEqual(len(self.pitch_calls()), 1)
        self.assertNotEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), original_hash)
        self.assertEqual(self.published_snapshot(), before)
        self.assertTrue(all(not path.exists() for path in self.wav_outputs))

    def test_report_and_chart_bytes_are_deterministic_across_cached_generation(self):
        self.assertEqual(self.generate()[0], 0)
        self.assertEqual(len(self.pitch_cache_files()), 1)
        self.assertTrue(self.report_path().exists())
        before = {
            self.generated_path(): self.generated_path().read_bytes(),
            self.report_path(): self.report_path().read_bytes(),
        }
        self.calls.clear()
        self.assertEqual(self.generate(runner=self.make_runner())[0], 0)
        self.assertEqual(
            {path: path.read_bytes() for path in before},
            before,
        )
        self.assertEqual(len(self.pitch_calls()), 0)

    def test_unknown_full_source_pitch_uses_authored_cyclic_fallback(self):
        zero_controls = {
            "pitch_following": 0,
            "lane_balance": 0,
            "repetition_avoidance": 0,
            "wide_jump_avoidance": 0,
        }
        for difficulty in DIFFICULTIES:
            self.settings["difficulties"][difficulty]["lane_mapping"] = dict(
                zero_controls
            )
        self.write_config()
        result, _ = self.generate(runner=self.make_runner(pitch_zero=True))
        self.assertEqual(result, 0)
        self.assertEqual(len(self.pitch_calls()), 1)
        cache = json.loads(self.pitch_cache_files()[0].read_text(encoding="utf-8"))
        self.assertTrue(all(frame["pitch"] == 0 for frame in cache["frames"]))

        bundle = json.loads(self.generated_path().read_text(encoding="utf-8"))
        onset_data = json.loads(self.onset_cache_path().read_text(encoding="utf-8"))
        profiles = beat_chart.load_difficulty_profiles(self.profile_path)
        for difficulty in DIFFICULTIES:
            fallback, _, _ = beat_chart._difficulty_chart(
                onset_data["onsets"],
                self.settings,
                onset_data["source_duration_seconds"],
                profiles[difficulty],
                difficulty,
                self.song_id,
                onset_data["source_sha256"],
            )
            self.assertEqual(
                [note["lane"] for note in bundle["charts"][difficulty]["notes"]],
                [note["lane"] for note in fallback["notes"]],
            )

    def test_direct_script_import_can_invoke_pitch_mapper_without_repository_root(self):
        scripts_dir = Path(beat_chart.__file__).resolve().parent
        repo_root = beat_chart.PROJECT_ROOT.resolve()
        program = f"""
import pathlib
import sys
repo_root = pathlib.Path({str(repo_root)!r})
scripts_dir = pathlib.Path({str(scripts_dir)!r})
sys.path[:] = [
    entry for entry in sys.path
    if pathlib.Path(entry or '.').resolve() != repo_root
]
sys.path.insert(0, str(scripts_dir))
assert not any(
    pathlib.Path(entry or '.').resolve() == repo_root for entry in sys.path
)
import beat_chart
records = [
    {{"pitch": None, "coverage": 0.0, "mad": None, "stable": False}}
    for _ in range(2)
]
print(beat_chart._map_pitch_lanes(records, [0, 2], {{
    "pitch_following": 0,
    "lane_balance": 0,
    "repetition_avoidance": 0,
    "wide_jump_avoidance": 0,
}}))
"""
        environment = os.environ.copy()
        environment.pop("PYTHONPATH", None)
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        result = subprocess.run(
            [sys.executable, "-c", program],
            cwd=self.root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "[0, 2]")

    def test_all_inventory_rejects_removed_song_reports_but_allows_old_pitch_cache(self):
        self.assertEqual(self.generate(runner=self.make_runner())[0], 0)
        self.assertTrue(self.report_path().exists())

        removed_report = self.reports_dir / "removed-song.lanes.json"
        removed_report.write_text("historical report\n", encoding="utf-8")
        historical_cache = self.pitch_cache_dir / ("removed-song." + "a" * 64 + ".json")
        historical_cache.write_text("historical pitch cache\n", encoding="utf-8")
        before_check = self.published_snapshot()

        self.calls.clear()
        check_result, identity_calls = self.generate(
            check=True,
            runner=self.make_runner(),
            fail_identity=True,
        )
        check_calls = list(self.calls)
        check_snapshot = self.published_snapshot()

        before_generation = self.published_snapshot()
        self.calls.clear()
        generation_result, _ = self.generate(runner=self.make_runner())
        generation_snapshot = self.published_snapshot()

        with self.subTest(operation="check rejects stale report inventory"):
            self.assertNotEqual(check_result, 0)
            self.assertEqual(check_calls, [])
            self.assertEqual(identity_calls, [])
            self.assertEqual(check_snapshot, before_check)
        with self.subTest(operation="generation rejects stale report inventory"):
            self.assertNotEqual(generation_result, 0)
            self.assertEqual(generation_snapshot, before_generation)

        removed_report.unlink()
        before_valid_check = self.published_snapshot()
        self.calls.clear()
        valid_result, identity_calls = self.generate(
            check=True,
            runner=self.make_runner(),
            fail_identity=True,
        )
        with self.subTest(operation="historical pitch cache is allowed"):
            self.assertEqual(valid_result, 0)
            self.assertEqual(self.calls, [])
            self.assertEqual(identity_calls, [])
            self.assertEqual(self.published_snapshot(), before_valid_check)


if __name__ == "__main__":
    unittest.main()
