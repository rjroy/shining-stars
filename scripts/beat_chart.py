"""Core helpers for turning aubio beat output into an MVP chart module."""

import math
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

if __package__:
    from .pitch_lanes import map_lanes, validate_lane_mapping
    from . import pitch_analysis
else:
    try:
        from scripts.pitch_lanes import map_lanes, validate_lane_mapping
        from scripts import pitch_analysis
    except ModuleNotFoundError as exc:
        if exc.name != "scripts":
            raise
        from pitch_lanes import map_lanes, validate_lane_mapping
        import pitch_analysis


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
ONSET_DEFAULTS = {"algorithm": "specflux", "minioi": 0.032, "threshold": 0.40, "silence": -20.0}
ONSET_ALGORITHMS = {
    "default", "energy", "hfc", "complex", "phase", "specdiff", "kl", "mkl", "specflux"
}
DEFAULT_LANE_PATTERN = (0, 2, 1, 3)
DEFAULT_GENERATED_DIR = PROJECT_ROOT / "data/charts/generated"
DEFAULT_ONSETS_DIR = PROJECT_ROOT / "data/charts/onsets"
DEFAULT_PITCH_CACHE_DIR = PROJECT_ROOT / "data/charts/pitch-cache"
DEFAULT_REPORTS_DIR = PROJECT_ROOT / "data/charts/reports"
PITCH_RECIPE_VERSION = pitch_analysis.PITCH_RECIPE_VERSION
PITCH_RECIPE_ARGS = pitch_analysis.PITCH_RECIPE_ARGS
DIFFICULTIES = ("easy", "normal", "hard")
SCORING_VERSION = 1
DIFFICULTY_AUTHORING = {
    "easy": {"twilight_strength": 70, "minimum_delta": 64, "stride": 3},
    "normal": {"twilight_strength": 80, "minimum_delta": 64, "stride": 2},
    "hard": {"twilight_strength": 90, "minimum_delta": 50, "stride": 1},
}
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

        strength_percent = _finite_number(profile.get("twilight_strength"), "twilight_strength")
        if not 0 < strength_percent <= 100:
            raise ValueError(f"difficulty profile {difficulty} has invalid twilight_strength")

        perfect_ms = _finite_number(timing.get("perfect_ms"), "perfect_ms")
        good_ms = _finite_number(timing.get("good_ms"), "good_ms")
        if perfect_ms <= 0 or good_ms < perfect_ms:
            raise ValueError(f"difficulty profile {difficulty} has invalid timing windows")
        parsed_audience = {}
        for quality in ("perfect", "good", "miss"):
            value = _finite_number(audience.get(quality), f"audience.{quality}")
            if quality != "miss" and value < 0:
                raise ValueError(f"audience.{quality} must be non-negative")
            parsed_audience[quality] = value
        parsed_twilight = {}
        for quality in ("perfect", "good", "miss"):
            outcome = twilight.get(quality)
            if not isinstance(outcome, dict):
                raise ValueError(f"twilight.{quality} must be an object")
            cost = _finite_number(outcome.get("personal_cost"), f"twilight.{quality}.personal_cost")
            damage = _finite_number(outcome.get("damage"), f"twilight.{quality}.damage")
            if quality != "miss" and (cost < 0 or damage < 0):
                raise ValueError(f"twilight.{quality} values must be non-negative")
            parsed_twilight[quality] = {
                "personal_cost": cost,
                "damage": damage,
            }
        validated[difficulty] = {
            "twilight_strength": strength_percent,
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
    _reject_song_level_lane_mapping(song_id, settings)
    onset_recipe = _resolve_onset_recipe(song_id, settings)
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
    validated = {
        "source": source,
        "start_time": start_time,
        "twilight_time": twilight_time,
        "duration": duration,
        "twilight_strength": twilight_strength,
        "allowed_difficulties": allowed_difficulties,
        "minimum_delta": minimum_delta,
        "stride": stride,
        "lane_rules": {"type": "pattern", "data": list(lane_rules["data"])},
        **onset_recipe,
    }
    if "lane_mapping" in settings:
        validated["lane_mapping"] = settings["lane_mapping"]
    return validated


def _reject_song_level_lane_mapping(song_id, settings):
    if "lane_mapping" not in settings:
        return
    raise ValueError(
        f"song {song_id!r} lane_mapping must be configured under "
        "difficulties.<difficulty>.lane_mapping"
    )


def _validate_difficulty_lane_mapping(song_id, difficulty, settings):
    if "lane_mapping" not in settings:
        return
    try:
        validate_lane_mapping(settings["lane_mapping"])
    except ValueError as exc:
        raise ValueError(
            f"song {song_id!r} has invalid {difficulty} lane_mapping: {exc}"
        ) from exc


def load_song_config(path=DEFAULT_SONG_CONFIG, song_id=DEFAULT_SONG_ID):
    """Load and validate one song from the authoring-settings collection."""
    document = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("songs"), dict):
        raise ValueError("song authoring config must contain a songs object")
    if song_id not in document["songs"]:
        raise ValueError(f"unknown song ID: {song_id}")
    if document.get("schema_version") == 2:
        settings = document["songs"][song_id]
        if not isinstance(settings, dict):
            raise ValueError(f"song settings for {song_id!r} must be an object")
        _reject_song_level_lane_mapping(song_id, settings)
        choices = settings.get("difficulties")
        if not isinstance(choices, dict):
            raise ValueError(f"song {song_id!r} must specify difficulty settings")
        for difficulty in DIFFICULTIES:
            choice = choices.get(difficulty)
            if not isinstance(choice, dict):
                raise ValueError(f"song {song_id!r} has invalid {difficulty} settings")
            _validate_difficulty_lane_mapping(song_id, difficulty, choice)
        return {
            **settings,
            "allowed_difficulties": ["normal", "hard"],
            "twilight_strength": 100,
            "minimum_delta": settings["difficulties"]["normal"]["minimum_delta"],
            "stride": settings["difficulties"]["normal"]["stride"],
        }
    return _validate_song_settings(song_id, document["songs"][song_id])


