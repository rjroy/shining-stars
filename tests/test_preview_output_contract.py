"""Static contract tests for maintained art-preview encoders (no Blender needed)."""

import ast
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

# Deliberately list preview entry points, not build scripts or runtime texture
# exporters. Blender preview renders may use intermediate PNGs; the retained
# deliverable must be encoded as WebP with the shared quality/alpha settings.
PREVIEW_SCRIPTS = (
    "assets/authoring/brightvale-city/preview.py",
    "assets/authoring/brightvale-distant-city/preview.py",
    "assets/authoring/brightvale-highway/preview.py",
    "assets/authoring/brightvale-outer-framing/preview.py",
    "assets/authoring/brightvale-platform-endcaps/preview.py",
    "assets/authoring/brightvale-scene-review/preview.py",
    "assets/authoring/neon-twilight-platform/mode-preview.py",
    "assets/authoring/neon-twilight-platform/preview-slot-cues.py",
    "assets/authoring/neon-twilight-platform/preview.py",
    "assets/production/brightvale-distant-city/preview.py",
)

PNG_RENDER_SCRIPTS = (
    "assets/authoring/brightvale-city/preview.py",
    "assets/authoring/brightvale-scene-review/preview.py",
    "assets/authoring/brightvale-distant-city/preview.py",
)


