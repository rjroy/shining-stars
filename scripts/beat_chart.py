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
DEFAULT_CHART = PROJECT_ROOT / "src/game/mvp-chart.ts"
DEFAULT_SONG_CONFIG = PROJECT_ROOT / "data/charts/song-authoring.json"
DEFAULT_DIFFICULTY_PROFILES = PROJECT_ROOT / "data/charts/difficulty-profiles.json"
DEFAULT_SONG_ID = "the-first-shining-star"
DEFAULT_SOURCE_START = 107.1
DEFAULT_DURATION = 65.8
DEFAULT_BOUNDARY = 39.2
DEFAULT_TWILIGHT_STRENGTH = 100
DEFAULT_STRIDE = 2
DEFAULT_MINIMUM_DELTA_MS = 64
DEFAULT_LANE_PATTERN = (0, 2, 1, 3)
MAX_INPUT_OFFSET_SECONDS = 0.2


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


def load_difficulty_profiles(path=None):
    """Load and validate the shared gameplay profiles used by runtime and tooling."""
    if path is None:
        path = DEFAULT_DIFFICULTY_PROFILES
    document = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("profiles"), dict):
        raise ValueError("difficulty profile file must contain a profiles object")
    profiles = document["profiles"]
    if set(profiles) != {"easy", "normal", "hard"}:
        raise ValueError("difficulty profiles must define easy, normal, and hard")

    validated = {}
    for difficulty in ("easy", "normal", "hard"):
        profile = profiles[difficulty]
        if not isinstance(profile, dict):
            raise ValueError(f"difficulty profile {difficulty} must be an object")
        timing = profile.get("timing")
        audience = profile.get("audience")
        twilight = profile.get("twilight")
        if not all(isinstance(value, dict) for value in (timing, audience, twilight)):
            raise ValueError(f"difficulty profile {difficulty} has an invalid shape")

        perfect_ms = _finite_number(timing.get("perfect_ms"), "perfect_ms")
        good_ms = _finite_number(timing.get("good_ms"), "good_ms")
        if perfect_ms <= 0 or good_ms < perfect_ms:
            raise ValueError(f"difficulty profile {difficulty} has invalid timing windows")
        parsed_audience = {}
        for quality in ("perfect", "good", "miss"):
            value = _finite_number(audience.get(quality), f"audience.{quality}")
            if value < 0:
                raise ValueError(f"audience.{quality} must be non-negative")
            parsed_audience[quality] = value
        parsed_twilight = {}
        for quality in ("perfect", "good", "miss"):
            outcome = twilight.get(quality)
            if not isinstance(outcome, dict):
                raise ValueError(f"twilight.{quality} must be an object")
            cost = _finite_number(outcome.get("personal_cost"), f"twilight.{quality}.personal_cost")
            damage = _finite_number(outcome.get("damage"), f"twilight.{quality}.damage")
            if cost < 0 or damage < 0:
                raise ValueError(f"twilight.{quality} values must be non-negative")
            parsed_twilight[quality] = {
                "personal_cost": cost,
                "damage": damage,
            }
        validated[difficulty] = {
            "timing": {"perfect_ms": perfect_ms, "good_ms": good_ms},
            "audience": parsed_audience,
            "twilight": parsed_twilight,
        }
    return validated


def _validate_allowed_difficulties(value, profiles=None):
    if profiles is None:
        profiles = load_difficulty_profiles()
    if not isinstance(value, list) or not value:
        raise ValueError("allowed_difficulties must be a non-empty array")
    allowed = []
    seen = set()
    for difficulty in value:
        if not isinstance(difficulty, str) or difficulty not in profiles:
            raise ValueError(f"unknown allowed difficulty: {difficulty!r}")
        if difficulty in seen:
            raise ValueError(f"duplicate allowed difficulty: {difficulty}")
        seen.add(difficulty)
        allowed.append(difficulty)
    return allowed


