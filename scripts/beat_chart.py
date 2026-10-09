"""Core helpers for turning aubio beat output into an MVP chart module."""

import math
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = PROJECT_ROOT / "data/music/The First Shining Star (Remastered).mp3"
DEFAULT_ARTIFACT = PROJECT_ROOT / "data/charts/the-first-shining-star.beats.json"
DEFAULT_CHART = PROJECT_ROOT / "src/mvp-chart.ts"
DEFAULT_SOURCE_START = 107.1
DEFAULT_DURATION = 65.8
DEFAULT_BOUNDARY = 39.2
DEFAULT_STRIDE = 4
DEFAULT_LANE_PATTERN = (0, 2, 1, 3)


def _finite_number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return value


def _validate_config(source_start, duration, boundary, stride, lane_pattern):
    source_start = _finite_number(source_start, "source_start")
    duration = _finite_number(duration, "duration")
    boundary = _finite_number(boundary, "boundary")
    if source_start < 0:
        raise ValueError("source_start must be non-negative")
    if duration <= 0:
        raise ValueError("duration must be positive")
    if not 0 < boundary < duration:
        raise ValueError("boundary must be inside the excerpt")
    if isinstance(stride, bool) or not isinstance(stride, int) or stride <= 0:
        raise ValueError("stride must be a positive integer")
    try:
        lane_pattern = tuple(lane_pattern)
    except TypeError as error:
        raise ValueError("lane_pattern must be a non-empty sequence of lanes") from error
    if not lane_pattern or any(
        isinstance(lane, bool) or not isinstance(lane, int) or lane not in (0, 1, 2, 3)
        for lane in lane_pattern
    ):
        raise ValueError("lane_pattern must contain only lanes 0, 1, 2, or 3")
    return source_start, duration, boundary, lane_pattern


def _chart_time_is_valid(time, duration, boundary):
    """Match the runtime chart validator's hit-envelope arithmetic exactly."""
    earliest = time - 0.35
    latest = time + 0.35
    if earliest < 0:
        return False
    if time == boundary:
        return False
    if time < boundary:
        if latest >= boundary - 0.5:
            return False
    elif earliest <= boundary + 0.5:
        return False
    if latest > duration - 0.5:
        return False
    return True


def parse_beats(text):
    """Parse one numeric timestamp per line, rejecting non-beat CLI chatter."""
    if not isinstance(text, str):
        raise ValueError("beat output must be text")
    beats = []
    for line_number, line in enumerate(text.splitlines(), 1):
        value_text = line.strip()
        if not value_text:
            continue
        try:
            value = float(value_text)
        except ValueError as error:
            raise ValueError(f"invalid beat timestamp on line {line_number}: {line!r}") from error
        if not math.isfinite(value) or value < 0:
            raise ValueError(f"beat timestamp on line {line_number} must be finite and non-negative")
        if beats and value <= beats[-1]:
            raise ValueError("beat timestamps must be strictly increasing and unique")
        beats.append(value)
    return beats


def select_notes(
    beats,
    source_start=107.1,
    duration=65.8,
    boundary=39.2,
    stride=4,
    lane_pattern=(0, 2, 1, 3),
):
    source_start, duration, boundary, lane_pattern = _validate_config(
        source_start, duration, boundary, stride, lane_pattern
    )
    try:
        source_beats = tuple(_finite_number(beat, "beat timestamp") for beat in beats)
    except TypeError as error:
        raise ValueError("beats must be an iterable of timestamps") from error
    for previous, current in zip(source_beats, source_beats[1:]):
        if current <= previous:
            raise ValueError("beat timestamps must be strictly increasing and unique")
    if any(beat < 0 for beat in source_beats):
        raise ValueError("beat timestamps must be non-negative")

    first_index = next(
        (index for index, beat in enumerate(source_beats) if beat >= source_start),
        len(source_beats),
    )
    selected = []
    excerpt_end = source_start + duration
    boundary_source_time = source_start + boundary
    for index in range(first_index, len(source_beats), stride):
        source_time = source_beats[index]
        relative_time = source_time - source_start
        # Apply the raw timestamp guards in source coordinates first, then
        # validate the serialized relative value with chart-validator math.
        if source_time < source_start + 0.35:
            continue
        if source_time > excerpt_end - 0.85:
            continue
        if boundary_source_time - 0.85 <= source_time <= boundary_source_time + 0.85:
            continue
        rendered_time = round(relative_time, 6)
        if not _chart_time_is_valid(rendered_time, duration, boundary):
            continue
        selected.append(
            {
                "source_beat_index": index,
                "source_time": source_time,
                "relative_time": rendered_time,
                "lane": lane_pattern[len(selected) % len(lane_pattern)],
            }
        )
    return selected


