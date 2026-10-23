#!/usr/bin/env python3
"""Generate a periodic tangent-space normal from the runtime audience-plaza map."""

import argparse
import subprocess
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "production/brightvale-ground/audience-plaza.png"
DEFAULT_OUTPUT = ROOT / "production/brightvale-ground/audience-plaza-normal.png"

# Authoring controls. Blur values are Gaussian sigma in source-image pixels.
DEFAULT_STRENGTH = 0.1
DEFAULT_BROAD_BLUR = 9.0
DEFAULT_DETAIL_BLUR = 1.4
DEFAULT_DETAIL_WEIGHT = 0.22

# Preview-only lighting controls; these do not affect the normal-map output.
PREVIEW_LIGHT = np.array([-0.42, -0.55, 0.72], np.float32)
PREVIEW_AMBIENT = 0.38
PREVIEW_DIFFUSE = 0.62


def periodic_blur(values: np.ndarray, sigma: float) -> np.ndarray:
    fy = np.fft.fftfreq(values.shape[0])[:, None]
    fx = np.fft.fftfreq(values.shape[1])[None, :]
    kernel = np.exp(-2 * np.pi * np.pi * sigma * sigma * (fx * fx + fy * fy))
    return np.fft.ifft2(np.fft.fft2(values) * kernel).real


def build_normal(
    luminance: np.ndarray,
    strength: float = DEFAULT_STRENGTH,
    broad_blur: float = DEFAULT_BROAD_BLUR,
    detail_blur: float = DEFAULT_DETAIL_BLUR,
    detail_weight: float = DEFAULT_DETAIL_WEIGHT,
) -> np.ndarray:
    height, width = luminance.shape
    base = periodic_blur(luminance, broad_blur)
    detail = luminance - periodic_blur(luminance, detail_blur)
    relief = (1 - detail_weight) * base + detail_weight * detail
    du = (np.roll(relief, -1, axis=1) - np.roll(relief, 1, axis=1)) * (width * 0.5) * strength
    drow = (np.roll(relief, -1, axis=0) - np.roll(relief, 1, axis=0)) * (height * 0.5) * strength
    dv = -drow  # Image rows increase downward; texture +V increases upward.
    normal = np.stack((-du, -dv, np.ones_like(du)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return normal


def nonnegative_float(value: str) -> float:
    number = float(value)
    if not np.isfinite(number) or number < 0:
        raise argparse.ArgumentTypeError("must be a finite number greater than or equal to 0")
    return number


def unit_interval_float(value: str) -> float:
    number = float(value)
    if not np.isfinite(number) or not 0 <= number <= 1:
        raise argparse.ArgumentTypeError("must be a finite number between 0 and 1")
    return number


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--strength", type=nonnegative_float, default=DEFAULT_STRENGTH,
                        help="normal slope strength (default: %(default)s)")
    parser.add_argument("--broad-blur", type=nonnegative_float, default=DEFAULT_BROAD_BLUR,
                        help="broad relief Gaussian sigma in source pixels (default: %(default)s)")
    parser.add_argument("--detail-blur", type=nonnegative_float, default=DEFAULT_DETAIL_BLUR,
                        help="detail cutoff Gaussian sigma in source pixels (default: %(default)s)")
    parser.add_argument("--detail-weight", type=unit_interval_float, default=DEFAULT_DETAIL_WEIGHT,
                        help="detail contribution from 0 to 1; broad contribution is 1 minus this (default: %(default)s)")
    parser.add_argument(
        "--preview",
        type=Path,
        help="optionally write a separate flat-versus-normal preview image",
    )
    args = parser.parse_args()

    dimensions = subprocess.check_output(
        ["magick", "identify", "-format", "%w %h", str(args.source)],
        text=True,
    )
    width, height = map(int, dimensions.split())
    raw = subprocess.check_output(
        ["magick", str(args.source), "-alpha", "off", "-depth", "8", "RGB:-"]
    )
    rgb = np.frombuffer(raw, np.uint8).reshape(height, width, 3).astype(np.float32) / 255
    luminance = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    normal = build_normal(
        luminance, args.strength, args.broad_blur, args.detail_blur, args.detail_weight
    )
    encoded = np.clip(np.rint((normal * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        raw_path = Path(temporary) / "normal.rgb"
        raw_path.write_bytes(encoded.tobytes())
        subprocess.run(
            [
                "magick",
                "-size",
                f"{width}x{height}",
                "-depth",
                "8",
                f"RGB:{raw_path}",
                str(args.output),
            ],
            check=True,
        )

        if args.preview:
            light = PREVIEW_LIGHT.copy()
            light /= np.linalg.norm(light)
            diffuse = np.maximum((normal * light).sum(-1), 0)
            shade = PREVIEW_AMBIENT + PREVIEW_DIFFUSE * diffuse
            lit = np.clip(rgb * shade[..., None], 0, 1)
            flat = np.clip(rgb * (PREVIEW_AMBIENT + PREVIEW_DIFFUSE * max(light[2], 0)), 0, 1)
            pixels = np.rint(np.concatenate([flat, lit], axis=1) * 255).astype(np.uint8)
            preview_raw = Path(temporary) / "preview.ppm"
            preview_raw.write_bytes(
                f"P6\n{width * 2} {height}\n255\n".encode() + pixels.tobytes()
            )
            args.preview.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                ["magick", str(preview_raw), str(args.preview)], check=True
            )


if __name__ == "__main__":
    main()
