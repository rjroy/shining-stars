"""Workflow contract tests using a fake subprocess runner and synthetic input."""

import hashlib
import json
import math
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from scripts import beat_chart, pitch_lanes


def profile_fixture():
    profiles = {}
    for difficulty, perfect_ms, good_ms in (
        ("easy", 20, 80), ("normal", 30, 100), ("hard", 40, 120),
    ):
        profiles[difficulty] = {
            "twilight_strength": 50,
            "timing": {"perfect_ms": perfect_ms, "good_ms": good_ms},
            "audience": {"perfect": 5, "good": 2, "miss": -1},
            "twilight": {
                "perfect": {"personal_cost": 0, "damage": 0},
                "good": {"personal_cost": 1, "damage": 1},
                "miss": {"personal_cost": 2, "damage": 3},
            },
        }
    return {"profiles": profiles}


class BeatChartWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.source = self.root / "source audio.wav"
        self.source.write_bytes(b"synthetic source audio")
        self.artifact = self.root / "data" / "the-first-shining-star.beats.json"
        self.chart = self.root / "src" / "mvp-chart.ts"
        self.calls = []
        self.profile_path = self.root / "difficulty-profiles.json"
        self.profile_path.write_text(json.dumps(profile_fixture()), encoding="utf-8")
        self.profile_patch = patch.object(
            beat_chart, "DEFAULT_DIFFICULTY_PROFILES", self.profile_path
        )
        self.profile_patch.start()
        self.addCleanup(self.profile_patch.stop)
        self.song_config = self.write_song_config(
            {"the-first-shining-star": self.song_settings(self.source)}
        )

    def tearDown(self):
        self.tempdir.cleanup()

    def make_runner(self, aubio_stdout=None, fail=None):
        if aubio_stdout is None:
            aubio_stdout = "\n".join(str(107.1 + index * 0.5) for index in range(20)) + "\n"

        def runner(command, **kwargs):
            command = [str(part) for part in command]
            self.calls.append((command, kwargs))
            executable = Path(command[0]).name
            if fail == executable:
                raise FileNotFoundError(executable)
            if executable == "ffmpeg":
                wav_path = Path(command[-1])
                with wave.open(str(wav_path), "wb") as output:
                    output.setnchannels(1)
                    output.setsampwidth(2)
                    output.setframerate(44100)
                    output.writeframes(b"\x00\x00" * 4410)
                return subprocess.CompletedProcess(command, 0, "", "")
            if executable == "aubioonset":
                code = 1 if fail == "aubioonset-exit" else 0
                return subprocess.CompletedProcess(command, code, aubio_stdout, "bad output")
            raise AssertionError(f"unexpected executable: {executable}")

        return runner

    def args(self, *extra):
        return [
            "--song-config", str(self.song_config),
            str(self.source),
            "--artifact", str(self.artifact),
            "--chart", str(self.chart),
            *extra,
        ]

    def generate(self, runner=None):
        return beat_chart.main(self.args(), runner=runner or self.make_runner())

    def song_settings(self, source):
        return {
            "source": str(source),
            "start_time": 107.1,
            "twilight_time": 39.2,
            "duration": 65.8,
            "twilight_strength": 100,
            "allowed_difficulties": ["normal", "hard"],
            "minimum_delta": 64,
            "stride": 2,
            "algorithm": "complex",
            "minioi": 0.012,
            "threshold": 0.3,
            "silence": -90,
            "lane_rules": {"type": "pattern", "data": [0, 2, 1, 3]},
        }

    def write_song_config(self, songs):
        path = self.root / "song-authoring.json"
        path.write_text(json.dumps({"songs": songs}), encoding="utf-8")
        return path

    def write_two_song_config(self, alternate_source):
        return self.write_song_config(
            {
                "the-first-shining-star": self.song_settings(self.source),
                "another-song": self.song_settings(alternate_source),
            }
        )

    def make_live_destinations(self):
        artifact = self.root / "live-default-artifact.json"
        chart = self.root / "live-default-chart.ts"
        artifact.write_text("live artifact sentinel\n", encoding="utf-8")
        chart.write_text("live chart sentinel\n", encoding="utf-8")
        return artifact, chart, artifact.read_bytes(), chart.read_bytes()

    def test_alternate_song_cannot_write_default_destinations(self):
        alternate_source = self.root / "alternate source.wav"
        alternate_source.write_bytes(b"alternate source audio")
        config = self.write_two_song_config(alternate_source)
        live_artifact, live_chart, artifact_before, chart_before = (
            self.make_live_destinations()
        )
        args = ["--song-config", str(config), "--song", "another-song"]

        with (
            patch.object(beat_chart, "DEFAULT_SOURCE", self.source),
            patch.object(beat_chart, "DEFAULT_ARTIFACT", live_artifact),
            patch.object(beat_chart, "DEFAULT_CHART", live_chart),
        ):
            result = beat_chart.main(args, runner=self.make_runner())

        self.assertNotEqual(result, 0)
        self.assertEqual(self.calls, [], "unsafe generation must fail before tool invocation")
        self.assertEqual(live_artifact.read_bytes(), artifact_before)
        self.assertEqual(live_chart.read_bytes(), chart_before)

    def test_alternate_song_requires_both_outputs_to_be_isolated(self):
        alternate_source = self.root / "alternate source.wav"
        alternate_source.write_bytes(b"alternate source audio")
        config = self.write_two_song_config(alternate_source)

        for explicit_output in ("artifact", "chart"):
            with self.subTest(explicit_output=explicit_output):
                live_artifact, live_chart, artifact_before, chart_before = (
                    self.make_live_destinations()
                )
                isolated = self.root / f"only-{explicit_output}.out"
                args = ["--song-config", str(config), "--song", "another-song"]
                if explicit_output == "artifact":
                    args.extend(["--artifact", str(isolated)])
                else:
                    args.extend(["--chart", str(isolated)])

                with (
                    patch.object(beat_chart, "DEFAULT_SOURCE", self.source),
                    patch.object(beat_chart, "DEFAULT_ARTIFACT", live_artifact),
                    patch.object(beat_chart, "DEFAULT_CHART", live_chart),
                ):
                    result = beat_chart.main(args, runner=self.make_runner())

                self.assertNotEqual(result, 0)
                self.assertEqual(self.calls, [])
                self.assertFalse(isolated.exists())
                self.assertEqual(live_artifact.read_bytes(), artifact_before)
                self.assertEqual(live_chart.read_bytes(), chart_before)

    def test_alternate_song_rejects_explicit_live_destination_even_with_isolated_pair(self):
        alternate_source = self.root / "alternate source.wav"
        alternate_source.write_bytes(b"alternate source audio")
        config = self.write_two_song_config(alternate_source)
        live_artifact, live_chart, artifact_before, chart_before = (
            self.make_live_destinations()
        )
        isolated_chart = self.root / "isolated.ts"

        with (
            patch.object(beat_chart, "DEFAULT_SOURCE", self.source),
            patch.object(beat_chart, "DEFAULT_ARTIFACT", live_artifact),
            patch.object(beat_chart, "DEFAULT_CHART", live_chart),
        ):
            result = beat_chart.main(
                [
                    "--song-config", str(config),
                    "--song", "another-song",
                    "--artifact", str(live_artifact),
                    "--chart", str(isolated_chart),
                ],
                runner=self.make_runner(),
            )

        self.assertNotEqual(result, 0)
        self.assertEqual(self.calls, [])
        self.assertFalse(isolated_chart.exists())
        self.assertEqual(live_artifact.read_bytes(), artifact_before)
        self.assertEqual(live_chart.read_bytes(), chart_before)

    def test_alternate_source_rejects_cross_assigned_live_destination_in_generation_and_check(self):
        alternate_source = self.root / "alternate source.wav"
        alternate_source.write_bytes(b"alternate source audio")
        config = self.write_two_song_config(alternate_source)
        live_artifact, live_chart, _, _ = self.make_live_destinations()
        isolated = self.root / "isolated-cross-output.out"
        cases = (
            ("artifact argument targets live chart", [str(live_chart), str(isolated)]),
            ("chart argument targets live artifact", [str(isolated), str(live_artifact)]),
        )

        for mode in ("generate", "check"):
            for label, (artifact_path, chart_path) in cases:
                with self.subTest(mode=mode, case=label):
                    self.calls.clear()
                    live_artifact.write_text("live artifact sentinel\n", encoding="utf-8")
                    live_chart.write_text("live chart sentinel\n", encoding="utf-8")
                    artifact_before = live_artifact.read_bytes()
                    chart_before = live_chart.read_bytes()
                    args = [
                        "--song-config", str(config),
                        "--song", "another-song",
                        "--artifact", artifact_path,
                        "--chart", chart_path,
                    ]
                    if mode == "check":
                        args.append("--check")

                    with (
                        patch.object(beat_chart, "DEFAULT_SOURCE", self.source),
                        patch.object(beat_chart, "DEFAULT_ARTIFACT", live_artifact),
                        patch.object(beat_chart, "DEFAULT_CHART", live_chart),
                        patch.object(
                            beat_chart, "_sha256_file", wraps=beat_chart._sha256_file
                        ) as hash_file,
                    ):
                        result = beat_chart.main(args, runner=self.make_runner())

                    self.assertNotEqual(result, 0)
                    hash_file.assert_not_called()
                    self.assertEqual(self.calls, [])
                    self.assertEqual(live_artifact.read_bytes(), artifact_before)
                    self.assertEqual(live_chart.read_bytes(), chart_before)
                    self.assertFalse(isolated.exists())

    def test_other_configured_song_succeeds_with_isolated_outputs(self):
        alternate_source = self.root / "alternate source.wav"
        alternate_source.write_bytes(b"alternate source audio")
        config = self.write_two_song_config(alternate_source)
        live_artifact, live_chart, _, _ = self.make_live_destinations()
        isolated_artifact = self.root / "isolated" / "another-song.json"
        isolated_chart = self.root / "isolated" / "another-song.ts"
        args = [
            "--song-config", str(config),
            "--song", "another-song",
            "--artifact", str(isolated_artifact),
            "--chart", str(isolated_chart),
        ]

        with (
            patch.object(beat_chart, "DEFAULT_SOURCE", self.source),
            patch.object(beat_chart, "DEFAULT_ARTIFACT", live_artifact),
            patch.object(beat_chart, "DEFAULT_CHART", live_chart),
        ):
            self.assertEqual(beat_chart.main(args, runner=self.make_runner()), 0)
            self.calls.clear()
            self.assertEqual(
                beat_chart.main([*args, "--check"], runner=self.make_runner()), 0
            )

        artifact = json.loads(isolated_artifact.read_text(encoding="utf-8"))
        self.assertEqual(artifact["config"]["song_id"], "another-song")
        self.assertEqual(artifact["source"]["path"], str(alternate_source.resolve()))
        self.assertEqual(self.calls, [])

    def test_alternate_song_id_for_runtime_source_may_use_live_outputs(self):
        config = self.write_two_song_config(self.source)
        live_artifact, live_chart, _, _ = self.make_live_destinations()
        args = ["--song-config", str(config), "--song", "another-song"]

        with (
            patch.object(beat_chart, "DEFAULT_SOURCE", self.source),
            patch.object(beat_chart, "DEFAULT_ARTIFACT", live_artifact),
            patch.object(beat_chart, "DEFAULT_CHART", live_chart),
        ):
            self.assertEqual(beat_chart.main(args, runner=self.make_runner()), 0)
            self.assertEqual(beat_chart.main([*args, "--check"]), 0)

        artifact = json.loads(live_artifact.read_text(encoding="utf-8"))
        self.assertEqual(artifact["config"]["song_id"], "another-song")
        self.assertEqual(artifact["source"]["path"], str(self.source.resolve()))

    def test_alternate_song_check_rejects_defaults_before_hash_or_file_access(self):
        alternate_source = self.root / "alternate source.wav"
        alternate_source.write_bytes(b"alternate source audio")
        config = self.write_two_song_config(alternate_source)
        live_artifact, live_chart, artifact_before, chart_before = (
            self.make_live_destinations()
        )

        with (
            patch.object(beat_chart, "DEFAULT_SOURCE", self.source),
            patch.object(beat_chart, "DEFAULT_ARTIFACT", live_artifact),
            patch.object(beat_chart, "DEFAULT_CHART", live_chart),
            patch.object(beat_chart, "_sha256_file", wraps=beat_chart._sha256_file) as hash_file,
        ):
            result = beat_chart.main(
                ["--song-config", str(config), "--song", "another-song", "--check"],
                runner=self.make_runner(),
            )

        self.assertNotEqual(result, 0)
        hash_file.assert_not_called()
        self.assertEqual(self.calls, [])
        self.assertEqual(live_artifact.read_bytes(), artifact_before)
        self.assertEqual(live_chart.read_bytes(), chart_before)

    def test_source_override_requires_two_isolated_outputs_but_can_check_them(self):
        alternate_source = self.root / "alternate source.wav"
        alternate_source.write_bytes(b"alternate source audio")
        config = self.write_song_config(
            {"the-first-shining-star": self.song_settings(self.source)}
        )
        live_artifact, live_chart, artifact_before, chart_before = (
            self.make_live_destinations()
        )
        common_args = ["--song-config", str(config), "--source", str(alternate_source)]

        with (
            patch.object(beat_chart, "DEFAULT_SOURCE", self.source),
            patch.object(beat_chart, "DEFAULT_ARTIFACT", live_artifact),
            patch.object(beat_chart, "DEFAULT_CHART", live_chart),
        ):
            unsafe_result = beat_chart.main(common_args, runner=self.make_runner())

        self.assertNotEqual(unsafe_result, 0)
        self.assertEqual(self.calls, [])
        self.assertEqual(live_artifact.read_bytes(), artifact_before)
        self.assertEqual(live_chart.read_bytes(), chart_before)

        isolated_artifact = self.root / "isolated" / "alternate.json"
        isolated_chart = self.root / "isolated" / "alternate.ts"
        isolated_args = [
            *common_args,
            "--artifact", str(isolated_artifact),
            "--chart", str(isolated_chart),
        ]
        with (
            patch.object(beat_chart, "DEFAULT_SOURCE", self.source),
            patch.object(beat_chart, "DEFAULT_ARTIFACT", live_artifact),
            patch.object(beat_chart, "DEFAULT_CHART", live_chart),
        ):
            self.assertEqual(
                beat_chart.main(isolated_args, runner=self.make_runner()), 0
            )
            self.calls.clear()
            self.assertEqual(
                beat_chart.main(
                    [*isolated_args, "--check"], runner=self.make_runner()
                ),
                0,
            )

        artifact = json.loads(isolated_artifact.read_text(encoding="utf-8"))
        self.assertEqual(artifact["source"]["path"], str(alternate_source.resolve()))
        self.assertEqual(self.calls, [], "check mode must not invoke external tools")

    def test_aubioonset_command_explicitly_sets_detector_minimum_ioi_and_silence(self):
        recipe = {"algorithm": "specflux", "minioi": 0.023456789012345, "threshold": 0.456789012345, "silence": -83.25}
        _, command = beat_chart._build_commands(self.source, self.root / "analysis.wav", recipe)
        self.assertEqual(
            command[:5],
            [
                "aubioonset", "-T", "seconds", "-O", "specflux",
            ],
        )
        self.assertIn(f"-t{recipe['threshold']}", command)
        self.assertIn(f"-M{recipe['minioi']}", command)
        self.assertIn(f"-s{recipe['silence']}", command)

    def seed_outputs(self):
        self.artifact.parent.mkdir(parents=True, exist_ok=True)
        self.chart.parent.mkdir(parents=True, exist_ok=True)
        self.artifact.write_text("prior artifact\n", encoding="utf-8")
        self.chart.write_text("prior chart\n", encoding="utf-8")
        return self.artifact.read_bytes(), self.chart.read_bytes()

    def test_generates_provenance_artifact_and_chart_from_full_track_onsets(self):
        self.assertEqual(self.generate(), 0)
        artifact = json.loads(self.artifact.read_text(encoding="utf-8"))
        expected_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.assertEqual(artifact["source_sha256"], expected_hash)
        self.assertEqual(len(artifact["onsets"]), 20)
        self.assertEqual(
            [note["source_onset_index"] for note in artifact["notes"]],
            [2, 4, 6, 8, 10, 12, 14, 16, 18],
        )
        self.assertEqual(
            [note["relative_time"] for note in artifact["notes"]],
            [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0],
        )
        chart = self.chart.read_text(encoding="utf-8")
        for note in artifact["notes"]:
            self.assertIn(f"time: {note['relative_time']:.6f}", chart)
        self.assertEqual(len(artifact["commands"]), 2)
        ffmpeg_command, aubio_command = artifact["commands"]
        self.assertEqual(Path(ffmpeg_command[0]).name, "ffmpeg")
        self.assertEqual(Path(aubio_command[0]).name, "aubioonset")

        ffmpeg_call = self.calls[0][0]
        self.assertEqual(ffmpeg_call[ffmpeg_call.index("-i") + 1], str(self.source))
        self.assertFalse(any(flag in ("-ss", "-t") for flag in ffmpeg_call))
        self.assertEqual(ffmpeg_call[ffmpeg_call.index("-ac") + 1], "1")
        self.assertEqual(ffmpeg_call[ffmpeg_call.index("-ar") + 1], "44100")
        self.assertEqual(ffmpeg_call[ffmpeg_call.index("-sample_fmt") + 1], "s16")
        aubio_call = self.calls[1][0]
        self.assertEqual(aubio_call[aubio_call.index("-T") + 1], "seconds")
        expected_recipe = beat_chart.ONSET_DEFAULTS
        self.assertEqual(aubio_call[aubio_call.index("-O") + 1], expected_recipe["algorithm"])
        self.assertIn(f"-M{expected_recipe['minioi']}", aubio_call)
        self.assertIn(f"-s{expected_recipe['silence']}", aubio_call)
        wav_path = Path(aubio_call[aubio_call.index("-i") + 1])
        self.assertFalse(wav_path.exists(), "temporary WAV should be removed after tracking")

    def test_identical_inputs_produce_identical_artifact_and_chart(self):
        self.assertEqual(self.generate(), 0)
        first_artifact = self.artifact.read_bytes()
        first_chart = self.chart.read_bytes()
        self.calls.clear()
        self.assertEqual(self.generate(), 0)
        self.assertEqual(self.artifact.read_bytes(), first_artifact)
        self.assertEqual(self.chart.read_bytes(), first_chart)

    def test_check_mode_validates_cached_outputs_without_running_tools(self):
        self.assertEqual(self.generate(), 0)
        self.calls.clear()
        self.assertEqual(beat_chart.main(self.args("--check"), runner=self.make_runner()), 0)
        self.assertEqual(self.calls, [])

    def test_check_mode_rejects_changed_source_hash_without_running_tools(self):
        self.assertEqual(self.generate(), 0)
        self.source.write_bytes(b"changed source")
        old_artifact, old_chart = self.artifact.read_bytes(), self.chart.read_bytes()
        self.calls.clear()
        self.assertNotEqual(
            beat_chart.main(self.args("--check"), runner=self.make_runner()), 0
        )
        self.assertEqual(self.calls, [])
        self.assertEqual((self.artifact.read_bytes(), self.chart.read_bytes()), (old_artifact, old_chart))

    def test_check_mode_rejects_stale_chart_without_running_tools(self):
        self.assertEqual(self.generate(), 0)
        self.chart.write_text("stale chart", encoding="utf-8")
        self.calls.clear()
        self.assertNotEqual(
            beat_chart.main(self.args("--check"), runner=self.make_runner()), 0
        )
        self.assertEqual(self.calls, [])

    def test_bad_aubio_output_does_not_overwrite_existing_outputs(self):
        prior = self.seed_outputs()
        runner = self.make_runner(aubio_stdout="header\n1.0\n")
        self.assertNotEqual(self.generate(runner), 0)
        self.assertEqual(len(self.calls), 2, "workflow should invoke and validate both tools")
        self.assertEqual((self.artifact.read_bytes(), self.chart.read_bytes()), prior)
        self.assertFalse(Path(self.calls[0][0][-1]).exists())

    def test_process_failure_cleans_temporary_wav_and_preserves_outputs(self):
        prior = self.seed_outputs()
        self.assertNotEqual(self.generate(self.make_runner(fail="aubioonset-exit")), 0)
        self.assertEqual(len(self.calls), 2, "workflow should invoke both configured tools")
        wav_path = Path(self.calls[0][0][-1])
        self.assertFalse(wav_path.exists())
        self.assertEqual((self.artifact.read_bytes(), self.chart.read_bytes()), prior)

    def test_missing_tracking_tool_preserves_outputs_and_cleans_temporary_wav(self):
        prior = self.seed_outputs()
        self.assertNotEqual(self.generate(self.make_runner(fail="aubioonset")), 0)
        self.assertEqual(len(self.calls), 2, "workflow should attempt tracking after WAV extraction")
        wav_path = Path(self.calls[0][0][-1])
        self.assertFalse(wav_path.exists())
        self.assertEqual((self.artifact.read_bytes(), self.chart.read_bytes()), prior)

    def test_song_authoring_json_selects_song_and_invokes_aubioonset(self):
        song_id = "the-first-shining-star"
        config_path = self.root / "song-authoring.json"
        config_path.write_text(
            json.dumps(
                {
                    "songs": {
                        song_id: self.song_settings(self.source),
                    }
                }
            ),
            encoding="utf-8",
        )
        offsets_ms = [0, 12, 64, 128, 200, 300, 315, 400]
        stdout = "\n".join(
            str(107.1 + 1.0 + offset / 1000) for offset in offsets_ms
        )

        def runner(command, **kwargs):
            command = [str(part) for part in command]
            self.calls.append((command, kwargs))
            executable = Path(command[0]).name
            if executable == "ffmpeg":
                with wave.open(command[-1], "wb") as output:
                    output.setnchannels(1)
                    output.setsampwidth(2)
                    output.setframerate(44100)
                    output.writeframes(b"\x00\x00" * 4410)
                return subprocess.CompletedProcess(command, 0, "", "")
            if executable == "aubioonset":
                return subprocess.CompletedProcess(command, 0, stdout, "")
            raise AssertionError(f"unexpected executable: {executable}")

        result = beat_chart.main(
            [
                "--song-config", str(config_path),
                "--song", song_id,
                "--artifact", str(self.artifact),
                "--chart", str(self.chart),
            ],
            runner=runner,
        )

        self.assertEqual(result, 0)
        aubio_command = self.calls[1][0]
        self.assertEqual(Path(aubio_command[0]).name, "aubioonset")
        self.assertEqual(aubio_command[aubio_command.index("-T") + 1], "seconds")
        artifact = json.loads(self.artifact.read_text(encoding="utf-8"))
        self.assertEqual(
            [note["source_onset_index"] for note in artifact["notes"]], [0, 3, 5]
        )
        self.assertEqual(
            [note["source_time"] for note in artifact["notes"]],
            [107.1 + 1.0, 107.1 + 1.128, 107.1 + 1.3],
        )
        self.assertEqual(artifact["config"]["twilight_strength"], 100)
        self.assertEqual(
            artifact["config"]["allowed_difficulties"], ["normal", "hard"]
        )
        self.assertEqual(
            artifact["config"]["maximum_allowed_good_window_ms"],
            max(
                beat_chart.load_difficulty_profiles()[difficulty]["timing"]["good_ms"]
                for difficulty in artifact["config"]["allowed_difficulties"]
            ),
        )
        self.assertIn("twilightStrength: 100", self.chart.read_text(encoding="utf-8"))
        self.assertIn(
            "allowedDifficulties: ['normal', 'hard']",
            self.chart.read_text(encoding="utf-8"),
        )

    def test_cached_chart_settings_depend_on_allowed_profile_timing(self):
        profile_path = self.root / "difficulty-profiles.json"
        profile_document = profile_fixture()
        profile_path.write_text(json.dumps(profile_document), encoding="utf-8")
        song_config = self.write_song_config(
            {"the-first-shining-star": self.song_settings(self.source)}
        )
        args = [*self.args(), "--song-config", str(song_config)]

        with patch.object(beat_chart, "DEFAULT_DIFFICULTY_PROFILES", profile_path):
            self.assertEqual(beat_chart.main(args, runner=self.make_runner()), 0)
            profile_document["profiles"]["normal"]["timing"]["good_ms"] = 170
            profile_path.write_text(json.dumps(profile_document), encoding="utf-8")
            self.calls.clear()

            self.assertNotEqual(
                beat_chart.main([*args, "--check"], runner=self.make_runner()), 0
            )

        self.assertEqual(self.calls, [], "profile changes must invalidate cache without tools")


