#!/usr/bin/env python3
"""Generate a periodic tangent-space normal from the runtime city-ground map."""

import argparse
import subprocess
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "production/brightvale-ground/city-ground.png"
DEFAULT_OUTPUT = ROOT / "production/brightvale-ground/city-ground-normal.png"


def periodic_blur(values: np.ndarray, sigma: float) -> np.ndarray:
    fy = np.fft.fftfreq(values.shape[0])[:, None]
    fx = np.fft.fftfreq(values.shape[1])[None, :]
    kernel = np.exp(-2 * np.pi * np.pi * sigma * sigma * (fx * fx + fy * fy))
    return np.fft.ifft2(np.fft.fft2(values) * kernel).real


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
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
    base = periodic_blur(luminance, 9.0)
    detail = luminance - periodic_blur(luminance, 1.4)
    relief = 0.78 * base + 0.22 * detail
    du = (np.roll(relief, -1, axis=1) - np.roll(relief, 1, axis=1)) * (width * 0.5) * 0.035
    drow = (np.roll(relief, -1, axis=0) - np.roll(relief, 1, axis=0)) * (height * 0.5) * 0.035
    dv = -drow  # Image rows increase downward; texture +V increases upward.
    normal = np.stack((-du, -dv, np.ones_like(du)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
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
            light = np.array([-0.42, -0.55, 0.72], np.float32)
            light /= np.linalg.norm(light)
            diffuse = np.maximum((normal * light).sum(-1), 0)
            shade = 0.38 + 0.62 * diffuse
            lit = np.clip(rgb * shade[..., None], 0, 1)
            flat = np.clip(rgb * (0.38 + 0.62 * max(light[2], 0)), 0, 1)
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
