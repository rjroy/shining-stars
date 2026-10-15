"""Tests for the offline v2 multi-difficulty chart migration."""

import hashlib
import contextlib
import io
import json
import math
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from scripts import beat_chart


class V2AuthoringTests(unittest.TestCase):
    def test_authoring_and_artifact_inventory_is_29_songs_and_87_charts(self):
        songs = beat_chart.load_authoring_collection()
        self.assertEqual(len(songs), 29)
        self.assertEqual(len({settings["source"] for settings in songs.values()}), 29)
        self.assertTrue(all(set(song["difficulties"]) == {"easy", "normal", "hard"} for song in songs.values()))
        expected = {f"{song_id}.charts.json" for song_id in songs}
        actual = {path.name for path in beat_chart.DEFAULT_GENERATED_DIR.glob("*.charts.json")}
        if actual:
            self.assertEqual(actual, expected)

    def test_all_87_charts_match_final_guarded_projection_and_formula(self):
        songs = beat_chart.load_authoring_collection()
        profiles = beat_chart.load_difficulty_profiles()
        self.assertEqual(len(songs), 29)
        total_charts = 0
        for song_id, settings in songs.items():
            envelope = json.loads((beat_chart.DEFAULT_GENERATED_DIR / f"{song_id}.charts.json").read_text())
            onset_doc = json.loads((beat_chart.DEFAULT_ONSETS_DIR / f"{song_id}.beats.json").read_text())
            self.assertIsInstance(envelope["source"], str)
            self.assertEqual(envelope["source"], settings["source"])
            expected_difficulties = {}
            for difficulty in beat_chart.DIFFICULTIES:
                chart, notes, twilight_count = beat_chart._difficulty_chart(
                    onset_doc["onsets"], settings, onset_doc["source_duration_seconds"],
                    profiles[difficulty], difficulty, song_id, onset_doc["source"]["sha256"],
                )
                self.assertEqual(envelope["charts"][difficulty], chart)
                self.assertEqual(
                    chart["twilightStrength"],
                    math.ceil(
                        twilight_count
                        * profiles[difficulty]["twilight"]["perfect"]["damage"]
                        * settings["difficulties"][difficulty]["twilight_strength"]
                        / 100
                    ),
                )
                self.assertTrue(any(note["relative_time"] > chart["twilightAt"] for note in notes))
                expected_difficulties[difficulty] = json.dumps(chart, sort_keys=True)
                total_charts += 1
            self.assertEqual(len(set(expected_difficulties.values())), 3, song_id)
        self.assertEqual(total_charts, 87)

    def test_demo_percent_conversion_preserves_measured_source_times(self):
        song = beat_chart.load_authoring_collection()["the-first-shining-star"]
        duration = 362.919979
        source_start = song["start_time"] * duration / 100
        excerpt_duration = song["duration"] * duration / 100
        twilight_at = excerpt_duration * song["twilight_time"] / 100
        sample = 1 / 44100
        self.assertLessEqual(abs(source_start - 107.1), sample)
        self.assertLessEqual(abs(excerpt_duration - 65.8), sample)
        self.assertLessEqual(abs(twilight_at - 39.2), sample)

    def test_twilight_strength_formula_uses_ceiling_and_profile_damage(self):
        settings = {
            "start_time": 0, "duration": 100, "twilight_time": 50,
            "lane_rules": {"type": "pattern", "data": [0, 2, 1, 3]},
            "difficulties": {"easy": {"twilight_strength": 70, "minimum_delta": 0, "stride": 1}},
        }
        chart, notes, count = beat_chart._difficulty_chart(
            [i * 0.5 for i in range(200)], settings, 100,
            {"timing": {"good_ms": 500}, "twilight": {"perfect": {"damage": 2}}},
            "easy", "sample", hashlib.sha256(b"song").hexdigest(),
        )
        self.assertGreater(count, 0)
        self.assertEqual(chart["twilightStrength"], __import__("math").ceil(count * 2 * 0.70))
        self.assertEqual(chart["allowedDifficulties"], ["easy"])
        self.assertEqual(len(notes), len(chart["notes"]))

    def test_zero_twilight_notes_are_rejected(self):
        settings = {
            "start_time": 0, "duration": 10, "twilight_time": 50,
            "lane_rules": {"type": "pattern", "data": [0]},
            "difficulties": {"easy": {"twilight_strength": 70, "minimum_delta": 0, "stride": 1}},
        }
        with self.assertRaisesRegex(ValueError, "zeroTwilight"):
            beat_chart._difficulty_chart(
                [0.4, 1, 2, 3], settings, 10,
                {"timing": {"good_ms": 500}, "twilight": {"perfect": {"damage": 2}}},
                "easy", "sample", "a" * 64,
            )