def _profile_file_hash(path=None):
    document = json.loads(Path(path or DEFAULT_DIFFICULTY_PROFILES).read_text(encoding="utf-8"))
    profiles = document.get("profiles", {})
    for profile in profiles.values():
        if isinstance(profile, dict):
            profile.pop("twilight_strength", None)
    payload = json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load_authoring_collection(path=DEFAULT_SONG_CONFIG):
    """Read the percent-based v2 authoring contract without applying defaults."""
    document = json.loads(Path(path).read_text(encoding="utf-8"))
    songs = document.get("songs") if isinstance(document, dict) else None
    if document.get("schema_version") != 2 or not isinstance(songs, dict) or not songs:
        raise ValueError("song authoring config must be schema_version 2 with a songs object")
    for song_id, settings in songs.items():
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", song_id):
            raise ValueError(f"invalid ASCII song ID: {song_id!r}")
        if not isinstance(settings, dict) or not isinstance(settings.get("source"), str):
            raise ValueError(f"song {song_id!r} must specify a source path")
        _reject_song_level_lane_mapping(song_id, settings)
        _resolve_onset_recipe(song_id, settings)
        for name in ("start_time", "duration", "twilight_time"):
            value = _finite_number(settings.get(name), name)
            if value < 0 or (name != "start_time" and value <= 0) or value > 100:
                raise ValueError(f"song {song_id!r} {name} must be a percentage in [0, 100]")
        if settings["start_time"] + settings["duration"] > 100 + 1e-12:
            raise ValueError(f"song {song_id!r} excerpt exceeds source duration")
        if settings["twilight_time"] >= 100:
            raise ValueError(f"song {song_id!r} twilight_time must be below 100 percent")
        if not isinstance(settings.get("lane_rules"), dict) or settings["lane_rules"].get("type") != "pattern":
            raise ValueError(f"song {song_id!r} has invalid lane_rules")
        _validate_config(0, 1, 0.5, 1, settings["lane_rules"].get("data"))
        choices = settings.get("difficulties")
        if not isinstance(choices, dict) or set(choices) != set(DIFFICULTIES):
            raise ValueError(f"song {song_id!r} must author easy, normal, and hard difficulties")
        for difficulty in DIFFICULTIES:
            choice = choices[difficulty]
            if not isinstance(choice, dict):
                raise ValueError(f"song {song_id!r} has invalid {difficulty} settings")
            if "twilight_strength" in choice:
                raise ValueError(
                    f"song {song_id!r} {difficulty} twilight_strength is no longer "
                    "authorable; set profiles.<difficulty>.twilight_strength instead"
                )
            expected = {"minimum_delta", "stride"}
            if not expected <= set(choice) or set(choice) - expected - {"lane_mapping"}:
                raise ValueError(f"song {song_id!r} has invalid {difficulty} settings")
            _validate_difficulty_lane_mapping(song_id, difficulty, choice)
            delta = _finite_number(choice["minimum_delta"], "minimum_delta")
            stride = choice["stride"]
            if delta < 0 or isinstance(stride, bool) or not isinstance(stride, int) or stride <= 0:
                raise ValueError(f"song {song_id!r} has invalid {difficulty} difficulty values")
    return songs