def render_mvp_chart(
    notes,
    source_start=107.1,
    duration=65.8,
    twilight_at=39.2,
    source_sha256="",
):
    source_start = _finite_number(source_start, "source_start")
    duration = _finite_number(duration, "duration")
    twilight_at = _finite_number(twilight_at, "twilight_at")
    if source_start < 0 or duration <= 0 or not 0 < twilight_at < duration:
        raise ValueError("invalid chart configuration")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", source_sha256):
        raise ValueError("source_sha256 must be a 64-character SHA-256 hex digest")
    generated_notes = []
    audience_index = 0
    twilight_index = 0
    seen_times = set()
    for note in notes:
        time = _finite_number(note["relative_time"], "note relative_time")
        rendered_time = float(f"{time:.6f}")
        lane = note["lane"]
        if isinstance(lane, bool) or not isinstance(lane, int) or lane not in (0, 1, 2, 3):
            raise ValueError("note lane must be 0, 1, 2, or 3")
        if rendered_time in seen_times:
            raise ValueError("simultaneous notes are not supported")
        seen_times.add(rendered_time)
        if not _chart_time_is_valid(rendered_time, duration, twilight_at):
            raise ValueError("note time violates chart hit-window guards")
        if rendered_time < twilight_at:
            audience_index += 1
            note_id = f"a{audience_index:02d}"
        else:
            twilight_index += 1
            note_id = f"t{twilight_index:02d}"
        generated_notes.append(
            f"    {{ id: '{note_id}', time: {rendered_time!r}, lane: {lane} }}, "
            f"// rounded beat time: {rendered_time:.6f}"
        )
    body = "\n".join(generated_notes)
    return (
        "import type { ChartConfig } from './chart';\n\n"
        "/** Generated from music-derived beat tracking; not human-verified. */\n"
        f"// Source SHA-256: {source_sha256.lower()}\n"
        "export const MVP_CHART: ChartConfig = {\n"
        f"  sourceStart: {source_start!r},\n"
        f"  duration: {duration!r},\n"
        f"  twilightAt: {twilight_at!r},\n"
        "  notes: [\n"
        f"{body}\n"
        "  ],\n"
        "};\n"
    )


def verify_source_sha256(actual, expected):
    if actual != expected:
        raise ValueError("source SHA-256 mismatch")
    return None


def _sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source_file:
        for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _project_relative_source(source):
    try:
        return source.relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return str(source)


def _chart_config(args):
    source_start, duration, boundary, lane_pattern = _validate_config(
        args.source_start,
        args.duration,
        args.boundary,
        args.stride,
        DEFAULT_LANE_PATTERN,
    )
    return {
        "source_start": source_start,
        "duration": duration,
        "boundary": boundary,
        "stride": args.stride,
        "lane_pattern": list(lane_pattern),
    }


def _render_from_artifact(artifact, config):
    if not isinstance(artifact, dict):
        raise ValueError("beat artifact must be a JSON object")
    if artifact.get("config") != config:
        raise ValueError("cached beat artifact uses different chart settings")
    beats = parse_beats("\n".join(str(value) for value in artifact.get("beats", [])))
    notes = select_notes(
        beats,
        source_start=config["source_start"],
        duration=config["duration"],
        boundary=config["boundary"],
        stride=config["stride"],
        lane_pattern=config["lane_pattern"],
    )
    if artifact.get("notes") != notes:
        raise ValueError("cached beat artifact note projection is stale or malformed")
    return render_mvp_chart(
        notes,
        source_start=config["source_start"],
        duration=config["duration"],
        twilight_at=config["boundary"],
        source_sha256=artifact["source_sha256"],
    )


