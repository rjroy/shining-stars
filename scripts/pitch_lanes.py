"""Deterministic pitch-informed lane mapping for offline chart generation."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence


DEFAULT_LANE_MAPPING = {
    "pitch_following": 3,
    "lane_balance": 1,
    "repetition_avoidance": 0.25,
    "wide_jump_avoidance": 0.5,
    "adaptation_block_notes": 32,
}
BEAM_WIDTH = 64
PITCH_PREFERENCE_WEIGHT = 0.15
OPPOSITE_CONTOUR_WEIGHT = 0.8
UNKNOWN_BASELINE_WEIGHT = 0.015
REPETITION_LIMIT = 2
REPETITION_COST_PER_NOTE = 0.55
WIDE_JUMP_COST = 0.35
LANE_SHARE_BALANCE_WEIGHT = 0.08
SQUARED_COUNT_BALANCE_WEIGHT = 0.03
STABLE_PITCH_DIFFERENCE_MIDI = 0.25
_UNSET = object()


def validate_lane_mapping(override=_UNSET) -> dict[str, int | float]:
    """Return a default-resolved mapping and reject malformed overrides.

    Omitting the argument selects defaults. Explicit ``None`` is not an object
    and is rejected, as are unknown keys and non-finite/out-of-range values.
    """
    if override is _UNSET:
        override = {}
    if not isinstance(override, Mapping):
        raise ValueError("lane_mapping must be an object")

    unknown = set(override) - set(DEFAULT_LANE_MAPPING)
    if unknown:
        raise ValueError(f"lane_mapping has unknown controls: {sorted(unknown)!r}")

    result = dict(DEFAULT_LANE_MAPPING)
    for name in (
        "pitch_following",
        "lane_balance",
        "repetition_avoidance",
        "wide_jump_avoidance",
    ):
        if name not in override:
            continue
        value = override[name]
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not 0 <= value <= 4
            or not math.isfinite(value)
        ):
            raise ValueError(f"lane_mapping.{name} must be a finite number in [0, 4]")
        result[name] = value

    if "adaptation_block_notes" in override:
        value = override["adaptation_block_notes"]
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not 8 <= value <= 128
        ):
            raise ValueError(
                "lane_mapping.adaptation_block_notes must be an integer in [8, 128]"
            )
        result["adaptation_block_notes"] = value
    return result


def preferred_lanes(records: Sequence[Mapping], block_notes: int) -> list[int | None]:
    """Assign stable pitches to section-local quartile preferences."""
    preferred: list[int | None] = [None] * len(records)
    for start in range(0, len(records), block_notes):
        indices = [
            i
            for i in range(start, min(start + block_notes, len(records)))
            if records[i]["stable"]
        ]
        pitches = sorted(records[i]["pitch"] for i in indices)
        if not pitches:
            continue
        for i in indices:
            pitch = records[i]["pitch"]
            preferred[i] = min(
                3,
                sum(
                    pitch > pitches[min(len(pitches) - 1, math.floor(q * len(pitches)))]
                    for q in (0.25, 0.5, 0.75)
                ),
            )
    return preferred


def map_lanes(
    records: Sequence[Mapping],
    fallback_lanes: Sequence[int],
    lane_mapping=_UNSET,
) -> list[int]:
    """Map stable pitch records to four lanes with a width-64 beam search.

    The beam traverses the complete chart; pitch quartile preferences are
    recomputed in bounded note blocks. Unknown pitches retain the supplied
    fallback lane as a light preference rather than inventing pitch evidence.
    """
    controls = validate_lane_mapping(lane_mapping)
    if len(records) != len(fallback_lanes):
        raise ValueError("records and fallback_lanes must have equal lengths")
    for lane in fallback_lanes:
        if isinstance(lane, bool) or not isinstance(lane, int) or lane not in (0, 1, 2, 3):
            raise ValueError("fallback_lanes must contain only integer lanes 0 through 3")
    for index, record in enumerate(records):
        if not isinstance(record, Mapping) or not isinstance(record.get("stable"), bool):
            raise ValueError(f"pitch record {index} must include a boolean stable state")
        if record["stable"]:
            pitch = record.get("pitch")
            if (
                isinstance(pitch, bool)
                or not isinstance(pitch, (int, float))
                or not math.isfinite(pitch)
            ):
                raise ValueError(f"stable pitch record {index} must have a finite pitch")

    preferences = preferred_lanes(records, controls["adaptation_block_notes"])
    pitch_scale = controls["pitch_following"]
    balance_scale = controls["lane_balance"]
    repetition_scale = controls["repetition_avoidance"]
    jump_scale = controls["wide_jump_avoidance"]

    # state=(cumulative cost, lane path, lane counts, previous lane, run length)
    states = [(0.0, (), (0, 0, 0, 0), None, 0)]
    for index, record in enumerate(records):
        candidates = []
        pitch = record["pitch"] if record["stable"] else None
        previous_pitch = (
            records[index - 1]["pitch"]
            if index > 0 and records[index - 1]["stable"]
            else None
        )
        for cost, path, counts, previous_lane, run_length in states:
            for lane in range(4):
                candidate_cost = cost
                if pitch is not None and preferences[index] is not None:
                    candidate_cost += (
                        pitch_scale
                        * PITCH_PREFERENCE_WEIGHT
                        * abs(lane - preferences[index])
                    )
                elif pitch is None:
                    candidate_cost += UNKNOWN_BASELINE_WEIGHT * abs(
                        lane - fallback_lanes[index]
                    )

                # Contour comparisons only span adjacent stable records.
                if (
                    pitch is not None
                    and previous_pitch is not None
                    and abs(pitch - previous_pitch) > STABLE_PITCH_DIFFERENCE_MIDI
                ):
                    pitch_direction = 1 if pitch > previous_pitch else -1
                    lane_direction = (
                        1
                        if lane > previous_lane
                        else (-1 if lane < previous_lane else 0)
                    )
                    if lane_direction and lane_direction != pitch_direction:
                        candidate_cost += pitch_scale * OPPOSITE_CONTOUR_WEIGHT

                next_run = run_length + 1 if previous_lane == lane else 1
                if next_run > REPETITION_LIMIT:
                    candidate_cost += repetition_scale * REPETITION_COST_PER_NOTE
                if previous_lane is not None and abs(lane - previous_lane) >= 2:
                    candidate_cost += jump_scale * WIDE_JUMP_COST

                next_counts_list = list(counts)
                next_counts_list[lane] += 1
                next_counts = tuple(next_counts_list)
                total_notes = index + 1
                candidate_cost += balance_scale * LANE_SHARE_BALANCE_WEIGHT * sum(
                    (count / total_notes - 0.25) ** 2 for count in next_counts
                )
                candidate_cost += balance_scale * SQUARED_COUNT_BALANCE_WEIGHT * (
                    sum(count * count for count in next_counts)
                    - sum(count * count for count in counts)
                )
                candidates.append(
                    (
                        candidate_cost,
                        path + (lane,),
                        next_counts,
                        lane,
                        next_run,
                    )
                )

        candidates.sort(key=lambda state: (round(state[0], 12), state[1]))
        states = candidates[:BEAM_WIDTH]

    return list(min(states, key=lambda state: (round(state[0], 12), state[1]))[1])
