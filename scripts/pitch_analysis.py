"""Content-addressed full-source pitch extraction and deterministic summaries."""

from __future__ import annotations

import hashlib
import json
import math
import statistics


PITCH_RECIPE_VERSION = "yinfft-midi-v1"
PITCH_RECIPE_ARGS = {
    "sample_rate": 22050,
    "algorithm": "yinfft",
    "buffer_size": 2048,
    "hop_size": 256,
    "pitch_unit": "midi",
    "time_unit": "seconds",
    "silence_db": -90,
}
PITCH_TIMEOUT_SECONDS = 1800
PITCH_WINDOW_SECONDS = (0.030, 0.150)
PITCH_STABLE_COVERAGE_MIN = 0.5
PITCH_STABLE_MAD_MAX_MIDI = 2.5
PITCH_ANALYSIS_SCHEMA = 1


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def analysis_key(source_sha256, recipe_version, normalized_args, tool_identity):
    return sha256_text(canonical_json({
        "source_sha256": source_sha256,
        "recipe_version": recipe_version,
        "normalized_args": normalized_args,
        "tool_identity": tool_identity,
    }))


def parse_pitch_frames(stdout):
    frames = []
    previous_time = -1.0
    for line_number, line in enumerate(stdout.splitlines(), 1):
        parts = line.split()
        if not parts:
            continue
        if len(parts) != 2:
            raise ValueError(f"invalid aubiopitch output on line {line_number}")
        try:
            timestamp, pitch = map(float, parts)
        except ValueError as error:
            raise ValueError(f"invalid aubiopitch output on line {line_number}") from error
        if not math.isfinite(timestamp) or timestamp < 0 or timestamp <= previous_time:
            raise ValueError("pitch frame timestamps must be finite and strictly increasing")
        if not math.isfinite(pitch):
            raise ValueError(f"pitch frame value on line {line_number} must be finite")
        frames.append({"time": timestamp, "pitch": pitch})
        previous_time = timestamp
    if not frames:
        raise ValueError("aubiopitch returned no pitch frames")
    return frames


def payload_digest(frames):
    return sha256_text(canonical_json(frames))


def make_cache(source_sha256, recipe_version, normalized_args, tool_identity, frames):
    return {
        "schema_version": PITCH_ANALYSIS_SCHEMA,
        "source_sha256": source_sha256,
        "recipe_version": recipe_version,
        "normalized_args": normalized_args,
        "tool_identity": tool_identity,
        "analysis_key": analysis_key(source_sha256, recipe_version, normalized_args, tool_identity),
        "payload_sha256": payload_digest(frames),
        "frames": frames,
    }


def validate_cache(cache, source_sha256, recipe_version, normalized_args, expected_key=None):
    if (not isinstance(cache, dict)
            or type(cache.get("schema_version")) is not int
            or cache.get("schema_version") != PITCH_ANALYSIS_SCHEMA):
        raise ValueError("pitch cache has unsupported schema")
    frames = cache.get("frames")
    if not isinstance(frames, list) or not frames:
        raise ValueError("pitch cache frames are missing")
    previous_time = -1.0
    for index, frame in enumerate(frames):
        if not isinstance(frame, dict):
            raise ValueError(f"pitch cache frame {index} must be an object")
        timestamp, pitch = frame.get("time"), frame.get("pitch")
        if (isinstance(timestamp, bool) or not isinstance(timestamp, (int, float))
                or not math.isfinite(timestamp) or timestamp < 0 or timestamp <= previous_time):
            raise ValueError("pitch cache timestamps must be finite and strictly increasing")
        if isinstance(pitch, bool) or not isinstance(pitch, (int, float)) or not math.isfinite(pitch):
            raise ValueError(f"pitch cache value {index} must be finite")
        previous_time = timestamp
    identity = cache.get("tool_identity")
    if (not isinstance(identity, dict)
            or not isinstance(identity.get("ffmpeg_version"), str)
            or not identity["ffmpeg_version"].strip()
            or any(not isinstance(identity.get(name), str)
                   or len(identity[name]) != 64
                   or any(char not in "0123456789abcdef" for char in identity[name])
                   for name in ("ffmpeg_sha256", "aubiopitch_sha256"))):
        raise ValueError("pitch cache tool identity is missing")
    key = analysis_key(source_sha256, recipe_version, normalized_args, identity)
    if (cache.get("source_sha256") != source_sha256
            or cache.get("recipe_version") != recipe_version
            or cache.get("normalized_args") != normalized_args
            or cache.get("analysis_key") != key
            or (expected_key is not None and expected_key != key)
            or cache.get("payload_sha256") != payload_digest(frames)):
        raise ValueError("pitch cache provenance or payload digest mismatch")
    return cache


