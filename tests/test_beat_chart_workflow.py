"""Workflow contract tests using a fake subprocess runner and synthetic input."""

import hashlib
import json
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from scripts import beat_chart


class BeatChartWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.source = self.root / "source audio.wav"
        self.source.write_bytes(b"synthetic source audio")
        self.artifact = self.root / "data" / "the-first-shining-star.beats.json"
        self.chart = self.root / "src" / "mvp-chart.ts"
        self.calls = []
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
        _, command = beat_chart._build_commands(self.source, self.root / "analysis.wav")
        self.assertEqual(
            command[:8],
            [
                "aubioonset", "-T", "seconds", "-O", "hfc", "-t0.3", "-M0.012", "-s-90",
            ],
        )

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
        self.assertEqual(aubio_call[aubio_call.index("-O") + 1], "hfc")
        self.assertIn("-M0.012", aubio_call)
        self.assertIn("-s-90", aubio_call)
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
        profile_document = json.loads(
            (beat_chart.PROJECT_ROOT / "data/charts/difficulty-profiles.json")
            .read_text(encoding="utf-8")
        )
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


class SongAuthoringConfigTests(unittest.TestCase):
    def test_shared_difficulty_profiles_define_all_runtime_values(self):
        profile_path = beat_chart.PROJECT_ROOT / "data/charts/difficulty-profiles.json"
        profile_document = json.loads(profile_path.read_text(encoding="utf-8"))

        self.assertEqual(
            profile_document,
            {
                "profiles": {
                    "easy": {
                        "timing": {"perfect_ms": 75, "good_ms": 150},
                        "audience": {"perfect": 2, "good": 1, "miss": 0},
                        "twilight": {
                            "perfect": {"personal_cost": 0, "damage": 2},
                            "good": {"personal_cost": 0, "damage": 1},
                            "miss": {"personal_cost": 2, "damage": 0},
                        },
                    },
                    "normal": {
                        "timing": {"perfect_ms": 65, "good_ms": 125},
                        "audience": {"perfect": 3, "good": 2, "miss": 0},
                        "twilight": {
                            "perfect": {"personal_cost": 0, "damage": 3},
                            "good": {"personal_cost": 1, "damage": 2},
                            "miss": {"personal_cost": 3, "damage": 0},
                        },
                    },
                    "hard": {
                        "timing": {"perfect_ms": 50, "good_ms": 100},
                        "audience": {"perfect": 5, "good": 3, "miss": 0},
                        "twilight": {
                            "perfect": {"personal_cost": 0, "damage": 5},
                            "good": {"personal_cost": 2, "damage": 3},
                            "miss": {"personal_cost": 3, "damage": 0},
                        },
                    },
                }
            },
        )

    def test_shared_profile_loader_rejects_invalid_timing_and_balance_values(self):
        original = json.loads(
            (beat_chart.PROJECT_ROOT / "data/charts/difficulty-profiles.json")
            .read_text(encoding="utf-8")
        )
        malformed_profiles = []

        missing_profile = json.loads(json.dumps(original))
        del missing_profile["profiles"]["hard"]
        malformed_profiles.append(missing_profile)

        invalid_window = json.loads(json.dumps(original))
        invalid_window["profiles"]["easy"]["timing"]["good_ms"] = 50
        malformed_profiles.append(invalid_window)

        negative_reward = json.loads(json.dumps(original))
        negative_reward["profiles"]["normal"]["audience"]["good"] = -1
        malformed_profiles.append(negative_reward)

        missing_combat_value = json.loads(json.dumps(original))
        del missing_combat_value["profiles"]["hard"]["twilight"]["miss"]["damage"]
        malformed_profiles.append(missing_combat_value)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "difficulty-profiles.json"
            for index, document in enumerate(malformed_profiles):
                with self.subTest(index=index):
                    path.write_text(json.dumps(document), encoding="utf-8")
                    with self.assertRaises(ValueError):
                        beat_chart.load_difficulty_profiles(path)

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

        self.assertEqual(selected, config["songs"]["the-first-shining-star"])

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
