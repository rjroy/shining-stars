#!/usr/bin/env python3
"""Blend opposite RGB tile borders into matching wrapped bands with ImageMagick."""

from __future__ import annotations

import argparse
import math
import subprocess
import sys
from pathlib import Path


def image_dimensions(path: Path) -> tuple[int, int]:
    result = subprocess.run(
        ["magick", "identify", "-format", "%w %h %[channels]", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    width_text, height_text, channels = result.stdout.split(maxsplit=2)
    if "srgb" not in channels.lower() or "alpha" in channels.lower():
        raise ValueError(f"Expected opaque sRGB input, got channels={channels}")
    return int(width_text), int(height_text)


def blend_axis(
    pixels: bytearray, width: int, height: int, band: int, horizontal: bool
) -> None:
    original = bytes(pixels)
    for distance in range(band):
        fade = 0.5 + 0.5 * math.cos(math.pi * distance / max(1, band - 1))
        for along in range(height if horizontal else width):
            if horizontal:
                first = (along * width + distance) * 3
                second = (along * width + width - 1 - distance) * 3
            else:
                first = (distance * width + along) * 3
                second = ((height - 1 - distance) * width + along) * 3
            for channel in range(3):
                a = original[first + channel]
                b = original[second + channel]
                midpoint = (a + b) / 2
                # Pair both opposite pixels, fading toward the untouched art.
                value = round((1 - fade) * a + fade * midpoint)
                other = round((1 - fade) * b + fade * midpoint)
                pixels[first + channel] = value
                pixels[second + channel] = other


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--band", type=int, default=48)
    parser.add_argument(
        "--blur-sigma",
        type=float,
        default=0,
        help="Optional Gaussian blur in pixels to reduce excessive source detail",
    )
    args = parser.parse_args()

    width, height = image_dimensions(args.source)
    if width != height:
        raise ValueError(f"Expected square input, got {width}x{height}")
    if args.band < 2 or args.band * 2 >= min(width, height):
        raise ValueError("Band must be at least 2 and less than half the image")
    if args.blur_sigma < 0:
        raise ValueError("Blur sigma cannot be negative")

    decode = ["magick", str(args.source)]
    if args.blur_sigma > 0:
        decode.extend(["-blur", f"0x{args.blur_sigma:g}"])
    decode.extend(["-depth", "8", "RGB:-"])
    raw = subprocess.run(
        decode,
        check=True,
        capture_output=True,
    ).stdout
    if len(raw) != width * height * 3:
        raise ValueError(f"Unexpected RGB byte count: {len(raw)}")
    pixels = bytearray(raw)
    blend_axis(pixels, width, height, args.band, horizontal=True)
    blend_axis(pixels, width, height, args.band, horizontal=False)

    # Assert exact edge texel continuity after both passes, including corners.
    for y in range(height):
        left = (y * width) * 3
        right = (y * width + width - 1) * 3
        if pixels[left : left + 3] != pixels[right : right + 3]:
            raise AssertionError(f"Horizontal wrap mismatch at row {y}")
    for x in range(width):
        top = x * 3
        bottom = ((height - 1) * width + x) * 3
        if pixels[top : top + 3] != pixels[bottom : bottom + 3]:
            raise AssertionError(f"Vertical wrap mismatch at column {x}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "magick",
            "-size",
            f"{width}x{height}",
            "-depth",
            "8",
            "RGB:-",
            "-strip",
            "-define",
            "png:exclude-chunk=date,time",
            f"PNG24:{args.output}",
        ],
        input=bytes(pixels),
        check=True,
    )
    print(
        f"wrote {args.output} ({width}x{height}, RGB; wrap band {args.band}px; "
        f"blur sigma {args.blur_sigma:g}px); exact opposite edge texels match "
        "on both axes"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, subprocess.CalledProcessError, ValueError, AssertionError) as error:
        print(f"seamless tile processing failed: {error}", file=sys.stderr)
        raise SystemExit(1)
