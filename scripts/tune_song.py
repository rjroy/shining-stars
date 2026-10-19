"""Generate and summarize the chart for one song."""

import argparse
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Generate a song's beat chart and report its chart density."
    )
    parser.add_argument("song_id", help="song ID from the authoring catalog")
    args = parser.parse_args(argv)

    for script in ("beat_chart.py", "chart_density.py"):
        result = subprocess.run(
            [sys.executable, str(SCRIPT_DIR / script), "--song", args.song_id],
            check=False,
        )
        if result.returncode != 0:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
