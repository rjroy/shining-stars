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
    def test_authoring_and_artifact_inventory_match_live_song_catalog(self):
        songs = beat_chart.load_authoring_collection()
        self.assertGreater(len(songs), 0)
        self.assertEqual(len({settings["source"] for settings in songs.values()}), len(songs))
        self.assertTrue(all(set(song["difficulties"]) == {"easy", "normal", "hard"} for song in songs.values()))
        expected = {f"{song_id}.charts.json" for song_id in songs}
        actual = {path.name for path in beat_chart.DEFAULT_GENERATED_DIR.glob("*.charts.json")}
        if actual:
            self.assertEqual(actual, expected)

    def test_all_generated_charts_match_live_authoring_projection_and_formula(self):
        songs = beat_chart.load_authoring_collection()
        profiles = beat_chart.load_difficulty_profiles()
        total_charts = 0
        for song_id, settings in songs.items():
            envelope = json.loads((beat_chart.DEFAULT_GENERATED_DIR / f"{song_id}.charts.json").read_text())
            onset_doc = json.loads((beat_chart.DEFAULT_ONSETS_DIR / f"{song_id}.beats.json").read_text())
            pitch_key = onset_doc["pitch_analysis_key"]
            pitch_cache = json.loads(
                (beat_chart.DEFAULT_PITCH_CACHE_DIR / f"{song_id}.{pitch_key}.json").read_text()
            )
            report = json.loads(
                (beat_chart.DEFAULT_REPORTS_DIR / f"{song_id}.lanes.json").read_text()
            )
            self.assertIsInstance(envelope["source"], str)
            self.assertEqual(envelope["source"], settings["source"])
            self.assertEqual(report["pitch_analysis_key"], pitch_key)
            expected_difficulties = {}
            for difficulty in beat_chart.DIFFICULTIES:
                chart, notes, twilight_count, analysis = beat_chart._difficulty_chart(
                    onset_doc["onsets"], settings, onset_doc["source_duration_seconds"],
                    profiles[difficulty], difficulty, song_id, onset_doc["source"]["sha256"],
                    pitch_cache["frames"], with_analysis=True,
                )
                self.assertEqual(envelope["charts"][difficulty], chart)
                self.assertEqual(report["controls"][difficulty], analysis["controls"])
                self.assertEqual(report["metrics"][difficulty], analysis["metrics"])
                self.assertNotIn("twilightStrength", chart)
                self.assertTrue(any(note["relative_time"] > chart["twilightAt"] for note in notes))
                expected_difficulties[difficulty] = json.dumps(chart, sort_keys=True)
                total_charts += 1
            self.assertEqual(len(set(expected_difficulties.values())), 3, song_id)
        self.assertEqual(total_charts, len(songs) * len(beat_chart.DIFFICULTIES))

    def test_first_shining_star_authoring_and_generated_chart_cover_full_recording(self):
        song_id = "the-first-shining-star"
        song = beat_chart.load_authoring_collection()[song_id]
        onset_doc = json.loads(
            (beat_chart.DEFAULT_ONSETS_DIR / f"{song_id}.beats.json").read_text()
        )
        measured_duration = onset_doc["source_duration_seconds"]
        catalog = json.loads(
            (beat_chart.PROJECT_ROOT / "data/catalog.json").read_text()
        )
        catalog_song = next(item for item in catalog["songs"] if item["id"] == song_id)
        self.assertEqual(catalog_song["id"], song_id)

        generated = json.loads(
            (beat_chart.DEFAULT_GENERATED_DIR / f"{song_id}.charts.json").read_text()
        )
        self.assertEqual(generated["source"], song["source"])
        self.assertEqual(set(generated["charts"]), set(beat_chart.DIFFICULTIES))
        expected_start = measured_duration * song["start_time"] / 100
        expected_duration = measured_duration * song["duration"] / 100
        expected_twilight = expected_duration * song["twilight_time"] / 100
        for difficulty, chart in generated["charts"].items():
            with self.subTest(difficulty=difficulty):
                self.assertAlmostEqual(chart["sourceStart"], expected_start, places=5)
                self.assertAlmostEqual(chart["duration"], expected_duration, places=5)
                self.assertAlmostEqual(chart["twilightAt"], expected_twilight, places=5)
                note_times = [note["time"] for note in chart["notes"]]
                self.assertTrue(
                    all(0 <= time < measured_duration for time in note_times)
                )
                self.assertTrue(any(time < chart["twilightAt"] for time in note_times))
                self.assertTrue(any(time > chart["twilightAt"] for time in note_times))
                self.assertTrue(all(0 <= time < expected_duration for time in note_times))

    def test_generated_chart_does_not_bake_runtime_twilight_strength(self):
        settings = {
            "start_time": 0, "duration": 100, "twilight_time": 50,
            "lane_rules": {"type": "pattern", "data": [0, 2, 1, 3]},
            "difficulties": {"easy": {"minimum_delta": 0, "stride": 1}},
        }
        chart, notes, count = beat_chart._difficulty_chart(
            [i * 0.5 for i in range(200)], settings, 100,
            {"timing": {"good_ms": 500}, "twilight": {"perfect": {"damage": 2}}},
            "easy", "sample", hashlib.sha256(b"song").hexdigest(),
        )
        self.assertGreater(count, 0)
        self.assertNotIn("twilightStrength", chart)
        self.assertEqual(chart["allowedDifficulties"], ["easy"])
        self.assertEqual(len(notes), len(chart["notes"]))

    def test_zero_twilight_notes_are_rejected(self):
        settings = {
            "start_time": 0, "duration": 10, "twilight_time": 50,
            "lane_rules": {"type": "pattern", "data": [0]},
            "difficulties": {"easy": {"minimum_delta": 0, "stride": 1}},
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
                name: {"minimum_delta": delta, "stride": stride}
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

    def test_authoring_rejects_stale_per_song_strength_override(self):
        song = self.v2_song("song.mp3")
        song["difficulties"]["normal"]["twilight_strength"] = 80
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "authoring.json"
            path.write_text(json.dumps({"schema_version": 2, "songs": {"one": song}}))
            with self.assertRaisesRegex(ValueError, "no longer authorable"):
                beat_chart.load_authoring_collection(path)

    def test_profile_percentage_only_change_does_not_stale_generated_inputs(self):
        profiles = json.loads(beat_chart.DEFAULT_DIFFICULTY_PROFILES.read_text())
        original_hash = beat_chart._profile_file_hash()
        profiles["profiles"]["normal"]["twilight_strength"] = 37
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "profiles.json"
            path.write_text(json.dumps(profiles))
            self.assertEqual(beat_chart._profile_file_hash(path), original_hash)

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
                if executable == "ffmpeg":
                    with wave.open(command[-1], "wb") as wav:
                        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(22050)
                        wav.writeframes(b"\0\0" * 4410)
                    return subprocess.CompletedProcess(command, 0, "", "")
                if executable == "aubiopitch":
                    return subprocess.CompletedProcess(
                        command, 0,
                        "".join(f"{index / 100:.2f} {48 + index % 12}\n" for index in range(10001)),
                        "",
                    )
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
                patch.object(beat_chart, "DEFAULT_PITCH_CACHE_DIR", root / "pitch-cache"),
                patch.object(beat_chart, "DEFAULT_REPORTS_DIR", root / "reports"),
                patch.object(beat_chart, "_pitch_tool_identity", return_value={
                    "ffmpeg_version": "fake ffmpeg", "ffmpeg_sha256": "f" * 64,
                    "aubiopitch_sha256": "a" * 64,
                }),
                patch.object(beat_chart, "_sha256_file", side_effect=tracking_hash),
                contextlib.redirect_stderr(stderr),
            ):
                result = beat_chart.main(["--all", "--song-config", str(config)], runner=runner)
            self.assertEqual(result, 1)
            self.assertTrue(changed_during_processing, "later-song processing must mutate the selected source")
            self.assertEqual(calls.count("aubioonset"), 0, "valid onset caches must avoid re-extraction")
            self.assertEqual(calls.count("aubiopitch"), 2, "pitch extraction runs once per source")
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
                if command[0] == "aubiopitch":
                    return subprocess.CompletedProcess(
                        command, 0,
                        "".join(f"{index / 100:.2f} {48 + index % 12}\n" for index in range(10001)),
                        "",
                    )
                raise AssertionError(command)

            with patch.object(beat_chart, "DEFAULT_GENERATED_DIR", out), patch.object(beat_chart, "DEFAULT_ONSETS_DIR", onset_dir), patch.object(beat_chart, "DEFAULT_PITCH_CACHE_DIR", root / "pitch-cache"), patch.object(beat_chart, "DEFAULT_REPORTS_DIR", root / "reports"), patch.object(beat_chart, "DEFAULT_DIFFICULTY_PROFILES", profile_path), patch.object(beat_chart, "_pitch_tool_identity", return_value={"ffmpeg_version": "fake ffmpeg", "ffmpeg_sha256": "f" * 64, "aubiopitch_sha256": "a" * 64}):
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
