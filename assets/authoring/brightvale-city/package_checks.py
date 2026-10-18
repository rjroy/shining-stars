"""Standard-library package manifest checks for the Brightvale city source."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_manifest(root: Path) -> dict:
    return json.loads((root / "manifest.json").read_text(encoding="utf-8"))


def checked_path(root: Path, relative: str) -> Path:
    """Resolve a manifest path while refusing absolute/traversing/symlink escapes."""
    rel = PurePosixPath(relative)
    if ("\\" in relative or rel.is_absolute() or not rel.parts
            or any(part in ("", ".", "..") for part in rel.parts)):
        raise ValueError(f"Unsafe manifest path: {relative!r}")
    base = root.resolve()
    candidate = (base / Path(*rel.parts)).resolve()
    if candidate != base and base not in candidate.parents:
        raise ValueError(f"Manifest path escapes package: {relative!r}")
    return candidate


def verify_manifest(root: Path, manifest: dict | None = None) -> list[str]:
    """Return integrity errors; does not write to the package or scene."""
    root = root.resolve()
    if manifest is None:
        manifest = load_manifest(root)
    errors: list[str] = []
    if manifest.get("schema_version") != 1:
        errors.append("Unsupported manifest schema_version")
    if not isinstance(manifest.get("files"), list):
        return errors + ["Manifest files must be a list"]

    seen: set[str] = set()
    for entry in manifest["files"]:
        rel = entry.get("path")
        if not isinstance(rel, str) or rel in seen:
            errors.append(f"Missing or duplicate manifest path: {rel!r}")
            continue
        seen.add(rel)
        try:
            path = checked_path(root, rel)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if not path.is_file():
            errors.append(f"Missing package file: {rel}")
            continue
        if path.stat().st_size != entry.get("bytes"):
            errors.append(f"Byte-count mismatch: {rel}")
        expected = entry.get("sha256")
        actual = sha256_file(path)
        if not isinstance(expected, str) or actual != expected:
            errors.append(f"SHA-256 mismatch: {rel}")
        if entry.get("origin_sha256") and entry["origin_sha256"] != expected:
            errors.append(f"Copy/origin checksum record mismatch: {rel}")
    model_path = manifest.get("model_path")
    if model_path not in seen:
        errors.append("Model path is not covered by manifest files")
    model_entry = next((item for item in manifest["files"] if item.get("path") == model_path), None)
    if model_entry and model_entry.get("sha256") != manifest.get("approved_model_sha256"):
        errors.append("Approved model hash differs from model manifest entry")
    return errors