class GeneratedScoringMetadataTests(unittest.TestCase):
    """Exercise the bulk generator with local source/cache fixtures only."""

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.source = self.root / "source.mp3"
        self.source.write_bytes(b"synthetic source audio")
        self.song_id = "scoring-fixture"
        self.config = self.root / "song-authoring.json"
        settings = {
            "source": str(self.source),
            "start_time": 0,
            "duration": 100,
            "twilight_time": 50,
            "lane_rules": {"type": "pattern", "data": [0, 2, 1, 3]},
            "difficulties": {
                difficulty: {
                    "minimum_delta": 64,
                    "stride": 1,
                }
                for difficulty in beat_chart.DIFFICULTIES
            },
        }
        self.config.write_text(
            json.dumps({"schema_version": 2, "songs": {self.song_id: settings}}),
            encoding="utf-8",
        )
        self.generated_dir = self.root / "generated"
        self.onsets_dir = self.root / "onsets"
        self.reports_dir = self.root / "reports"
        self.pitch_dir = self.root / "pitch"
        self.profile_path = self.root / "difficulty-profiles.json"
        self.profile_path.write_text(json.dumps(profile_fixture()), encoding="utf-8")
        self.normal_note_time = 1.0
        self.patches = patch.multiple(
            beat_chart,
            DEFAULT_GENERATED_DIR=self.generated_dir,
            DEFAULT_ONSETS_DIR=self.onsets_dir,
            DEFAULT_REPORTS_DIR=self.reports_dir,
            DEFAULT_PITCH_CACHE_DIR=self.pitch_dir,
            DEFAULT_DIFFICULTY_PROFILES=self.profile_path,
            _analysis_for_song=self.analysis_cache,
            _pitch_analysis_for_song=self.pitch_cache,
            _source_duration=lambda _source, _runner: 10.0,
            _difficulty_chart=self.chart_for_difficulty,
        )
        self.patches.start()
        self.addCleanup(self.patches.stop)

    def tearDown(self):
        self.tempdir.cleanup()

    def analysis_cache(self, _song_id, settings, _source, _digest, _runner, _check, _path):
        return {
            "onsets": [1.0, 2.0, 3.0],
            "source_duration_seconds": 10.0,
            "projection": {
                "song": settings,
                "profile_sha256": beat_chart._profile_file_hash(),
            },
            "pitch_analysis_key": "a" * 64,
        }

    @staticmethod
    def pitch_cache(_song_id, _source, _digest, _runner, _check, _onsets):
        return {"analysis_key": "a" * 64, "frames": []}

    def chart_for_difficulty(
        self, _onsets, _settings, _duration, _profile, difficulty, _song_id,
        _digest, _frames, with_analysis=False,
    ):
        note_time = self.normal_note_time if difficulty == "normal" else 2.0
        chart = {
            "sourceStart": 0,
            "duration": 10,
            "twilightAt": 5,
            "twilightStrength": 1,
            "allowedDifficulties": [difficulty],
            "notes": [{"id": f"{difficulty}-note", "time": note_time, "lane": 0}],
        }
        analysis = {"controls": {}, "metrics": {}}
        return (chart, [], 1, analysis) if with_analysis else (chart, [], 1)

    def run_generator(self, *extra):
        return beat_chart.main(
            ["--song-config", str(self.config), "--song", self.song_id, *extra]
        )

    def generated_bundle(self):
        path = self.generated_dir / f"{self.song_id}.charts.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def test_generated_bundle_has_scoring_metadata_and_repeat_fingerprint_is_stable(self):
        self.assertEqual(self.run_generator(), 0)
        first = self.generated_bundle()
        self.assertIn("scoring", first)
        self.assertEqual(first["scoring"]["version"], 1)
        self.assertEqual(first["scoring"]["normalMaximum"], 100)
        self.assertEqual(first["scoring"]["fiveGoldTarget"], 90)
        fingerprint = first["scoring"]["chartFingerprint"]
        self.assertIsInstance(fingerprint, str)
        self.assertTrue(fingerprint)

        self.assertEqual(self.run_generator(), 0)
        self.assertEqual(self.generated_bundle()["scoring"]["chartFingerprint"], fingerprint)

    def test_normal_chart_content_change_invalidates_fingerprint(self):
        self.assertEqual(self.run_generator(), 0)
        first = self.generated_bundle()
        self.assertIn("scoring", first)
        first_fingerprint = first["scoring"]["chartFingerprint"]

        self.normal_note_time = 1.25
        self.assertEqual(self.run_generator(), 0)
        second = self.generated_bundle()
        self.assertNotEqual(second["scoring"]["chartFingerprint"], first_fingerprint)

    def test_check_rejects_bundle_with_removed_scoring_metadata(self):
        self.assertEqual(self.run_generator(), 0)
        bundle_path = self.generated_dir / f"{self.song_id}.charts.json"
        bundle = self.generated_bundle()
        # Seed the current contract field so this remains a behavior assertion
        # against today's RED generator rather than a missing-key/import failure.
        bundle["scoring"] = {
            "version": 1,
            "normalMaximum": 100,
            "fiveGoldTarget": 90,
            "chartFingerprint": "a" * 64,
        }
        bundle_path.write_text(json.dumps(bundle, indent=2) + "\n", encoding="utf-8")
        bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
        del bundle["scoring"]
        bundle_path.write_text(json.dumps(bundle, indent=2) + "\n", encoding="utf-8")

        self.assertNotEqual(self.run_generator("--check"), 0)


