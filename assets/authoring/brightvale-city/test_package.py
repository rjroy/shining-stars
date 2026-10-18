"""Small standalone unit tests for package path and checksum safeguards."""

import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
from package_checks import checked_path, verify_manifest


class PackageChecksTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.model = self.root / "city.blend"
        self.model.write_bytes(b"small test model fixture")
        self.manifest = {
            "schema_version": 1,
            "model_path": "city.blend",
            "approved_model_sha256": hashlib.sha256(self.model.read_bytes()).hexdigest(),
            "files": [{
                "path": "city.blend",
                "bytes": self.model.stat().st_size,
                "sha256": hashlib.sha256(self.model.read_bytes()).hexdigest(),
            }],
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_manifest_passes(self):
        self.assertEqual(verify_manifest(self.root, self.manifest), [])

    def test_tampered_file_fails_hash_and_size_checks(self):
        self.model.write_bytes(b"changed")
        errors = verify_manifest(self.root, self.manifest)
        self.assertIn("Byte-count mismatch: city.blend", errors)
        self.assertIn("SHA-256 mismatch: city.blend", errors)

    def test_parent_traversal_is_rejected(self):
        with self.assertRaises(ValueError):
            checked_path(self.root, "../outside")

    def test_absolute_paths_are_rejected(self):
        with self.assertRaises(ValueError):
            checked_path(self.root, "/outside")

    def test_windows_separators_are_rejected(self):
        with self.assertRaises(ValueError):
            checked_path(self.root, r"..\outside")


if __name__ == "__main__":
    unittest.main()