def note_records(frames, notes, source_start, args):
    before, after = PITCH_WINDOW_SECONDS
    expected_samples = max(1, math.ceil((after - before) * args["sample_rate"] / args["hop_size"]))
    times = [frame["time"] for frame in frames]
    records = []
    for note in notes:
        start = note["relative_time"] + source_start + before
        end = note["relative_time"] + source_start + after
        left = _lower_bound(times, start)
        right = _upper_bound(times, end)
        values = [frames[index]["pitch"] for index in range(left, right) if frames[index]["pitch"] > 0]
        if not values:
            records.append({"pitch": None, "coverage": 0.0, "mad": None, "stable": False})
            continue
        median = statistics.median(values)
        mad = statistics.median(abs(value - median) for value in values)
        coverage = min(1.0, len(values) / expected_samples)
        records.append({
            "pitch": median,
            "coverage": coverage,
            "mad": mad,
            "stable": coverage >= PITCH_STABLE_COVERAGE_MIN and mad <= PITCH_STABLE_MAD_MAX_MIDI,
        })
    return records


def _lower_bound(values, target):
    low, high = 0, len(values)
    while low < high:
        mid = (low + high) // 2
        if values[mid] < target:
            low = mid + 1
        else:
            high = mid
    return low


def _upper_bound(values, target):
    low, high = 0, len(values)
    while low < high:
        mid = (low + high) // 2
        if values[mid] <= target:
            low = mid + 1
        else:
            high = mid
    return low


def lane_layout_metrics(baseline, candidate):
    """Summarize lane-only report fields without requiring pitch observations."""
    def counts(lanes):
        return [lanes.count(lane) for lane in range(4)]

    def longest_run(lanes):
        longest = run = 0
        previous = None
        for lane in lanes:
            run = run + 1 if lane == previous else 1
            longest = max(longest, run)
            previous = lane
        return longest

    def rolling32(lanes):
        if len(lanes) < 32:
            return None
        return max(max(lanes[start:start + 32].count(lane) / 32 for lane in range(4))
                   for start in range(len(lanes) - 31))

    baseline_counts, candidate_counts = counts(baseline), counts(candidate)
    return {
        "noteCount": len(baseline),
        "baselineLaneCounts": baseline_counts,
        "candidateLaneCounts": candidate_counts,
        "baselineLaneShares": [count / len(baseline) for count in baseline_counts] if baseline else [],
        "candidateLaneShares": [count / len(candidate) for count in candidate_counts] if candidate else [],
        "baselineLongestLaneRun": longest_run(baseline),
        "candidateLongestLaneRun": longest_run(candidate),
        "baselineHandCounts": [sum(baseline_counts[:2]), sum(baseline_counts[2:])],
        "candidateHandCounts": [sum(candidate_counts[:2]), sum(candidate_counts[2:])],
        "baselineWorstRolling32Concentration": rolling32(baseline),
        "candidateWorstRolling32Concentration": rolling32(candidate),
        "rolling32Definition": "maximum lane share over every complete sliding window of 32 notes; no complete windows => null; trailing partial windows excluded",
    }


def metrics(baseline, candidate, records):
    result = lane_layout_metrics(baseline, candidate)
    pairs = [(i, i + 1) for i in range(len(records) - 1)
             if records[i]["stable"] and records[i + 1]["stable"]
             and abs(records[i + 1]["pitch"] - records[i]["pitch"]) > 0.25]

    def agreement(lanes):
        if not pairs:
            return None
        return sum((lanes[j] - lanes[i]) * (records[j]["pitch"] - records[i]["pitch"]) > 0
                   for i, j in pairs) / len(pairs)

    result.update({
        "stableUnequalPitchAdjacentPairs": len(pairs),
        "baselineExtractedF0DirectionAgreement": agreement(baseline),
        "candidateExtractedF0DirectionAgreement": agreement(candidate),
        "unknownPitchCount": sum(not record["stable"] for record in records),
        "stablePitchCount": sum(record["stable"] for record in records),
        "stablePitchCoverage": sum(record["stable"] for record in records) / len(records) if records else 0,
    })
    return result