def _chart_time_is_valid(time, duration, boundary, good_window_seconds=None):
    """Match the runtime chart validator's hit-envelope arithmetic exactly."""
    if good_window_seconds is None:
        good_window_seconds = load_difficulty_profiles()["normal"]["timing"]["good_ms"] / 1000
    timing_envelope = good_window_seconds + MAX_INPUT_OFFSET_SECONDS
    earliest = time - timing_envelope
    latest = time + timing_envelope
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


def parse_onsets(text):
    """Parse onset timestamps, rejecting nonnumeric aubio CLI chatter."""
    if not isinstance(text, str):
        raise ValueError("onset output must be text")
    onsets = []
    for line_number, line in enumerate(text.splitlines(), 1):
        value_text = line.strip()
        if not value_text:
            continue
        try:
            value = float(value_text)
        except ValueError as error:
            raise ValueError(f"invalid onset timestamp on line {line_number}: {line!r}") from error
        if not math.isfinite(value) or value < 0:
            raise ValueError(f"onset timestamp on line {line_number} must be finite and non-negative")
        if onsets and value <= onsets[-1]:
            raise ValueError("onset timestamps must be strictly increasing and unique")
        onsets.append(value)
    return onsets


# Kept as a compatibility alias for callers of the original helper.
parse_beats = parse_onsets