def _atomic_write(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _run_process(runner, command, label):
    try:
        result = runner(command, capture_output=True, text=True, check=False)
    except OSError as error:
        raise RuntimeError(f"Could not start {label}: {error}") from error
    if result.returncode != 0:
        detail = (result.stderr or "").strip()
        suffix = f": {detail}" if detail else ""
        raise RuntimeError(f"{label} failed with exit code {result.returncode}{suffix}")
    return result


def _build_commands(source, wav_path):
    ffmpeg = [
        "ffmpeg", "-nostdin", "-y", "-i", str(source), "-ac", "1", "-ar", "44100",
        "-sample_fmt", "s16", "-c:a", "pcm_s16le", str(wav_path),
    ]
    aubio = ["aubiotrack", "-T", "seconds", "-i", str(wav_path)]
    return ffmpeg, aubio


def _recorded_commands():
    return [
        [
            "ffmpeg", "-nostdin", "-y", "-i", "{sourceAudio}", "-ac", "1", "-ar",
            "44100", "-sample_fmt", "s16", "-c:a", "pcm_s16le", "{analysisWav}",
        ],
        ["aubiotrack", "-T", "seconds", "-i", "{analysisWav}"],
    ]


def _ensure_safe_destinations(source, artifact_path, chart_path):
    source = source.resolve()
    artifact_path = artifact_path.resolve()
    chart_path = chart_path.resolve()
    if artifact_path == source or chart_path == source:
        raise ValueError("generated outputs must not overwrite the source audio")
    if artifact_path == chart_path:
        raise ValueError("artifact and chart outputs must be different files")


def _generate(source, artifact_path, chart_path, config, runner):
    source = source.resolve(strict=True)
    if not source.is_file():
        raise ValueError(f"source audio is not a file: {source}")
    artifact_path = artifact_path.resolve()
    chart_path = chart_path.resolve()
    _ensure_safe_destinations(source, artifact_path, chart_path)
    source_hash = _sha256_file(source)

    with tempfile.TemporaryDirectory(prefix="beat-chart-") as temp_dir:
        wav_path = Path(temp_dir) / "analysis.wav"
        ffmpeg_command, aubio_command = _build_commands(source, wav_path)
        _run_process(runner, ffmpeg_command, "FFmpeg audio conversion")
        aubio_result = _run_process(runner, aubio_command, "aubio beat tracking")
        beats = parse_beats(aubio_result.stdout or "")
        notes = select_notes(
            beats,
            source_start=config["source_start"],
            duration=config["duration"],
            boundary=config["boundary"],
            stride=config["stride"],
            lane_pattern=config["lane_pattern"],
        )
        artifact = {
            "schema_version": 1,
            "source": {
                "path": _project_relative_source(source),
                "sha256": source_hash,
            },
            "source_sha256": source_hash,
            "config": config,
            "beats": beats,
            "notes": notes,
            "commands": _recorded_commands(),
            "tools": {"ffmpeg": "ffmpeg", "aubiotrack": "aubiotrack"},
        }
        chart_text = _render_from_artifact(artifact, config)
        artifact_text = json.dumps(artifact, indent=2, sort_keys=True, allow_nan=False) + "\n"

    if _sha256_file(source) != source_hash:
        raise RuntimeError("source audio changed during chart generation; outputs were not written")
    # Each destination is replaced atomically after both complete outputs have
    # been constructed and validated. The pair is not a cross-file transaction.
    _atomic_write(artifact_path, artifact_text)
    _atomic_write(chart_path, chart_text)


def _check_cached(source, artifact_path, chart_path, config):
    source = source.resolve(strict=True)
    if not source.is_file():
        raise ValueError(f"source audio is not a file: {source}")
    _ensure_safe_destinations(source, artifact_path, chart_path)
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    actual_hash = _sha256_file(source)
    verify_source_sha256(actual_hash, artifact.get("source_sha256"))
    if artifact.get("source", {}).get("sha256") != actual_hash:
        raise ValueError("cached artifact source provenance does not match current audio")
    expected_source_path = _project_relative_source(source)
    if artifact.get("source", {}).get("path") != expected_source_path:
        raise ValueError("cached artifact refers to a different source audio path")
    expected_chart = _render_from_artifact(artifact, config)
    actual_chart = chart_path.read_text(encoding="utf-8")
    if actual_chart != expected_chart:
        raise ValueError("generated chart is stale; regenerate it from the cached beat artifact")


def _argument_parser():
    parser = argparse.ArgumentParser(
        description="Generate a low-density chart from full-track aubio beat timestamps."
    )
    parser.add_argument("source", nargs="?", type=Path, help="full source audio")
    parser.add_argument("--source", dest="source_option", type=Path, help="full source audio")
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--chart", type=Path, default=DEFAULT_CHART)
    parser.add_argument("--source-start", type=float, default=DEFAULT_SOURCE_START)
    parser.add_argument("--duration", type=float, default=DEFAULT_DURATION)
    parser.add_argument("--boundary", type=float, default=DEFAULT_BOUNDARY)
    parser.add_argument("--stride", type=int, default=DEFAULT_STRIDE)
    parser.add_argument("--check", action="store_true", help="validate cached provenance and chart")
    return parser


def main(argv=None, runner=None):
    """Run generation or validate the artifact and chart without external tools."""
    parser = _argument_parser()
    args = parser.parse_args(argv)
    source = (args.source_option or args.source or DEFAULT_SOURCE).resolve()
    artifact_path = args.artifact.resolve()
    chart_path = args.chart.resolve()
    try:
        config = _chart_config(args)
        if args.check:
            _check_cached(source, artifact_path, chart_path, config)
        else:
            _generate(source, artifact_path, chart_path, config, runner or subprocess.run)
    except (
        OSError,
        ValueError,
        RuntimeError,
        json.JSONDecodeError,
        TypeError,
        KeyError,
        AttributeError,
    ) as error:
        print(f"beat-chart: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
