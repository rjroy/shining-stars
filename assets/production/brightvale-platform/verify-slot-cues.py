"""Relocated ixp authoring regeneration + scope check + exact GLB/reimport tests.

Standard Python runner. No source saves, production replacements, or browser work.
All generated work is owned /tmp/opencode scratch; failure retains diagnostics.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

PACKAGE = Path(__file__).resolve().parent
AUTHORING = PACKAGE.parents[1] / "authoring" / "neon-twilight-platform"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=PACKAGE / "platform.glb")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    artifact, report = args.input.resolve(), args.report.resolve()
    assert artifact.is_file()
    assert report.suffix == ".json" and report.parent.is_dir()
    assert report.parent == PACKAGE or report.is_relative_to(Path("/tmp/opencode"))
    if report.exists():
        raise FileExistsError(report)
    author_files = ("platform.blend", "platform-slot-cues.blend", "build.py",
                    "revise-slot-cues.py", "validate-slot-cues.py")
    prod_files = ("export.py", "validate.py", "structural.py")
    watched = [AUTHORING / n for n in author_files] + [PACKAGE / n for n in prod_files] + [artifact]
    before = {str(p): sha(p) for p in watched}
    work = Path(tempfile.mkdtemp(prefix="platform-slot-cues-", dir="/tmp/opencode"))
    author = work / "assets/authoring/neon-twilight-platform"
    prod = work / "assets/production/brightvale-platform"
    author.mkdir(parents=True); prod.mkdir(parents=True)
    for name in author_files:
        shutil.copyfile(AUTHORING / name, author / name)
    for name in prod_files:
        shutil.copyfile(PACKAGE / name, prod / name)
    counter = 0

    def run(script, *argv, source=None, expect_failure=False):
        nonlocal counter
        counter += 1
        cmd = ["blender", "--background"]
        if source:
            cmd.append(str(source))
        cmd += ["--threads", "8", "--python-exit-code", "1", "--python", str(script), "--", *map(str, argv)]
        log = work / ("process-%d.log" % counter)
        print("RELOCATED PROCESS ATTEMPT", cmd, "LOG", log, flush=True)
        with log.open("w") as f:
            result = subprocess.run(cmd, cwd=work, stdout=f, stderr=subprocess.STDOUT, timeout=300)
        if expect_failure:
            assert result.returncode != 0 and "Source checksum mismatch" in log.read_text(), log.read_text()
        elif result.returncode:
            raise RuntimeError("Blender failed (%s): %s\n%s" % (result.returncode, log, log.read_text()))
        print("RELOCATED PROCESS SUCCESS", script.name, "exit", result.returncode, flush=True)

    try:
        run(author / "revise-slot-cues.py", "--output-dir", author / "generated/rebuilt")
        run(author / "validate-slot-cues.py", "--report", author / "generated/scope.json",
            "--compare", author / "generated/rebuilt/platform.blend", source=author / "platform-slot-cues.blend")
        scope = json.loads((author / "generated/scope.json").read_text())
        run(prod / "export.py", "--output", work / "regenerated.glb", "--report", work / "export.json")
        run(prod / "validate.py", "--input", artifact, "--compare", work / "regenerated.glb",
            "--report", work / "validation.json", "--negative-test")
        run(prod / "export.py", "--source", author / "platform.blend", "--output", work / "forbidden.glb",
            "--report", work / "forbidden.json", expect_failure=True)
        assert not (work / "forbidden.glb").exists() and not (work / "forbidden.json").exists()
        validation = json.loads((work / "validation.json").read_text())
        assert {str(p): sha(p) for p in watched} == before, "Input mutated"
        g = validation["glb"]
        result = {"pass": True, "revision": "shining-stars-ixp approved slot-cue revision",
                  "blender": "5.2.1 LTS", "exporter": "5.2.40",
                  "source": "neon-twilight-platform/platform-slot-cues.blend",
                  "source_sha256": sha(AUTHORING / "platform-slot-cues.blend"),
                  "lineage_source_sha256": sha(AUTHORING / "platform.blend"),
                  "lineage_generator_sha256": sha(AUTHORING / "build.py"),
                  "source_scope": scope, "glb_sha256": sha(artifact), "transfer_bytes": artifact.stat().st_size,
                  "independent_relocated_byte_identical": validation["independent_reproduction_byte_identical"],
                  "nodes": g["nodes"], "triangles": g["triangles"], "primitives": g["primitives"],
                  "material_roles": len(g["material_roles"]), "bounds_gltf": g["bounds_gltf"],
                  "max_direct_position_error": max(m["max_position_error"] for m in g["meshes"].values()),
                  "max_direct_normal_error": max(m["max_corner_normal_error"] for m in g["meshes"].values()),
                  "max_reimport_normal_error": max(m["max_corner_normal_error"] for m in validation["reimport"].values()),
                  "inherited_near_zero_area_triangles": sum(m["inherited_near_zero_area_triangles"] for m in g["meshes"].values()),
                  "negative_tests": {**validation["negative_tests"], "legacy_source_rejected": True},
                  "inputs_unchanged": True, "consumer_transform_contract": "unchanged Blender (x,y,z) to glTF (x,z,-y); apply existing whole-scene playfield matrix once",
                  "limitations": ["Browser review and runtime acceptance pending designer.",
                                  "No Khronos validator, device benchmark or exhaustive intersection test.",
                                  "Legacy combined study still contains the pre-ixp platform; old exact-study verification is historical, not run or weakened."]}
        with report.open("x") as f:
            json.dump(result, f, indent=2); f.write("\n")
    except BaseException:
        print("RELOCATED VERIFICATION FAILED; owned scratch retained", work, flush=True)
        raise
    else:
        shutil.rmtree(work)
        print("RELOCATED SLOT-CUE VERIFICATION PASS", report, flush=True)


if __name__ == "__main__":
    main()
