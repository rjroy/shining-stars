"""Workflow contract tests using a fake subprocess runner and synthetic input."""

import hashlib
import json
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path

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
            if executable == "aubiotrack":
                code = 1 if fail == "aubiotrack-exit" else 0
                return subprocess.CompletedProcess(command, code, aubio_stdout, "bad output")
            raise AssertionError(f"unexpected executable: {executable}")

        return runner

    def args(self, *extra):
        return [
            str(self.source),
            "--artifact", str(self.artifact),
            "--chart", str(self.chart),
            *extra,
        ]

    def generate(self, runner=None):
        return beat_chart.main(self.args(), runner=runner or self.make_runner())

    def seed_outputs(self):
        self.artifact.parent.mkdir(parents=True, exist_ok=True)
        self.chart.parent.mkdir(parents=True, exist_ok=True)
        self.artifact.write_text("prior artifact\n", encoding="utf-8")
        self.chart.write_text("prior chart\n", encoding="utf-8")
        return self.artifact.read_bytes(), self.chart.read_bytes()

    def test_generates_provenance_artifact_and_chart_from_full_track_beats(self):
        self.assertEqual(self.generate(), 0)
        artifact = json.loads(self.artifact.read_text(encoding="utf-8"))
        expected_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.assertEqual(artifact["source_sha256"], expected_hash)
        self.assertEqual(len(artifact["beats"]), 20)
        self.assertEqual(
            [note["source_beat_index"] for note in artifact["notes"]], [4, 8, 12, 16]
        )
        self.assertEqual(
            [note["relative_time"] for note in artifact["notes"]], [2.0, 4.0, 6.0, 8.0]
        )
        chart = self.chart.read_text(encoding="utf-8")
        for note in artifact["notes"]:
            self.assertIn(f"time: {note['relative_time']:.6f}", chart)
        self.assertEqual(len(artifact["commands"]), 2)
        ffmpeg_command, aubio_command = artifact["commands"]
        self.assertEqual(Path(ffmpeg_command[0]).name, "ffmpeg")
        self.assertEqual(Path(aubio_command[0]).name, "aubiotrack")

        ffmpeg_call = self.calls[0][0]
        self.assertEqual(ffmpeg_call[ffmpeg_call.index("-i") + 1], str(self.source))
        self.assertFalse(any(flag in ("-ss", "-t") for flag in ffmpeg_call))
        self.assertEqual(ffmpeg_call[ffmpeg_call.index("-ac") + 1], "1")
        self.assertEqual(ffmpeg_call[ffmpeg_call.index("-ar") + 1], "44100")
        self.assertEqual(ffmpeg_call[ffmpeg_call.index("-sample_fmt") + 1], "s16")
        aubio_call = self.calls[1][0]
        self.assertEqual(aubio_call[1:3], ["-T", "seconds"])
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
        self.assertNotEqual(self.generate(self.make_runner(fail="aubiotrack-exit")), 0)
        self.assertEqual(len(self.calls), 2, "workflow should invoke both configured tools")
        wav_path = Path(self.calls[0][0][-1])
        self.assertFalse(wav_path.exists())
        self.assertEqual((self.artifact.read_bytes(), self.chart.read_bytes()), prior)

    def test_missing_tracking_tool_preserves_outputs_and_cleans_temporary_wav(self):
        prior = self.seed_outputs()
        self.assertNotEqual(self.generate(self.make_runner(fail="aubiotrack")), 0)
        self.assertEqual(len(self.calls), 2, "workflow should attempt tracking after WAV extraction")
        wav_path = Path(self.calls[0][0][-1])
        self.assertFalse(wav_path.exists())
        self.assertEqual((self.artifact.read_bytes(), self.chart.read_bytes()), prior)


if __name__ == "__main__":
    unittest.main()
