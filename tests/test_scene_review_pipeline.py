"""Contracts for the retained shared city/playfield authoring pipeline."""

import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "assets/authoring/brightvale-scene-review"


def source(relative):
    return (ROOT / relative).read_text(encoding="utf-8")


class SceneReviewPipelineTest(unittest.TestCase):
    def test_build_keeps_all_non_crowd_stages_in_order(self):
        build_path = PACKAGE / "build.py"
        tree = ast.parse(build_path.read_text(encoding="utf-8"))
        main = next(
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "main"
        )
        generator = next(
            node.value
            for node in tree.body
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "GENERATOR" for target in node.targets)
        )
        generator_path = generator.right.value
        stages = []
        for node in ast.walk(main):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            if node.func.id != "run" or not node.args:
                continue
            script = node.args[0]
            if isinstance(script, ast.Name) and script.id == "GENERATOR":
                stages.append(generator_path)
                continue
            if (
                isinstance(script, ast.BinOp)
                and isinstance(script.op, ast.Div)
                and isinstance(script.right, ast.Constant)
                and isinstance(script.right.value, str)
            ):
                stages.append(script.right.value)

        self.assertEqual(
            stages,
            [
                "assemble.py",
                "brightvale-highway/build.py",
                "scripts/compose.py",
                "scripts/framing.py",
                "scripts/ground.py",
            ],
        )
        self.assertIn("scratch/'ground.blend'", build_path.read_text())
        self.assertNotIn("scripts/crowd.py", build_path.read_text())

    def test_final_validation_runs_shared_city_and_playfield_checks(self):
        validator = ast.parse((PACKAGE / "validate.py").read_text(encoding="utf-8"))
        calls = {
            node.func.attr
            for node in ast.walk(validator)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "L"
        }
        self.assertTrue({"arc_check", "ground_checks", "lane_checks"} <= calls)
        checks = (PACKAGE / "scripts/checks.py").read_text(encoding="utf-8")
        self.assertIn("City base not on lower world ground", checks)
        self.assertIn("Disk rotation/scale", checks)
        self.assertIn("Open section-post joint", checks)
        self.assertIn("Lane occluded", checks)
        self.assertNotIn("review_asset')=='crowd", checks)

    def test_ground_and_layout_contracts_exclude_old_sample_crowd(self):
        ground = (PACKAGE / "scripts/ground.py").read_text(encoding="utf-8")
        layout = source("assets/production/brightvale-highway/layout.py")
        runtime_layout = source("tools/brightvale-layout/generate.mjs")
        self.assertNotIn("crowd_bounds", ground)
        self.assertNotIn("existing_crowd_sample_roots", layout)
        self.assertNotIn("existing_crowd_sample_roots", runtime_layout)
        self.assertNotIn("crowdPlacements", runtime_layout)


if __name__ == "__main__":
    unittest.main()