class SongAuthoringConfigTests(unittest.TestCase):
    def setUp(self):
        self.profile_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.profile_dir.cleanup)
        self.profile_path = Path(self.profile_dir.name) / "difficulty-profiles.json"
        self.profile_path.write_text(json.dumps(profile_fixture()), encoding="utf-8")
        self.profile_patch = patch.object(
            beat_chart, "DEFAULT_DIFFICULTY_PROFILES", self.profile_path
        )
        self.profile_patch.start()
        self.addCleanup(self.profile_patch.stop)

    @staticmethod
    def song_fixture(source="fixture.mp3"):
        return {
            "source": source,
            "start_time": 0,
            "duration": 100,
            "twilight_time": 45,
            "lane_rules": {"type": "pattern", "data": [0, 2, 1, 3]},
            "difficulties": {
                difficulty: {"minimum_delta": delta, "stride": stride}
                for difficulty, delta, stride in (("easy", 180, 3), ("normal", 96, 2), ("hard", 48, 1))
            },
        }

    def test_onset_recipe_defaults_partial_combined_validation_and_scope(self):
        base = self.song_fixture()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "songs.json"

            def load(song):
                path.write_text(json.dumps({"schema_version": 2, "songs": {"fixture": song}}))
                return beat_chart.load_authoring_collection(path)["fixture"]

            self.assertEqual(
                beat_chart._resolve_onset_recipe("fixture", load(base)),
                beat_chart.ONSET_DEFAULTS,
            )
            partial = beat_chart._resolve_onset_recipe("fixture", load({**base, "minioi": 0.02}))
            self.assertEqual(partial, {**beat_chart.ONSET_DEFAULTS, "minioi": 0.02})
            combined = {**base, "algorithm": "hfc", "minioi": 0.02, "threshold": 0.5, "silence": -60}
            self.assertEqual(
                beat_chart._resolve_onset_recipe("fixture", load(combined)),
                {"algorithm": "hfc", "minioi": 0.02, "threshold": 0.5, "silence": -60.0},
            )
            for key, value in (("algorithm", "nope"), ("minioi", 0), ("threshold", 0.05), ("threshold", 1.1), ("silence", 1), ("threshold", float("nan"))):
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    load({**base, key: value})
            difficulty_scoped = json.loads(json.dumps(base))
            difficulty_scoped["difficulties"]["normal"]["minioi"] = 0.02
            with self.assertRaisesRegex(ValueError, "invalid normal settings"):
                load(difficulty_scoped)

    def test_onset_command_and_cache_provenance_include_resolved_recipe(self):
        recipe = {"algorithm": "hfc", "minioi": 0.025123456789012345, "threshold": 0.42012345678901234, "silence": -70.12345678901234}
        _, command = beat_chart._build_commands("source.wav", "analysis.wav", recipe)
        self.assertEqual(command[command.index("-O") + 1], "hfc")
        recorded_aubio = beat_chart._recorded_commands(recipe)[1]
        for key, flag in (("minioi", "-M"), ("threshold", "-t"), ("silence", "-s")):
            actual = next(value for value in command if value.startswith(flag))
            recorded = next(value for value in recorded_aubio if value.startswith(flag))
            self.assertEqual(actual, recorded)
            self.assertEqual(float(actual[len(flag):]), recipe[key])
        self.assertNotEqual(beat_chart._recorded_commands(recipe), beat_chart._recorded_commands())
        with self.assertRaisesRegex(ValueError, "analysis commands"):
            beat_chart._validate_analysis_commands(
                beat_chart._recorded_commands(), "fixture", "analysis commands", recipe
            )

    def test_recorded_commands_match_builder_for_default_partial_and_full_recipes(self):
        recipes = (
            {},
            {"minioi": 0.125},
            {"algorithm": "hfc", "threshold": 0.375, "minioi": 0.025, "silence": -70.25},
        )
        expected_aubio = (
            ["aubioonset", "-T", "seconds", "-O", "specflux", "-t0.4", "-M0.032", "-s-20.0", "-i", "{analysisWav}"],
            ["aubioonset", "-T", "seconds", "-O", "specflux", "-t0.4", "-M0.125", "-s-20.0", "-i", "{analysisWav}"],
            ["aubioonset", "-T", "seconds", "-O", "hfc", "-t0.375", "-M0.025", "-s-70.25", "-i", "{analysisWav}"],
        )
        expected_ffmpeg = [
            "ffmpeg", "-nostdin", "-y", "-i", "{sourceAudio}", "-ac", "1", "-ar",
            "44100", "-sample_fmt", "s16", "-c:a", "pcm_s16le", "{analysisWav}",
        ]
        for recipe, expected in zip(recipes, expected_aubio):
            with self.subTest(recipe=recipe):
                ffmpeg, aubio = beat_chart._build_commands("{sourceAudio}", "{analysisWav}", recipe)
                self.assertEqual(beat_chart._recorded_commands(recipe), [ffmpeg, aubio])
                self.assertEqual(beat_chart._recorded_commands(recipe), [expected_ffmpeg, expected])

    def test_malformed_legacy_provenance_is_not_treated_as_stale_recipe(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy_path = root / "data/charts/fixture.beats.json"
            legacy_path.parent.mkdir(parents=True)
            source = root / "fixture.mp3"
            source.write_bytes(b"source")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            legacy_path.write_text(json.dumps({
                "schema_version": 1,
                "source": {"path": "wrong-source.mp3", "sha256": digest},
                "source_sha256": digest,
                "onsets": [1.0],
                "commands": beat_chart._recorded_commands(),
                "tools": {"ffmpeg": "ffmpeg", "aubioonset": "aubioonset"},
            }))
            calls = []
            def runner(command, **kwargs):
                calls.append(command)
                return subprocess.CompletedProcess(command, 0, "1.0\n", "")
            with patch.object(beat_chart, "PROJECT_ROOT", root):
                with self.assertRaisesRegex(ValueError, "source mismatch"):
                    beat_chart._analysis_for_song(
                        "fixture", {"algorithm": "complex"}, source, digest,
                        runner, False, root / "current.beats.json",
                    )
            self.assertEqual(calls, [])

    def test_stale_legacy_hfc_cache_is_skipped_for_generation_but_fails_check(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy_path = root / "data/charts" / "fixture.beats.json"
            legacy_path.parent.mkdir(parents=True)
            source = root / "fixture.mp3"
            source.write_bytes(b"source")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            legacy_commands = beat_chart._recorded_commands({**beat_chart.ONSET_DEFAULTS, "algorithm": "hfc"})
            legacy_commands[1] = ["-s-90" if arg == "-s-90.0" else arg for arg in legacy_commands[1]]
            legacy_path.write_text(json.dumps({
                "schema_version": 1,
                "source": {"path": source.relative_to(root).as_posix(), "sha256": digest},
                "source_sha256": digest,
                "onsets": [1.0, 2.0],
                "commands": legacy_commands,
                "tools": {"ffmpeg": "ffmpeg", "aubioonset": "aubioonset"},
            }))
            settings = {"algorithm": "complex"}
            onset_path = root / "current.beats.json"
            calls = []

            def runner(command, **kwargs):
                command = [str(part) for part in command]
                calls.append(command)
                executable = Path(command[0]).name
                if executable == "aubioonset":
                    return subprocess.CompletedProcess(command, 0, "1.0\n2.0\n", "")
                return subprocess.CompletedProcess(command, 0, "", "")

            with patch.object(beat_chart, "PROJECT_ROOT", root):
                with self.assertRaisesRegex(ValueError, "cached onset artifact"):
                    beat_chart._analysis_for_song("fixture", settings, source, digest, runner, True, onset_path)
                calls.clear()
                result = beat_chart._analysis_for_song("fixture", settings, source, digest, runner, False, onset_path)
            self.assertEqual(
                result["analysis"],
                beat_chart._recorded_commands(beat_chart._resolve_onset_recipe("fixture", settings)),
            )
            self.assertEqual(Path(calls[1][0]).name, "aubioonset")

    def test_difficulty_lane_mapping_overrides_are_independent_and_defaulted(self):
        song = self.song_fixture()
        document = {"schema_version": 2, "songs": {"fixture": song}}
        normal_mapping = {"pitch_following": 0}
        hard_mapping = {"lane_balance": 2.5}
        song["difficulties"]["normal"]["lane_mapping"] = normal_mapping
        song["difficulties"]["hard"]["lane_mapping"] = hard_mapping
        controlled_defaults = {
            "pitch_following": 1,
            "lane_balance": 1,
            "repetition_avoidance": 1,
            "wide_jump_avoidance": 1,
            "adaptation_block_notes": 32,
        }

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "song-authoring.json"
            path.write_text(json.dumps(document), encoding="utf-8")
            collection_song = beat_chart.load_authoring_collection(path)["fixture"]
            compatibility_song = beat_chart.load_song_config(
                path, "fixture"
            )

            for loaded_song in (collection_song, compatibility_song):
                self.assertEqual(
                    loaded_song["difficulties"]["normal"]["lane_mapping"],
                    normal_mapping,
                )
                self.assertEqual(
                    loaded_song["difficulties"]["hard"]["lane_mapping"],
                    hard_mapping,
                )
                self.assertNotIn(
                    "lane_mapping", loaded_song["difficulties"]["easy"]
                )
            with patch.dict(
                pitch_lanes.DEFAULT_LANE_MAPPING, controlled_defaults, clear=True
            ):
                self.assertEqual(
                    beat_chart.validate_lane_mapping(normal_mapping),
                    {**controlled_defaults, "pitch_following": 0},
                )
                self.assertEqual(
                    beat_chart.validate_lane_mapping(hard_mapping),
                    {**controlled_defaults, "lane_balance": 2.5},
                )

            for difficulty in ("easy", "normal", "hard"):
                song["difficulties"][difficulty].pop("lane_mapping", None)
            path.write_text(json.dumps(document), encoding="utf-8")
            with patch.dict(
                pitch_lanes.DEFAULT_LANE_MAPPING, controlled_defaults, clear=True
            ):
                for loaded_song in (
                    beat_chart.load_authoring_collection(path)["fixture"],
                    beat_chart.load_song_config(path, "fixture"),
                ):
                    for difficulty in ("easy", "normal", "hard"):
                        self.assertNotIn(
                            "lane_mapping", loaded_song["difficulties"][difficulty]
                        )
                        self.assertEqual(
                            beat_chart.validate_lane_mapping(), controlled_defaults
                        )

    def test_difficulty_lane_mapping_override_is_strict_and_bounded(self):
        document = {"schema_version": 2, "songs": {"fixture": self.song_fixture()}}
        valid = {
            "pitch_following": 0,
            "lane_balance": 4,
            "repetition_avoidance": 1.5,
            "wide_jump_avoidance": 2,
            "adaptation_block_notes": 64,
        }

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "song-authoring.json"

            def load_with(loader, mapping):
                document["songs"]["fixture"]["difficulties"]["normal"][
                    "lane_mapping"
                ] = mapping
                path.write_text(json.dumps(document), encoding="utf-8")
                if loader == "collection":
                    return beat_chart.load_authoring_collection(path)["fixture"]
                return beat_chart.load_song_config(path, "fixture")

            valid_edges = [
                {
                    **valid,
                    **{name: edge for name in (
                        "pitch_following",
                        "lane_balance",
                        "repetition_avoidance",
                        "wide_jump_avoidance",
                    )},
                    "adaptation_block_notes": block_size,
                }
                for edge, block_size in ((0, 8), (4, 128))
            ]
            for index, mapping in enumerate(valid_edges):
                with self.subTest(valid_edge=index):
                    self.assertEqual(
                        load_with("collection", mapping)["difficulties"]["normal"][
                            "lane_mapping"
                        ],
                        mapping,
                    )
                    self.assertEqual(
                        load_with("compatibility", mapping)["difficulties"][
                            "normal"
                        ]["lane_mapping"],
                        mapping,
                    )

            invalid_mappings = [None, [], {**valid, "unexpected": 1}]
            for name in (
                "pitch_following",
                "lane_balance",
                "repetition_avoidance",
                "wide_jump_avoidance",
            ):
                for value in (
                    True,
                    float("nan"),
                    float("inf"),
                    float("-inf"),
                    -0.01,
                    4.01,
                    "1",
                ):
                    invalid_mappings.append({**valid, name: value})
            invalid_mappings.extend(
                {**valid, "adaptation_block_notes": value}
                for value in (True, 8.0, 7, 129, 32.5, "32")
            )
            for index, mapping in enumerate(invalid_mappings):
                for loader in ("collection", "compatibility"):
                    with self.subTest(index=index, mapping=mapping, loader=loader):
                        with self.assertRaises(ValueError):
                            load_with(loader, mapping)

    def test_shared_difficulty_profiles_define_all_runtime_values(self):
        profile_path = beat_chart.PROJECT_ROOT / "data/charts/difficulty-profiles.json"
        profile_document = json.loads(profile_path.read_text(encoding="utf-8"))
        self.assertEqual(set(profile_document), {"profiles"})
        self.assertEqual(set(profile_document["profiles"]), set(beat_chart.DIFFICULTIES))
        loaded = beat_chart.load_difficulty_profiles(profile_path)

        for difficulty in beat_chart.DIFFICULTIES:
            with self.subTest(difficulty=difficulty):
                raw = profile_document["profiles"][difficulty]
                runtime = loaded[difficulty]
                self.assertEqual(set(raw), {"twilight_strength", "timing", "audience", "twilight"})
                self.assertEqual(set(raw["timing"]), {"perfect_ms", "good_ms"})
                self.assertEqual(set(raw["audience"]), {"perfect", "good", "miss"})
                self.assertEqual(set(raw["twilight"]), {"perfect", "good", "miss"})
                self.assertEqual(runtime["timing"]["perfect_ms"], raw["timing"]["perfect_ms"])
                self.assertEqual(runtime["timing"]["good_ms"], raw["timing"]["good_ms"])
                self.assertEqual(runtime["audience"], raw["audience"])
                self.assertEqual(runtime["twilight"], raw["twilight"])
                self.assertEqual(runtime["twilight_strength"], raw["twilight_strength"])

    def test_shared_profile_loader_rejects_invalid_timing_and_balance_values(self):
        original = profile_fixture()
        malformed_profiles = []

        missing_profile = json.loads(json.dumps(original))
        del missing_profile["profiles"]["hard"]
        malformed_profiles.append(missing_profile)

        invalid_window = json.loads(json.dumps(original))
        invalid_window["profiles"]["easy"]["timing"]["good_ms"] = 19
        malformed_profiles.append(invalid_window)

        negative_timing = json.loads(json.dumps(original))
        negative_timing["profiles"]["easy"]["timing"]["perfect_ms"] = -1
        malformed_profiles.append(negative_timing)

        negative_reward = json.loads(json.dumps(original))
        negative_reward["profiles"]["normal"]["audience"]["good"] = -1
        malformed_profiles.append(negative_reward)

        missing_combat_value = json.loads(json.dumps(original))
        del missing_combat_value["profiles"]["hard"]["twilight"]["miss"]["damage"]
        malformed_profiles.append(missing_combat_value)

        negative_perfect_damage = json.loads(json.dumps(original))
        negative_perfect_damage["profiles"]["normal"]["twilight"]["perfect"]["damage"] = -1
        malformed_profiles.append(negative_perfect_damage)

        nonfinite_miss_cost = json.loads(json.dumps(original))
        nonfinite_miss_cost["profiles"]["normal"]["twilight"]["miss"]["personal_cost"] = float("nan")
        malformed_profiles.append(nonfinite_miss_cost)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "difficulty-profiles.json"
            for index, document in enumerate(malformed_profiles):
                with self.subTest(index=index):
                    path.write_text(json.dumps(document), encoding="utf-8")
                    with self.assertRaises(ValueError):
                        beat_chart.load_difficulty_profiles(path)

    def test_profile_pipeline_accepts_signed_miss_and_chart_has_no_baked_strength(self):
        original = profile_fixture()
        original["profiles"]["normal"]["audience"]["miss"] = -2
        original["profiles"]["normal"]["twilight"]["miss"] = {
            "personal_cost": -3,
            "damage": -4,
        }

        profile_dir = tempfile.TemporaryDirectory()
        self.addCleanup(profile_dir.cleanup)
        path = Path(profile_dir.name) / "difficulty-profiles.json"
        path.write_text(json.dumps(original), encoding="utf-8")
        with patch.object(beat_chart, "DEFAULT_DIFFICULTY_PROFILES", path):
            profiles = beat_chart.load_difficulty_profiles()

        profile = profiles["normal"]
        self.assertEqual(profile["audience"]["miss"], -2)
        self.assertEqual(profile["twilight"]["miss"], {"personal_cost": -3.0, "damage": -4.0})
        settings = {
            "start_time": 0,
            "duration": 100,
            "twilight_time": 50,
            "lane_rules": {"type": "pattern", "data": [0, 2, 1, 3]},
            "difficulties": {
                "normal": {"minimum_delta": 0, "stride": 1}
            },
        }
        with patch.object(beat_chart, "DEFAULT_DIFFICULTY_PROFILES", path):
            chart, _, count = beat_chart._difficulty_chart(
                [index * 0.5 for index in range(200)],
                settings,
                100,
                profile,
                "normal",
                "signed-miss-fixture",
                "a" * 64,
            )
        self.assertNotIn("twilightStrength", chart)

    def test_loads_selected_song_from_collection_with_requested_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "song-authoring.json"
            config = {
                "songs": {
                    "the-first-shining-star": {
                        "source": "data/music/The First Shining Star (Remastered).mp3",
                        "start_time": 107.1,
                        "twilight_time": 39.2,
                        "duration": 65.8,
                        "twilight_strength": 100,
                        "allowed_difficulties": ["normal", "hard"],
                        "minimum_delta": 64,
                        "stride": 2,
                        "lane_rules": {"type": "pattern", "data": [0, 2, 1, 3]},
                    }
                }
            }
            path.write_text(json.dumps(config), encoding="utf-8")

            selected = beat_chart.load_song_config(path, "the-first-shining-star")

        self.assertEqual(selected["source"], config["songs"]["the-first-shining-star"]["source"])
        self.assertEqual(
            {key: selected[key] for key in ("algorithm", "minioi", "threshold", "silence")},
            beat_chart.ONSET_DEFAULTS,
        )

    def test_config_loader_rejects_unknown_song_and_invalid_authoring_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "song-authoring.json"
            song = {
                "source": "song.mp3",
                "start_time": 107.1,
                "twilight_time": 39.2,
                "duration": 65.8,
                "twilight_strength": 100,
                "allowed_difficulties": ["normal", "hard"],
                "minimum_delta": 64,
                "stride": 2,
                "lane_rules": {"type": "pattern", "data": [0, 2, 1, 3]},
            }
            path.write_text(json.dumps({"songs": {"one": song}}), encoding="utf-8")
            with self.assertRaises(ValueError):
                beat_chart.load_song_config(path, "missing")

            invalid = {**song, "minimum_delta": -1}
            path.write_text(json.dumps({"songs": {"one": invalid}}), encoding="utf-8")
            with self.assertRaises(ValueError):
                beat_chart.load_song_config(path, "one")

            for field, value in (
                ("start_time", True),
                ("duration", float("inf")),
                ("twilight_strength", 0),
                ("twilight_strength", -1),
                ("twilight_strength", float("inf")),
                ("twilight_strength", False),
                ("allowed_difficulties", []),
                ("allowed_difficulties", ["unknown"]),
                ("allowed_difficulties", ["normal", "normal"]),
                ("allowed_difficulties", ["normal", True]),
                ("allowed_difficulties", "normal"),
                ("allowed_difficulties", None),
                ("minimum_delta", False),
                ("stride", True),
                ("lane_rules", {"type": "pattern", "data": [0, True]}),
                ("lane_rules", {"type": "unknown", "data": [0, 1]}),
            ):
                with self.subTest(field=field, value=value):
                    invalid = {**song, field: value}
                    path.write_text(
                        json.dumps({"songs": {"one": invalid}}), encoding="utf-8"
                    )
                    with self.assertRaises(ValueError):
                        beat_chart.load_song_config(path, "one")

    def test_current_playable_song_config_allows_normal_and_hard(self):
        selected = beat_chart.load_song_config()

        self.assertEqual(selected["allowed_difficulties"], ["normal", "hard"])
        self.assertEqual(selected["twilight_strength"], 100)


if __name__ == "__main__":
    unittest.main()