def source_strings(path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return [node.value for node in ast.walk(tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, str)]


class PreviewOutputContractTest(unittest.TestCase):
    def test_each_preview_declares_a_webp_deliverable(self):
        for relative in PREVIEW_SCRIPTS:
            with self.subTest(script=relative):
                strings = source_strings(ROOT / relative)
                self.assertTrue(
                    any(".webp" in value.lower() for value in strings),
                    f"{relative} must name its retained WebP output",
                )

    def test_cwebp_previews_use_shared_quality_and_alpha_settings(self):
        for relative in PREVIEW_SCRIPTS:
            with self.subTest(script=relative):
                strings = source_strings(ROOT / relative)
                self.assertIn("cwebp", strings,
                              f"{relative} must encode retained previews with cwebp")
                for option, value in (("-q", "80"), ("-m", "6"),
                                      ("-alpha_q", "100")):
                    self.assertTrue(
                        any(strings[index:index + 2] == [option, value]
                            for index in range(len(strings) - 1)),
                        f"{relative} must pass {option} {value} to cwebp",
                    )

    def test_failed_encoder_does_not_publish_partial_webp_and_can_retry(self):
        """Execute the real standalone encoder helper without importing Blender."""
        for relative in PNG_RENDER_SCRIPTS:
            with self.subTest(script=relative):
                helper = extract_encoder(ROOT / relative)
                with self.subTest(attempt="failure then retry"), tempfile.TemporaryDirectory() as td:
                    png = Path(td) / "review.png"
                    png.write_bytes(b"rendered-png")
                    calls = 0

                    def fake_run(command, check):
                        nonlocal calls
                        self.assertTrue(check)
                        destination = Path(command[command.index("-o") + 1])
                        calls += 1
                        destination.write_bytes(b"partial-webp")
                        if calls == 1:
                            raise subprocess.CalledProcessError(1, command)
                        destination.write_bytes(b"complete-webp")

                    namespace = {"subprocess": type("Subprocess", (), {"run": fake_run})}
                    with self.assertRaises(subprocess.CalledProcessError):
                        helper(png, namespace)
                    self.assertFalse(png.with_suffix(".webp").exists(),
                                     "failed encoding must not leave the published filename")
                    self.assertEqual(png.read_bytes(), b"rendered-png",
                                     "failed encoding must preserve the render for retry")
                    result = helper(png, namespace)
                    self.assertEqual(result.read_bytes(), b"complete-webp")
                    self.assertFalse(png.exists(), "successful encoding should clean its temporary PNG")

    def test_render_png_path_is_unique_or_preflighted(self):
        """Catch PNG-neighbor clobbering before any Blender render is started."""
        for relative in PNG_RENDER_SCRIPTS:
            with self.subTest(script=relative):
                source = (ROOT / relative).read_text(encoding="utf-8")
                # Assert an actual derived PNG path and a pre-render collision
                # check, rather than unrelated '.png'/'exists()' substrings.
                if relative == "assets/authoring/brightvale-distant-city/preview.py":
                    png_path = source.find("out/(view+suffix)")
                    preflight = source.find(".exists()", png_path)
                else:
                    png_path = source.find("with_suffix('.png')")
                    if png_path < 0:
                        png_path = source.find('with_suffix(".png")')
                    preflight = source.find("exists()", png_path)
                render = source.find("bpy.ops.render.render")
                self.assertGreaterEqual(png_path, 0,
                                        f"{relative} must derive the render PNG path")
                self.assertGreaterEqual(preflight, png_path,
                                        f"{relative} must check for PNG collisions")
                self.assertLess(preflight, render,
                                f"{relative} must reject collisions before rendering")

    def test_sky_review_and_ground_documented_route_encode_webp(self):
        sky = ROOT / "assets/authoring/brightvale-sky/build-review.sh"
        source = sky.read_text(encoding="utf-8")
        for required in ("cwebp", "-q 80", "-m 6", "-alpha_q 100"):
            self.assertIn(required, source,
                          f"sky review generation route must contain {required}")
        self.assertIn("sky-art-review.webp", source)
        self.assertIn('"$scratch/sky-art-review.png"', source,
                      "the sheet PNG must remain a temporary intermediate")
        self.assertNotIn('"$root/sky-art-review.png"', source,
                         "do not publish a duplicate PNG review sheet")

        ground_readme = ROOT / "assets/authoring/brightvale-ground/README.md"
        instructions = ground_readme.read_text(encoding="utf-8")
        self.assertIn("cwebp", instructions,
                      "documented repeat/composite reproduction must encode WebP")
        for required in ("-q 80", "-m 6", "-alpha_q 100"):
            self.assertIn(required, instructions)
        self.assertIn("ground-textures-repeat-review.webp", instructions)
        self.assertIn("temporary intermediates", instructions)

    def test_production_distant_city_encoder_failure_does_not_publish_partial(self):
        """Exercise comparison-sheet encoding without importing Blender."""
        path = ROOT / "assets/production/brightvale-distant-city/preview.py"
        helper = extract_function(path, "comparison_sheet")
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            destination = out / "comparison.webp"
            cwebp_calls = 0

            def fake_run(*args, **kwargs):
                nonlocal cwebp_calls
                # comparison_sheet's local run() forwards its variadic command
                # as one tuple argument to subprocess.run.
                args = (list(args[0])
                       if len(args) == 1 and isinstance(args[0], (list, tuple))
                       else list(args))
                if args[0] == "cwebp":
                    encoded = Path(args[args.index("-o") + 1])
                    encoded.write_bytes(b"partial-webp")
                    cwebp_calls += 1
                    if cwebp_calls == 1:
                        raise subprocess.CalledProcessError(1, args)
                    encoded.write_bytes(b"complete-webp")
                    return
                Path(args[-1]).write_bytes(b"intermediate")

            namespace = {"subprocess": type("Subprocess", (), {"run": fake_run})}
            with self.assertRaises(subprocess.CalledProcessError):
                helper(out, destination, namespace)
            self.assertFalse(destination.exists(),
                             "failed cwebp must not leave the published WebP name")
            helper(out, destination, namespace)
            self.assertEqual(destination.read_bytes(), b"complete-webp")

    def test_sky_review_encoder_failure_then_retry(self):
        script = ROOT / "assets/authoring/brightvale-sky/build-review.sh"
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            magick = bin_dir / "magick"
            magick.write_text(
                "#!/bin/sh\nfor arg do last=$arg; done\nprintf image > \"$last\"\n",
                encoding="utf-8",
            )
            cwebp = bin_dir / "cwebp"
            cwebp.write_text(
                "#!/bin/sh\n"
                "while [ $# -gt 0 ]; do if [ \"$1\" = -o ]; then shift; out=$1; fi; shift; done\n"
                "printf partial > \"$out\"\n"
                "if [ \"${FAIL_CWEBP:-0}\" = 1 ]; then exit 1; fi\n"
                "printf complete > \"$out\"\n",
                encoding="utf-8",
            )
            magick.chmod(0o755)
            cwebp.chmod(0o755)
            output = root / "review.webp"
            env = os.environ.copy()
            env.update(PATH=f"{bin_dir}{os.pathsep}{env['PATH']}", TMPDIR=str(root),
                       FAIL_CWEBP="1")
            failed = subprocess.run(["bash", str(script), str(output)], env=env,
                                    capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertFalse(output.exists(),
                             "failed encoder must not leave the published output filename")
            env["FAIL_CWEBP"] = "0"
            succeeded = subprocess.run(["bash", str(script), str(output)], env=env,
                                       capture_output=True, text=True)
            self.assertEqual(succeeded.returncode, 0, succeeded.stderr)
            self.assertEqual(output.read_bytes(), b"complete")

    def test_conversion_docs_do_not_encode_removed_png_previews(self):
        for relative in (
            "assets/authoring/brightvale-highway/README.md",
            "assets/authoring/brightvale-platform-endcaps/README.md",
            "assets/authoring/brightvale-outer-framing/README.md",
        ):
            with self.subTest(document=relative):
                instructions = (ROOT / relative).read_text(encoding="utf-8")
                for line in instructions.splitlines():
                    self.assertNotRegex(
                        line,
                        r'(?i)^\s*#?\s*cwebp[^\n]*"\$(?:WORK|OUT)/previews/[^"\n]+\.png"',
                        "obsolete manual preview-PNG conversion step remains",
                    )

    def test_ground_documented_encoder_stages_output_and_fails_fast(self):
        instructions = (ROOT / "assets/authoring/brightvale-ground/README.md").read_text(
            encoding="utf-8")
        # Select the reproduction block by its scratch setup, not the earlier
        # source-texture conversion example.
        marker = 'scratch=$(mktemp -d "${TMPDIR:-/tmp/opencode}/ground-review.'
        marker_at = instructions.index(marker)
        fence_start = instructions.rfind("```", 0, marker_at)
        content_start = instructions.index("\n", fence_start) + 1
        fence_end = instructions.index("```", content_start)
        code_block = instructions[content_start:fence_end]
        self.assertRegex(code_block, r"(?m)^set -euo pipefail$")
        for output in ("city-ground-2x2", "audience-plaza-2x2",
                       "ground-textures-repeat-review"):
            self.assertRegex(
                code_block,
                rf'(?m)^cwebp .*"\$scratch/{output}\.png" -o "\$scratch/{output}\.webp"$',
            )
            self.assertIn(
                f'mv -f -- "$scratch/{output}.webp" "$destination/{output}.webp"',
                code_block,
            )
        self.assertIn("temporary intermediates", instructions)


def extract_encoder(path):
    """Compile only encode_preview from a Blender script; no module mocking."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return extract_from_tree(path, tree, "encode_preview")


def extract_function(path, name):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return extract_from_tree(path, tree, name)


def extract_from_tree(path, tree, name):
    functions = [node for node in tree.body
                 if isinstance(node, ast.FunctionDef) and node.name == name]
    if not functions:
        raise AssertionError(f"{path} must expose a {name} helper")
    function = ast.Module(body=functions, type_ignores=[])
    ast.fix_missing_locations(function)

    def invoke(*args, namespace=None):
        if namespace is None:
            *args, namespace = args
        scope = {"subprocess": namespace["subprocess"], "Path": Path}
        exec(compile(function, str(path), "exec"), scope)
        scope["print"] = lambda *args, **kwargs: None
        return scope[name](*args)

    return invoke


if __name__ == "__main__":
    unittest.main()