def _resolve_onset_recipe(song_id, settings):
    """Validate and resolve song-wide aubioonset controls."""
    allowed = {"algorithm", "minioi", "threshold", "silence"}
    override_keys = set(settings) & allowed
    recipe = {**ONSET_DEFAULTS, **{key: settings[key] for key in override_keys}}
    algorithm = recipe["algorithm"]
    if not isinstance(algorithm, str) or algorithm not in ONSET_ALGORITHMS:
        raise ValueError(f"song {song_id!r} has unsupported onset algorithm: {algorithm!r}")
    for name in ("minioi", "threshold", "silence"):
        recipe[name] = _finite_number(recipe[name], f"onset {name}")
    if recipe["minioi"] <= 0:
        raise ValueError(f"song {song_id!r} onset minioi must be positive seconds")
    if not 0.1 <= recipe["threshold"] <= 1:
        raise ValueError(f"song {song_id!r} onset threshold must be in [0.1, 1]")
    if recipe["silence"] > 0:
        raise ValueError(f"song {song_id!r} onset silence must be non-positive dB")
    return recipe


def _source_path(settings):
    source = Path(settings["source"])
    return (source if source.is_absolute() else PROJECT_ROOT / source).resolve()


def _source_duration(source, runner):
    result = _run_process(runner, ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(source)], "FFprobe duration read")
    duration = _finite_number(float((result.stdout or "").strip()), "source duration")
    if duration <= 0:
        raise ValueError(f"source duration must be positive: {source}")
    return duration


def _pitch_tool_identity():
    """Identify the extraction executables without including transient paths."""
    binaries = {}
    for name in ("ffmpeg", "aubiopitch"):
        executable = shutil.which(name)
        if not executable:
            raise RuntimeError(f"required pitch-analysis tool is unavailable: {name}")
        binaries[name] = _sha256_file(executable)
    result = subprocess.run(
        ["ffmpeg", "-version"], capture_output=True, text=True, check=False, timeout=10
    )
    if result.returncode != 0:
        raise RuntimeError("could not identify ffmpeg version")
    return {
        "ffmpeg_version": (result.stdout or "").splitlines()[0].strip(),
        "ffmpeg_sha256": binaries["ffmpeg"],
        "aubiopitch_sha256": binaries["aubiopitch"],
    }


def _pitch_cache_path(song_id, key):
    return DEFAULT_PITCH_CACHE_DIR / f"{song_id}.{key}.json"


def _pitch_analysis_for_song(song_id, source, source_hash, runner, check, onset_cache):
    expected_key = onset_cache.get("pitch_analysis_key")
    if check:
        if not isinstance(expected_key, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_key):
            raise ValueError(f"onset cache for {song_id} lacks pitch analysis provenance")
        cache_path = _pitch_cache_path(song_id, expected_key)
        if not cache_path.exists():
            raise ValueError(f"missing pitch cache for {song_id}")
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        pitch_analysis.validate_cache(
            cache, source_hash, PITCH_RECIPE_VERSION, PITCH_RECIPE_ARGS, expected_key
        )
        return cache

    identity = _pitch_tool_identity()
    key = pitch_analysis.analysis_key(
        source_hash, PITCH_RECIPE_VERSION, PITCH_RECIPE_ARGS, identity
    )
    cache_path = _pitch_cache_path(song_id, key)
    if cache_path.exists():
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        pitch_analysis.validate_cache(
            cache, source_hash, PITCH_RECIPE_VERSION, PITCH_RECIPE_ARGS, key
        )
        return cache

    with tempfile.TemporaryDirectory(prefix="pitch-chart-") as temp_dir:
        wav_path = Path(temp_dir) / "full-source.wav"
        args = PITCH_RECIPE_ARGS
        ffmpeg = [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source), "-map", "0:a:0", "-ac", "1", "-ar",
            str(args["sample_rate"]), "-f", "wav", str(wav_path),
        ]
        _run_process(runner, ffmpeg, "FFmpeg pitch audio conversion", timeout=pitch_analysis.PITCH_TIMEOUT_SECONDS)
        aubio = [
            "aubiopitch", "-i", str(wav_path), "-r", str(args["sample_rate"]),
            "-B", str(args["buffer_size"]), "-H", str(args["hop_size"]),
            "-p", str(args["algorithm"]), "-u", str(args["pitch_unit"]),
            "-T", str(args["time_unit"]), "-s", str(args["silence_db"]),
        ]
        result = _run_process(
            runner, aubio, "aubio pitch extraction", timeout=pitch_analysis.PITCH_TIMEOUT_SECONDS
        )
        frames = pitch_analysis.parse_pitch_frames(result.stdout or "")
    return pitch_analysis.make_cache(
        source_hash, PITCH_RECIPE_VERSION, PITCH_RECIPE_ARGS, identity, frames
    )