class V2WorkflowTests(unittest.TestCase):
    @staticmethod
    def v2_song(source):
        return {
            "source": str(source), "start_time": 0, "duration": 100,
            "twilight_time": 50, "lane_rules": {"type": "pattern", "data": [0, 1]},
            "difficulties": {
                name: {"twilight_strength": strength, "minimum_delta": delta, "stride": stride}
                for name, strength, delta, stride in (("easy", 70, 64, 3), ("normal", 80, 64, 2), ("hard", 90, 50, 1))
            },
        }

    def test_v2_cli_rejects_legacy_overrides_before_runner_or_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "song.wav"
            source.write_bytes(b"source")
            config = root / "authoring.json"
            config.write_text(json.dumps({"schema_version": 2, "songs": {"test-song": self.v2_song(source)}}))
            runner_calls = []
            runner = lambda *args, **kwargs: runner_calls.append(args)
            options = (
                ["--source", str(source)], [str(source)],
                ["--artifact", str(root / "a.json")], ["--chart", str(root / "c.json")],
                ["--source-start", "0"], ["--duration", "100"], ["--boundary", "50"],
                ["--stride", "1"], ["--minimum-delta", "0"],
            )
            for option in options:
                with self.subTest(option=option):
                    result = beat_chart.main(["--song-config", str(config), *option], runner=runner)
                    self.assertNotEqual(result, 0)
                    self.assertEqual(runner_calls, [])
                    self.assertFalse((root / "a.json").exists())
                    self.assertFalse((root / "c.json").exists())

    def test_current_and_legacy_cache_reuse_reject_malformed_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "data" / "music" / "song.mp3"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"source")
            digest = beat_chart._sha256_file(source)
            runner_calls = []
            runner = lambda *args, **kwargs: runner_calls.append(args)
            current_dir = root / "onsets"
            relative_source = str(source.resolve())
            current_good = {
                "schemaVersion": 1,
                "source": {"path": relative_source, "sha256": digest},
                "source_sha256": digest,
                "onsets": [0.5, 1.0],
                "analysis": beat_chart._recorded_commands(),
                "tools": {"ffmpeg": "ffmpeg", "aubioonset": "aubioonset"},
                "source_duration_seconds": 10.0,
                "projection": {"song": {}, "profile_sha256": "a" * 64},
            }
            current_mutations = (
                lambda d: d.update(schemaVersion=2),
                lambda d: d.update(source_sha256="b" * 64),
                lambda d: d.update(onsets=[1.0, 0.5]),
                lambda d: d.update(analysis=[*d["analysis"], ["ffmpeg", "-ss", "1"]]),
            )
            with patch.object(beat_chart, "DEFAULT_ONSETS_DIR", current_dir):
                current_dir.mkdir()
                path = current_dir / "song.beats.json"
                for mutate in current_mutations:
                    malformed = json.loads(json.dumps(current_good))
                    mutate(malformed)
                    path.write_text(json.dumps(malformed))
                    with self.subTest(cache="current", malformed=malformed), self.assertRaises(ValueError):
                        beat_chart._analysis_for_song("song", {}, source, digest, runner, True, path)

            legacy_root = root / "legacy-project"
            legacy_source = legacy_root / "data" / "music" / "song.mp3"
            legacy_source.parent.mkdir(parents=True)
            legacy_source.write_bytes(b"legacy")
            legacy_digest = beat_chart._sha256_file(legacy_source)
            legacy_good = {
                "schema_version": 1,
                "source": {"path": "data/music/song.mp3", "sha256": legacy_digest},
                "source_sha256": legacy_digest,
                "onsets": [0.5, 1.0],
                "commands": beat_chart._recorded_commands(),
                "tools": {"ffmpeg": "ffmpeg", "aubioonset": "aubioonset"},
            }
            legacy_mutations = (
                lambda d: d.update(schema_version=2),
                lambda d: d.update(source_sha256="c" * 64),
                lambda d: d.update(onsets=[0.5, float("nan")]),
                lambda d: d.update(commands=[["ffmpeg", "-ss", "1"]]),
            )
            with patch.object(beat_chart, "PROJECT_ROOT", legacy_root):
                candidate_dir = legacy_root / "data" / "charts" / "candidates"
                candidate_dir.mkdir(parents=True)
                candidate = candidate_dir / "song.beats.json"
                onset_path = legacy_root / "data" / "charts" / "onsets" / "song.beats.json"
                for mutate in legacy_mutations:
                    malformed = json.loads(json.dumps(legacy_good))
                    mutate(malformed)
                    candidate.write_text(json.dumps(malformed))
                    with self.subTest(cache="legacy", malformed=malformed), self.assertRaises(ValueError):
                        beat_chart._analysis_for_song("song", {}, legacy_source, legacy_digest, runner, False, onset_path)
            self.assertEqual(runner_calls, [], "invalid caches must not reach extraction tools")

    def test_changed_selected_source_aborts_before_any_output_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sources = [root / "one.wav", root / "two.wav"]
            for source in sources:
                source.write_bytes(b"initial")
            config = root / "authoring.json"
            config.write_text(json.dumps({
                "schema_version": 2,
                "songs": {f"song-{index}": self.v2_song(source) for index, source in enumerate(sources)},
            }))
            generated, onsets = root / "generated", root / "onsets"
            generated.mkdir(); onsets.mkdir()
            profiles_hash = beat_chart._profile_file_hash()
            sentinels = []
            for index, (song_id, source) in enumerate(zip(("song-0", "song-1"), sources)):
                settings = self.v2_song(source)
                onset_cache = {
                    "schemaVersion": 1,
                    "source": {
                        "path": beat_chart._project_relative_source(source.resolve()),
                        "sha256": beat_chart._sha256_file(source),
                    },
                    "source_sha256": beat_chart._sha256_file(source),
                    "onsets": [i * 0.5 for i in range(200)],
                    "analysis": beat_chart._recorded_commands(),
                    "tools": {"ffmpeg": "ffmpeg", "aubioonset": "aubioonset"},
                    "source_duration_seconds": 100.0,
                    "projection": {"song": settings, "profile_sha256": profiles_hash},
                }
                onset_path = onsets / f"{song_id}.beats.json"
                onset_path.write_text(json.dumps(onset_cache, indent=2, sort_keys=True) + "\n")
                sentinels.append((onset_path, onset_path.read_bytes()))
                chart_path = generated / f"{song_id}.charts.json"
                chart_path.write_text("prior output\n")
                sentinels.append((chart_path, chart_path.read_bytes()))
            calls = []
            changed_during_processing = False

            def runner(command, **kwargs):
                nonlocal changed_during_processing
                command = [str(item) for item in command]
                executable = Path(command[0]).name
                calls.append(executable)
                if executable == "ffprobe":
                    if calls.count("ffprobe") == 2:
                        sources[1].write_bytes(b"changed while generating")
                        changed_during_processing = True
                    return subprocess.CompletedProcess(command, 0, "100\n", "")
                raise AssertionError(command)

            original_hash = beat_chart._sha256_file
            hash_calls = []

            def tracking_hash(path):
                resolved = Path(path).resolve()
                hash_calls.append(resolved)
                return original_hash(path)

            stderr = io.StringIO()
            with (
                patch.object(beat_chart, "DEFAULT_GENERATED_DIR", generated),
                patch.object(beat_chart, "DEFAULT_ONSETS_DIR", onsets),
                patch.object(beat_chart, "_sha256_file", side_effect=tracking_hash),
                contextlib.redirect_stderr(stderr),
            ):
                result = beat_chart.main(["--all", "--song-config", str(config)], runner=runner)
            self.assertEqual(result, 1)
            self.assertTrue(changed_during_processing, "later-song processing must mutate the selected source")
            self.assertEqual(calls, ["ffprobe", "ffprobe"], "valid onset caches must avoid re-extraction")
            self.assertEqual(
                hash_calls[-2:], [source.resolve() for source in sources],
                "the publication guard must rehash every selected source before writing",
            )
            self.assertEqual(
                stderr.getvalue(),
                "beat-chart: source audio changed during chart generation for song-1; outputs were not written\n",
            )
            self.assertEqual([(path, path.read_bytes()) for path, _ in sentinels], sentinels)
            self.assertFalse(any(path.name.startswith(".") and path.suffix == ".tmp" for path in root.rglob("*")))

    def test_analysis_cache_reuse_and_profile_hash_invalidation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "song.wav"
            source.write_bytes(b"source")
            config = root / "authoring.json"
            song = self.v2_song(source)
            config.write_text(json.dumps({"schema_version": 2, "songs": {"test-song": song}}))
            out = root / "generated"
            onset_dir = root / "onsets"
            profile_path = root / "difficulty-profiles.json"
            profile_document = json.loads(beat_chart.DEFAULT_DIFFICULTY_PROFILES.read_text())
            profile_path.write_text(json.dumps(profile_document))
            calls = []

            def runner(command, **kwargs):
                command = [str(item) for item in command]
                calls.append(Path(command[0]).name)
                if command[0] == "ffprobe":
                    return subprocess.CompletedProcess(command, 0, "100\n", "")
                if command[0] == "ffmpeg":
                    with wave.open(command[-1], "wb") as wav:
                        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(44100)
                        wav.writeframes(b"\0\0" * 4410)
                    return subprocess.CompletedProcess(command, 0, "", "")
                if command[0] == "aubioonset":
                    return subprocess.CompletedProcess(command, 0, "".join(f"{i * .5}\n" for i in range(200)), "")
                raise AssertionError(command)

            with patch.object(beat_chart, "DEFAULT_GENERATED_DIR", out), patch.object(beat_chart, "DEFAULT_ONSETS_DIR", onset_dir), patch.object(beat_chart, "DEFAULT_DIFFICULTY_PROFILES", profile_path):
                args = ["--song-config", str(config), "--song", "test-song"]
                self.assertEqual(beat_chart.main(args, runner=runner), 0)
                self.assertEqual(calls.count("aubioonset"), 1)
                first = json.loads((out / "test-song.charts.json").read_text())
                self.assertEqual(set(first["charts"]), {"easy", "normal", "hard"})
                calls.clear()
                self.assertEqual(beat_chart.main(args, runner=runner), 0)
                self.assertNotIn("aubioonset", calls)
                self.assertEqual(beat_chart.main([*args, "--check"], runner=runner), 0)
                self.assertNotIn("aubioonset", calls)
                source.write_bytes(b"changed source")
                self.assertNotEqual(beat_chart.main([*args, "--check"], runner=runner), 0)
                self.assertNotIn("aubioonset", calls)
                source.write_bytes(b"source")
                profile_document["profiles"]["easy"]["twilight"]["perfect"]["damage"] += 1
                profile_path.write_text(json.dumps(profile_document))
                self.assertNotEqual(beat_chart.main([*args, "--check"], runner=runner), 0)
                self.assertNotIn("aubioonset", calls)
                prior_onsets = json.loads((onset_dir / "test-song.beats.json").read_text())["onsets"]
                self.assertEqual(beat_chart.main(args, runner=runner), 0)
                self.assertNotIn("aubioonset", calls, "damage-only regeneration must reuse source analysis")
                self.assertEqual(json.loads((onset_dir / "test-song.beats.json").read_text())["onsets"], prior_onsets)
                self.assertEqual(beat_chart.main([*args, "--check"], runner=runner), 0)

                all_args = ["--all", "--song-config", str(config)]
                self.assertEqual(beat_chart.main(all_args, runner=runner), 0)
                (out / "extra.charts.json").write_text("{}\n")
                self.assertNotEqual(beat_chart.main([*all_args, "--check"], runner=runner), 0)
                self.assertNotIn("aubioonset", calls)


if __name__ == "__main__":
    unittest.main()
