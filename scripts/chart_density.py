"""Read-only summaries of generated chart note density."""

import argparse
import json
import math
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
GENERATED_DIR = PROJECT_ROOT / "data/charts/generated"
DIFFICULTIES = ("easy", "normal", "hard")
BLOCK_SECONDS = 10.0


def _finite_number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a finite number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{label} must be a finite number")
    return number


def summarize_chart(chart, block_seconds=BLOCK_SECONDS):
    """Return duration-weighted mean and population SD plus peak block rate."""
    if not isinstance(chart, dict):
        raise ValueError("chart must be an object")
    duration = _finite_number(chart.get("duration"), "chart duration")
    if duration <= 0:
        raise ValueError("chart duration must be positive")
    block_seconds = _finite_number(block_seconds, "block duration")
    if block_seconds <= 0:
        raise ValueError("block duration must be positive")
    notes = chart.get("notes")
    if not isinstance(notes, list):
        raise ValueError("chart notes must be an array")

    block_count = math.ceil(duration / block_seconds)
    counts = [0] * block_count
    for index, note in enumerate(notes):
        if not isinstance(note, dict):
            raise ValueError(f"chart note {index} must be an object")
        time = _finite_number(note.get("time"), f"chart note {index} time")
        if not 0 <= time < duration:
            raise ValueError(
                f"chart note {index} time {time} is outside [0, {duration})"
            )
        counts[int(time // block_seconds)] += 1

    weighted_rates = []
    for index, count in enumerate(counts):
        start = index * block_seconds
        width = min(block_seconds, duration - start)
        rate = count * block_seconds / width
        weighted_rates.append((width, rate))

    total_weight = sum(weight for weight, _ in weighted_rates)
    mean = sum(weight * rate for weight, rate in weighted_rates) / total_weight
    variance = sum(
        weight * (rate - mean) ** 2 for weight, rate in weighted_rates
    ) / total_weight
    maximum = max(rate for _, rate in weighted_rates)
    return mean, math.sqrt(variance), maximum


def _load_bundle(path, expected_song_id=None):
    try:
        bundle = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read chart bundle {path}: {error}") from error
    if not isinstance(bundle, dict) or bundle.get("schemaVersion") != 1:
        raise ValueError(f"chart bundle {path} must be a schemaVersion 1 object")
    song_id = bundle.get("songId")
    if not isinstance(song_id, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", song_id):
        raise ValueError(f"chart bundle {path} has an invalid songId")
    if expected_song_id is not None and song_id != expected_song_id:
        raise ValueError(
            f"chart bundle {path} contains songId {song_id!r}, expected {expected_song_id!r}"
        )
    charts = bundle.get("charts")
    if not isinstance(charts, dict):
        raise ValueError(f"chart bundle {path} must contain a charts object")
    missing = set(DIFFICULTIES) - set(charts)
    if missing:
        raise ValueError(f"chart bundle {path} is missing difficulties: {', '.join(sorted(missing))}")
    return song_id, charts


def _format_report(song_id, charts):
    rows = []
    for difficulty in DIFFICULTIES:
        try:
            mean, stddev, maximum = summarize_chart(charts[difficulty])
        except ValueError as error:
            raise ValueError(f"{song_id}/{difficulty}: {error}") from error
        rows.append(
            f"{song_id}\t{difficulty}\t{mean:.2f}\t{stddev:.2f}\t{maximum:.2f}"
        )
    return rows


def main(argv=None, *, generated_dir=GENERATED_DIR):
    parser = argparse.ArgumentParser(
        description="Report mean, population SD, and maximum fixed-block notes per 10 seconds from generated chart bundles."
    )
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--all", action="store_true", help="report every generated song")
    selection.add_argument("--song", metavar="ID", help="report one song ID")
    args = parser.parse_args(argv)

    try:
        if args.song:
            if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", args.song):
                raise ValueError(f"invalid song ID: {args.song!r}")
            path = generated_dir / f"{args.song}.charts.json"
            if not path.is_file():
                raise ValueError(f"unknown song ID {args.song!r}: no generated chart bundle at {path}")
            selected = [path]
        else:
            selected = sorted(generated_dir.glob("*.charts.json"))
            if not selected:
                raise ValueError(f"no generated chart bundles found in {generated_dir}")

        lines = [
            "song\tdifficulty\tmean notes/10s\tpopulation SD\tmax notes/10s"
        ]
        seen = set()
        for path in selected:
            song_id, charts = _load_bundle(path, args.song)
            if song_id in seen:
                raise ValueError(f"duplicate generated chart bundle for song {song_id!r}")
            seen.add(song_id)
            lines.extend(_format_report(song_id, charts))
    except ValueError as error:
        print(f"chart-density: {error}", file=sys.stderr)
        return 1

    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