def _validate_onset_values(onsets, song_id):
    if not isinstance(onsets, list):
        raise ValueError(f"onset cache for {song_id} must contain an onset array")
    validated = []
    previous = -1.0
    for index, value in enumerate(onsets):
        onset = _finite_number(value, f"onsets[{index}]")
        if onset < 0 or onset <= previous:
            raise ValueError(f"onset cache for {song_id} must be non-negative, strictly increasing, and unique")
        validated.append(onset)
        previous = onset
    return validated


class _AnalysisCommandMismatch(ValueError):
    """A provenance command list does not match the supported recipe."""


def _validate_analysis_commands(commands, song_id, field_name, recipe):
    if commands != _recorded_commands(recipe):
        raise _AnalysisCommandMismatch(
            f"{field_name} for {song_id} is not the supported full-source analysis"
        )


def _validate_cache_provenance(cache, song_id, source, digest, recipe, *, legacy=False):
    if not isinstance(cache, dict):
        raise ValueError(f"onset cache for {song_id} must be a JSON object")
    if legacy:
        if type(cache.get("schema_version")) is not int or cache["schema_version"] != 1:
            raise ValueError(f"legacy beat artifact for {song_id} has an unsupported schema")
        actual_source = cache.get("source")
        cached_hash = cache.get("source_sha256")
        commands = cache.get("commands")
        tools = cache.get("tools")
    else:
        if type(cache.get("schemaVersion")) is not int or cache["schemaVersion"] != 1:
            raise ValueError(f"onset cache for {song_id} has an unsupported schema")
        actual_source = cache.get("source")
        cached_hash = cache.get("source_sha256")
        commands = cache.get("analysis")
        tools = cache.get("tools")
    expected_path = _project_relative_source(source)
    if not isinstance(actual_source, dict):
        raise ValueError(f"onset cache for {song_id} has invalid source provenance")
    source_hash = actual_source.get("sha256")
    if (
        actual_source.get("path") != expected_path
        or not isinstance(source_hash, str)
        or not re.fullmatch(r"[0-9a-f]{64}", source_hash)
        or source_hash != digest
        or cached_hash != source_hash
    ):
        raise ValueError(f"cached onset source mismatch for {song_id}")
    _validate_analysis_commands(commands, song_id, "analysis commands" if not legacy else "legacy commands", recipe)
    if tools != {"ffmpeg": "ffmpeg", "aubioonset": "aubioonset"}:
        raise ValueError(f"onset cache for {song_id} has unsupported analysis tools")
    _validate_onset_values(cache.get("onsets"), song_id)
    if not legacy:
        duration = _finite_number(cache.get("source_duration_seconds"), "source_duration_seconds")
        if duration <= 0:
            raise ValueError(f"onset cache for {song_id} has invalid source duration")
        projection = cache.get("projection")
        if (
            not isinstance(projection, dict)
            or not isinstance(projection.get("song"), dict)
            or not isinstance(projection.get("profile_sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", projection["profile_sha256"])
        ):
            raise ValueError(f"onset cache for {song_id} has invalid projection provenance")


def _difficulty_chart(onsets, settings, duration_seconds, profile, difficulty, song_id, source_hash,
                      pitch_frames=None, with_analysis=False):
    excerpt_start = duration_seconds * settings["start_time"] / 100
    excerpt_duration = duration_seconds * settings["duration"] / 100
    twilight_at = excerpt_duration * settings["twilight_time"] / 100
    if not 0 < twilight_at < excerpt_duration:
        raise ValueError(f"song {song_id} has invalid computed twilight boundary")
    choice = settings["difficulties"][difficulty]
    notes = select_notes(onsets, excerpt_start, excerpt_duration, twilight_at,
                          stride=choice["stride"], lane_pattern=settings["lane_rules"]["data"],
                          minimum_delta_ms=choice["minimum_delta"],
                          allowed_difficulties=[difficulty])
    baseline_lanes = [note["lane"] for note in notes]
    records = None
    mapping_metrics = None
    if pitch_frames is not None:
        records = pitch_analysis.note_records(
            pitch_frames, notes, excerpt_start, PITCH_RECIPE_ARGS
        )
        controls = validate_lane_mapping(choice.get("lane_mapping", {}))
        candidate_lanes = _map_pitch_lanes(records, baseline_lanes, controls)
        for note, lane in zip(notes, candidate_lanes, strict=True):
            note["lane"] = lane
        mapping_metrics = pitch_analysis.metrics(baseline_lanes, candidate_lanes, records)
    count = sum(note["relative_time"] > twilight_at for note in notes)
    if count == 0:
        raise ValueError(f"zeroTwilight: {song_id}/{difficulty} has no twilight notes")
    # Construct the runtime ChartConfig shape directly; percentages and provenance
    # remain in authoring/onset data, never in runtime chart values.
    counters = {"a": 0, "t": 0}
    chart_notes = []
    for note in notes:
        kind = "a" if note["relative_time"] < twilight_at else "t"
        counters[kind] += 1
        chart_notes.append({"id": f"{kind}{counters[kind]:02d}", "time": note["relative_time"], "lane": note["lane"]})
    chart = {
        "sourceStart": excerpt_start, "duration": excerpt_duration,
        "twilightAt": twilight_at,
        "allowedDifficulties": [difficulty],
        "notes": chart_notes,
    }
    if with_analysis:
        return chart, notes, count, {
            "controls": validate_lane_mapping(choice.get("lane_mapping", {})),
            "metrics": mapping_metrics,
        }
    return chart, notes, count


def _map_pitch_lanes(records, fallback_lanes, controls):
    return map_lanes(records, fallback_lanes, controls)


def _theoretical_maximum_score(note_count):
    """Return the maximum score using ten-hit bands capped at 5x."""
    full_bands, remainder = divmod(note_count, 10)
    capped_bands = min(full_bands, 5)
    multiplier_sum = capped_bands * (capped_bands + 1) // 2
    multiplier_sum += max(full_bands - 5, 0) * 5
    next_multiplier = min(full_bands + 1, 5)
    return 100 * (10 * multiplier_sum + remainder * next_multiplier)


def _scoring_metadata(charts):
    normal_chart = charts.get("normal")
    if normal_chart is None:
        return {
            "version": SCORING_VERSION,
            "normalMaximum": None,
            "fiveGoldTarget": None,
            "chartFingerprint": None,
        }
    normal_maximum = _theoretical_maximum_score(len(normal_chart["notes"]))
    fingerprint_input = json.dumps(
        {"version": SCORING_VERSION, "normal": normal_chart},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return {
        "version": SCORING_VERSION,
        "normalMaximum": normal_maximum,
        "fiveGoldTarget": math.ceil(normal_maximum * 0.9),
        "chartFingerprint": hashlib.sha256(fingerprint_input).hexdigest(),
    }


def _analysis_for_song(song_id, settings, source, digest, runner, check, onset_path):
    recipe = _resolve_onset_recipe(song_id, settings)
    if onset_path.exists():
        cached = json.loads(onset_path.read_text(encoding="utf-8"))
        try:
            _validate_cache_provenance(cached, song_id, source, digest, recipe)
        except ValueError:
            if check:
                raise
        else:
            return cached
    if check:
        raise ValueError(f"missing cached onset artifact for {song_id}")
    legacy_candidates = [PROJECT_ROOT / "data/charts" / f"{song_id}.beats.json",
                         PROJECT_ROOT / "data/charts/candidates" / f"{song_id}.beats.json"]
    for legacy in legacy_candidates:
        if legacy.exists():
            old = json.loads(legacy.read_text(encoding="utf-8"))
            try:
                _validate_cache_provenance(old, song_id, source, digest, recipe, legacy=True)
            except _AnalysisCommandMismatch:
                if check:
                    raise
                # Treat only a structurally valid legacy cache with a different
                # onset recipe as stale; malformed provenance must remain fatal.
                legacy_hfc_recipe = {**recipe, "algorithm": "hfc"}
                legacy_hfc_commands = _recorded_commands(legacy_hfc_recipe)
                previous_format_commands = [list(command) for command in legacy_hfc_commands]
                previous_format_commands[1] = [
                    "-s-90" if argument == "-s-90.0" else argument
                    for argument in previous_format_commands[1]
                ]
                if old.get("commands") not in (legacy_hfc_commands, previous_format_commands):
                    raise
                candidate = dict(old)
                candidate["commands"] = _recorded_commands(recipe)
                _validate_cache_provenance(candidate, song_id, source, digest, recipe, legacy=True)
                continue
            return {"schemaVersion": 1, "source": {"path": _project_relative_source(source), "sha256": digest},
                    "source_sha256": digest, "onsets": _validate_onset_values(old["onsets"], song_id),
                    "analysis": old["commands"], "tools": old["tools"]}
    with tempfile.TemporaryDirectory(prefix="beat-chart-") as temp_dir:
        wav = Path(temp_dir) / "analysis.wav"
        ffmpeg, aubio = _build_commands(source, wav, recipe)
        _run_process(runner, ffmpeg, "FFmpeg audio conversion")
        result = _run_process(runner, aubio, "aubio onset detection")
    return {"schemaVersion": 1, "source": {"path": _project_relative_source(source), "sha256": digest},
            "source_sha256": digest, "onsets": parse_onsets(result.stdout or ""),
            "analysis": _recorded_commands(recipe), "tools": {"ffmpeg": "ffmpeg", "aubioonset": "aubioonset"}}


def _bulk_run(args, runner):
    songs = load_authoring_collection(args.song_config)
    selected = songs if args.all else {args.song: songs[args.song]}
    profiles = load_difficulty_profiles()
    profile_hash = _profile_file_hash()
    built = []
    source_snapshots = {}
    for song_id, settings in selected.items():
        source = _source_path(settings).resolve(strict=True)
        digest = _sha256_file(source)
        source_snapshots[song_id] = (source, digest)
        onset_path = DEFAULT_ONSETS_DIR / f"{song_id}.beats.json"
        cache = _analysis_for_song(song_id, settings, source, digest, runner, args.check, onset_path)
        pitch_cache = _pitch_analysis_for_song(
            song_id, source, digest, runner, args.check, cache
        )
        if args.check:
            audio_duration = cache.get("source_duration_seconds")
            if not audio_duration:
                raise ValueError(f"onset artifact lacks source duration for {song_id}")
        else:
            audio_duration = _source_duration(source, runner)
        charts = {}
        report_controls = {}
        report_metrics = {}
        for difficulty in DIFFICULTIES:
            chart, notes, count, analysis = _difficulty_chart(
                cache["onsets"], settings, audio_duration, profiles[difficulty],
                difficulty, song_id, digest, pitch_cache["frames"], with_analysis=True,
            )
            charts[difficulty] = chart
            report_controls[difficulty] = analysis["controls"]
            report_metrics[difficulty] = analysis["metrics"]
        projection = {
            "song": {**settings, **_resolve_onset_recipe(song_id, settings)},
            "profile_sha256": profile_hash,
        }
        cache.update({
            "source_duration_seconds": audio_duration,
            "projection": projection,
            "pitch_analysis_key": pitch_cache["analysis_key"],
        })
        onset_text = json.dumps(cache, indent=2, sort_keys=True, allow_nan=False) + "\n"
        envelope = {
            "schemaVersion": 1,
            "songId": song_id,
            "source": settings["source"],
            "charts": charts,
            "scoring": _scoring_metadata(charts),
        }
        generated_path = DEFAULT_GENERATED_DIR / f"{song_id}.charts.json"
        report = {
            "schema_version": 1,
            "song_id": song_id,
            "source_sha256": digest,
            "pitch_analysis_key": pitch_cache["analysis_key"],
            "mapper_version": "pitch-lanes-v1",
            "controls": report_controls,
            "metrics": report_metrics,
        }
        report_path = DEFAULT_REPORTS_DIR / f"{song_id}.lanes.json"
        report_text = json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n"
        pitch_path = _pitch_cache_path(song_id, pitch_cache["analysis_key"])
        pitch_text = json.dumps(pitch_cache, indent=2, sort_keys=True, allow_nan=False) + "\n"
        if args.check:
            actual_onsets = onset_path.read_text(encoding="utf-8")
            if actual_onsets != onset_text:
                raise ValueError(f"onset projection or profile cache is stale for {song_id}")
            if not generated_path.exists() or json.loads(generated_path.read_text(encoding="utf-8")) != envelope:
                raise ValueError(f"generated chart is stale for {song_id}")
            if not report_path.exists() or report_path.read_text(encoding="utf-8") != report_text:
                raise ValueError(f"lane report is stale for {song_id}")
        else:
            built.extend((
                (onset_path, onset_text),
                (pitch_path, pitch_text),
                (generated_path, json.dumps(envelope, indent=2, sort_keys=True, allow_nan=False) + "\n"),
                (report_path, report_text),
            ))
    if args.all:
        expected_generated = {f"{song_id}.charts.json" for song_id in songs}
        expected_onsets = {f"{song_id}.beats.json" for song_id in songs}
        expected_reports = {f"{song_id}.lanes.json" for song_id in songs}
        for directory, expected, label in (
            (DEFAULT_GENERATED_DIR, expected_generated, "generated chart"),
            (DEFAULT_ONSETS_DIR, expected_onsets, "onset artifact"),
            (DEFAULT_REPORTS_DIR, expected_reports, "lane report"),
        ):
            stale = {path.name for path in directory.glob("*") if path.is_file()} - expected if directory.exists() else set()
            if stale:
                raise ValueError(f"stale {label} outputs: {sorted(stale)}")
    if not args.check:
        for song_id, (source, expected_digest) in source_snapshots.items():
            if _sha256_file(source) != expected_digest:
                raise RuntimeError(
                    f"source audio changed during chart generation for {song_id}; outputs were not written"
                )
    for path, content in built:
        _atomic_write(path, content)


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


def _run_process(runner, command, label, timeout=1800):
    try:
        result = runner(command, capture_output=True, text=True, check=False, timeout=timeout)
    except OSError as error:
        raise RuntimeError(f"Could not start {label}: {error}") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"{label} timed out after {timeout} seconds") from error
    if result.returncode != 0:
        detail = (result.stderr or "").strip()
        suffix = f": {detail}" if detail else ""
        raise RuntimeError(f"{label} failed with exit code {result.returncode}{suffix}")
    return result


def _build_commands(source, wav_path, recipe=None):
    recipe = {**ONSET_DEFAULTS, **(recipe or {})}
    format_number = lambda value: repr(float(value))
    ffmpeg = [
        "ffmpeg", "-nostdin", "-y", "-i", str(source), "-ac", "1", "-ar", "44100",
        "-sample_fmt", "s16", "-c:a", "pcm_s16le", str(wav_path),
    ]
    aubio = [
        "aubioonset", "-T", "seconds", "-O", recipe["algorithm"],
        f"-t{format_number(recipe['threshold'])}", f"-M{format_number(recipe['minioi'])}",
        f"-s{format_number(recipe['silence'])}",
        "-i", str(wav_path),
    ]
    return ffmpeg, aubio


def _recorded_commands(recipe=None):
    recipe = {**ONSET_DEFAULTS, **(recipe or {})}
    ffmpeg, aubio = _build_commands("{sourceAudio}", "{analysisWav}", recipe)
    return [ffmpeg, aubio]


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
    parser.add_argument("--all", action="store_true", help="generate or check every v2 song")
    return parser


def main(argv=None, runner=None):
    """Run generation or validate the artifact and chart without external tools."""
    parser = _argument_parser()
    args = parser.parse_args(argv)
    try:
        config_document = json.loads(Path(args.song_config).read_text(encoding="utf-8"))
        is_v2 = isinstance(config_document, dict) and config_document.get("schema_version") == 2
        if is_v2:
            unsupported_overrides = {
                "source positional argument": args.source,
                "--source": args.source_option,
                "--artifact": args.artifact,
                "--chart": args.chart,
                "--source-start": args.source_start,
                "--duration": args.duration,
                "--boundary": args.boundary,
                "--stride": args.stride,
                "--minimum-delta": args.minimum_delta,
            }
            supplied = [name for name, value in unsupported_overrides.items() if value is not None]
            if supplied:
                raise ValueError(
                    "v2 authoring does not support CLI overrides: " + ", ".join(supplied)
                )
        if args.all or is_v2:
            _bulk_run(args, runner or subprocess.run)
            return 0
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