def select_notes(
    onsets,
    source_start=107.1,
    duration=65.8,
    boundary=39.2,
    stride=DEFAULT_STRIDE,
    lane_pattern=(0, 2, 1, 3),
    minimum_delta_ms=DEFAULT_MINIMUM_DELTA_MS,
    allowed_difficulties=("normal",),
):
    source_start, duration, boundary, lane_pattern = _validate_config(
        source_start, duration, boundary, stride, lane_pattern
    )
    minimum_delta_ms = _finite_number(minimum_delta_ms, "minimum_delta_ms")
    if minimum_delta_ms < 0:
        raise ValueError("minimum_delta_ms must be non-negative")
    profiles = load_difficulty_profiles()
    allowed_difficulties = _validate_allowed_difficulties(
        list(allowed_difficulties), profiles
    )
    good_window_seconds = max(
        profiles[difficulty]["timing"]["good_ms"]
        for difficulty in allowed_difficulties
    ) / 1000
    timing_envelope = good_window_seconds + MAX_INPUT_OFFSET_SECONDS
    try:
        source_onsets = tuple(_finite_number(onset, "onset timestamp") for onset in onsets)
    except TypeError as error:
        raise ValueError("onsets must be an iterable of timestamps") from error
    for previous, current in zip(source_onsets, source_onsets[1:]):
        if current <= previous:
            raise ValueError("onset timestamps must be strictly increasing and unique")
    if any(onset < 0 for onset in source_onsets):
        raise ValueError("onset timestamps must be non-negative")

    first_index = next(
        (index for index, onset in enumerate(source_onsets) if onset >= source_start),
        len(source_onsets),
    )
    excerpt_end = source_start + duration
    boundary_source_time = source_start + boundary
    retained = []
    for index in range(first_index, len(source_onsets)):
        source_time = source_onsets[index]
        if source_time >= excerpt_end:
            break
        if retained:
            elapsed_ms = (source_time - retained[-1][1]) * 1000
            # Decimal millisecond intervals often arrive through binary float
            # seconds (e.g. 0.064); tolerate representation noise at equality.
            if elapsed_ms < minimum_delta_ms and not math.isclose(
                elapsed_ms, minimum_delta_ms, rel_tol=1e-12, abs_tol=1e-9
            ):
                continue
        retained.append((index, source_time))

    selected = []
    for index, source_time in retained[::stride]:
        relative_time = source_time - source_start
        # Apply the raw timestamp guards in source coordinates first, then
        # validate the serialized relative value with chart-validator math.
        if source_time < source_start + timing_envelope:
            continue
        if source_time > excerpt_end - timing_envelope - 0.5:
            continue
        handoff_guard = timing_envelope + 0.5
        if boundary_source_time - handoff_guard <= source_time <= boundary_source_time + handoff_guard:
            continue
        rendered_time = round(relative_time, 6)
        if not _chart_time_is_valid(
            rendered_time, duration, boundary, good_window_seconds
        ):
            continue
        selected.append(
            {
                "source_onset_index": index,
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
    twilight_strength=DEFAULT_TWILIGHT_STRENGTH,
    allowed_difficulties=("normal",),
):
    source_start = _finite_number(source_start, "source_start")
    duration = _finite_number(duration, "duration")
    twilight_at = _finite_number(twilight_at, "twilight_at")
    twilight_strength = _finite_number(twilight_strength, "twilight_strength")
    if source_start < 0 or duration <= 0 or not 0 < twilight_at < duration:
        raise ValueError("invalid chart configuration")
    if twilight_strength <= 0:
        raise ValueError("twilight_strength must be positive")
    profiles = load_difficulty_profiles()
    allowed_difficulties = _validate_allowed_difficulties(
        list(allowed_difficulties), profiles
    )
    good_window_seconds = max(
        profiles[difficulty]["timing"]["good_ms"]
        for difficulty in allowed_difficulties
    ) / 1000
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
        if not _chart_time_is_valid(
            rendered_time, duration, twilight_at, good_window_seconds
        ):
            raise ValueError("note time violates chart hit-window guards")
        if rendered_time < twilight_at:
            audience_index += 1
            note_id = f"a{audience_index:02d}"
        else:
            twilight_index += 1
            note_id = f"t{twilight_index:02d}"
        generated_notes.append(
            f"    {{ id: '{note_id}', time: {rendered_time!r}, lane: {lane} }}, "
            f"// rounded onset time: {rendered_time:.6f}"
        )
    body = "\n".join(generated_notes)
    return (
        "import type { ChartConfig } from './chart';\n\n"
        "/** Generated from music-derived onset detection; not human-verified. */\n"
        f"// Source SHA-256: {source_sha256.lower()}\n"
        "export const MVP_CHART: ChartConfig = {\n"
        f"  sourceStart: {source_start!r},\n"
        f"  duration: {duration!r},\n"
        f"  twilightAt: {twilight_at!r},\n"
        f"  twilightStrength: {twilight_strength!r},\n"
        f"  allowedDifficulties: {allowed_difficulties!r},\n"
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


def _validate_song_settings(song_id, settings):
    if not isinstance(song_id, str) or not song_id.strip():
        raise ValueError("song ID must be a non-empty string")
    if not isinstance(settings, dict):
        raise ValueError(f"song settings for {song_id!r} must be an object")
    source = settings.get("source")
    if not isinstance(source, str) or not source.strip():
        raise ValueError(f"song {song_id!r} source must be a non-empty path")
    start_time = _finite_number(settings.get("start_time"), "start_time")
    twilight_time = _finite_number(settings.get("twilight_time"), "twilight_time")
    duration = _finite_number(settings.get("duration"), "duration")
    twilight_strength = _finite_number(
        settings.get("twilight_strength"), "twilight_strength"
    )
    minimum_delta = _finite_number(settings.get("minimum_delta"), "minimum_delta")
    allowed_difficulties = _validate_allowed_difficulties(
        settings.get("allowed_difficulties")
    )
    stride = settings.get("stride")
    lane_rules = settings.get("lane_rules")
    if start_time < 0:
        raise ValueError("start_time must be non-negative")
    if duration <= 0:
        raise ValueError("duration must be positive")
    if twilight_strength <= 0:
        raise ValueError("twilight_strength must be positive")
    if not 0 < twilight_time < duration:
        raise ValueError("twilight_time must be inside the excerpt")
    if minimum_delta < 0:
        raise ValueError("minimum_delta must be non-negative")
    if isinstance(stride, bool) or not isinstance(stride, int) or stride <= 0:
        raise ValueError("stride must be a positive integer")
    if (
        not isinstance(lane_rules, dict)
        or lane_rules.get("type") != "pattern"
        or not isinstance(lane_rules.get("data"), list)
        or not lane_rules["data"]
        or any(
            isinstance(lane, bool)
            or not isinstance(lane, int)
            or lane not in (0, 1, 2, 3)
            for lane in lane_rules["data"]
        )
    ):
        raise ValueError("lane_rules must be a non-empty pattern of lanes 0, 1, 2, or 3")
    return {
        "source": source,
        "start_time": start_time,
        "twilight_time": twilight_time,
        "duration": duration,
        "twilight_strength": twilight_strength,
        "allowed_difficulties": allowed_difficulties,
        "minimum_delta": minimum_delta,
        "stride": stride,
        "lane_rules": {"type": "pattern", "data": list(lane_rules["data"])},
    }


def load_song_config(path=DEFAULT_SONG_CONFIG, song_id=DEFAULT_SONG_ID):
    """Load and validate one song from the authoring-settings collection."""
    document = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("songs"), dict):
        raise ValueError("song authoring config must contain a songs object")
    if song_id not in document["songs"]:
        raise ValueError(f"unknown song ID: {song_id}")
    return _validate_song_settings(song_id, document["songs"][song_id])


def _chart_config(args, song_id, settings):
    source_start, duration, boundary, lane_pattern = _validate_config(
        settings["start_time"] if args.source_start is None else args.source_start,
        settings["duration"] if args.duration is None else args.duration,
        settings["twilight_time"] if args.boundary is None else args.boundary,
        settings["stride"] if args.stride is None else args.stride,
        settings["lane_rules"]["data"],
    )
    minimum_delta_ms = _finite_number(
        settings["minimum_delta"] if args.minimum_delta is None else args.minimum_delta,
        "minimum_delta",
    )
    if minimum_delta_ms < 0:
        raise ValueError("minimum_delta must be non-negative")
    profiles = load_difficulty_profiles()
    maximum_allowed_good_window_ms = max(
        profiles[difficulty]["timing"]["good_ms"]
        for difficulty in settings["allowed_difficulties"]
    )
    return {
        "song_id": song_id,
        "source_start": source_start,
        "duration": duration,
        "twilight_strength": settings["twilight_strength"],
        "allowed_difficulties": settings["allowed_difficulties"],
        "maximum_allowed_good_window_ms": maximum_allowed_good_window_ms,
        "boundary": boundary,
        "stride": settings["stride"] if args.stride is None else args.stride,
        "lane_pattern": list(lane_pattern),
        "minimum_delta_ms": minimum_delta_ms,
    }


def _render_from_artifact(artifact, config):
    if not isinstance(artifact, dict):
        raise ValueError("beat artifact must be a JSON object")
    if artifact.get("config") != config:
        raise ValueError("cached beat artifact uses different chart settings")
    onsets = parse_onsets("\n".join(str(value) for value in artifact.get("onsets", [])))
    notes = select_notes(
        onsets,
        source_start=config["source_start"],
        duration=config["duration"],
        boundary=config["boundary"],
        stride=config["stride"],
        lane_pattern=config["lane_pattern"],
        minimum_delta_ms=config["minimum_delta_ms"],
        allowed_difficulties=config["allowed_difficulties"],
    )
    if artifact.get("notes") != notes:
        raise ValueError("cached beat artifact note projection is stale or malformed")
    return render_mvp_chart(
        notes,
        source_start=config["source_start"],
        duration=config["duration"],
        twilight_at=config["boundary"],
        source_sha256=artifact["source_sha256"],
        twilight_strength=config["twilight_strength"],
        allowed_difficulties=config["allowed_difficulties"],
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
    aubio = [
        "aubioonset", "-T", "seconds", "-O", "hfc", "-t0.3", "-M0.012", "-s-90",
        "-i", str(wav_path),
    ]
    return ffmpeg, aubio


def _recorded_commands():
    return [
        [
            "ffmpeg", "-nostdin", "-y", "-i", "{sourceAudio}", "-ac", "1", "-ar",
            "44100", "-sample_fmt", "s16", "-c:a", "pcm_s16le", "{analysisWav}",
        ],
        ["aubioonset", "-T", "seconds", "-O", "hfc", "-t0.3", "-M0.012", "-s-90", "-i", "{analysisWav}"],
    ]


def _ensure_safe_destinations(source, artifact_path, chart_path):
    source = source.resolve()
    artifact_path = artifact_path.resolve()
    chart_path = chart_path.resolve()
    if artifact_path == source or chart_path == source:
        raise ValueError("generated outputs must not overwrite the source audio")
    if artifact_path == chart_path:
        raise ValueError("artifact and chart outputs must be different files")


def _ensure_source_output_policy(source, artifact_path, chart_path, artifact_explicit, chart_explicit):
    source = Path(source).resolve()
    if source == DEFAULT_SOURCE.resolve():
        return
    if not artifact_explicit or not chart_explicit:
        raise ValueError(
            "a non-runtime source requires explicit isolated --artifact and --chart paths"
        )
    protected_outputs = {DEFAULT_ARTIFACT.resolve(), DEFAULT_CHART.resolve()}
    selected_outputs = {Path(artifact_path).resolve(), Path(chart_path).resolve()}
    if selected_outputs & protected_outputs:
        raise ValueError(
            "a non-runtime source cannot write the live chart or artifact; "
            "choose isolated --artifact and --chart paths"
        )


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
        aubio_result = _run_process(runner, aubio_command, "aubio onset detection")
        onsets = parse_onsets(aubio_result.stdout or "")
        notes = select_notes(
            onsets,
            source_start=config["source_start"],
            duration=config["duration"],
            boundary=config["boundary"],
            stride=config["stride"],
            lane_pattern=config["lane_pattern"],
            minimum_delta_ms=config["minimum_delta_ms"],
            allowed_difficulties=config["allowed_difficulties"],
        )
        artifact = {
            "schema_version": 1,
            "source": {
                "path": _project_relative_source(source),
                "sha256": source_hash,
            },
            "source_sha256": source_hash,
            "config": config,
            "onsets": onsets,
            "notes": notes,
            "commands": _recorded_commands(),
            "tools": {"ffmpeg": "ffmpeg", "aubioonset": "aubioonset"},
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
        description="Generate a low-density chart from full-track aubio onset timestamps."
    )
    parser.add_argument("source", nargs="?", type=Path, help="full source audio")
    parser.add_argument("--source", dest="source_option", type=Path, help="full source audio")
    parser.add_argument("--song-config", type=Path, default=DEFAULT_SONG_CONFIG)
    parser.add_argument("--song", default=DEFAULT_SONG_ID, help="song ID in the authoring config")
    parser.add_argument("--artifact", type=Path, help="artifact output path")
    parser.add_argument("--chart", type=Path, help="generated chart output path")
    parser.add_argument("--source-start", type=float)
    parser.add_argument("--duration", type=float)
    parser.add_argument("--boundary", type=float)
    parser.add_argument("--stride", type=int)
    parser.add_argument("--minimum-delta", type=float, help="minimum onset spacing in milliseconds")
    parser.add_argument("--check", action="store_true", help="validate cached provenance and chart")
    return parser


def main(argv=None, runner=None):
    """Run generation or validate the artifact and chart without external tools."""
    parser = _argument_parser()
    args = parser.parse_args(argv)
    try:
        settings = load_song_config(args.song_config, args.song)
        config = _chart_config(args, args.song, settings)
        source_override = args.source_option or args.source
        if source_override is not None:
            source = source_override.resolve()
        else:
            source = Path(settings["source"])
            if not source.is_absolute():
                source = PROJECT_ROOT / source
            source = source.resolve()
        artifact_path = (args.artifact or DEFAULT_ARTIFACT).resolve()
        chart_path = (args.chart or DEFAULT_CHART).resolve()
        _ensure_source_output_policy(
            source,
            artifact_path,
            chart_path,
            artifact_explicit=args.artifact is not None,
            chart_explicit=args.chart is not None,
        )
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
