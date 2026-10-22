"""Reproduce the current study from immutable sibling sources, never overwrite.

The five shared-scene stages are executed in owned temporary scratch, not exposed
as maintained candidate directories. Successful scratch is removed; failure
scratch is preserved and reported. No export or runtime work.
"""
import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile

PACKAGE = Path(__file__).resolve().parent
GENERATOR = PACKAGE.parent / 'brightvale-highway/build.py'
GENERATOR_SHA = 'c48aae15008446cfbc351d8a49390f3f099356d420722ada977f46b11c26b82e'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); dest = args.output.resolve()
    assert dest.suffix == '.blend' and dest.parent.is_dir()
    assert dest.is_relative_to(PACKAGE) or dest.is_relative_to(Path('/tmp/opencode'))
    if dest.exists(): raise FileExistsError(dest)
    assert hashlib.sha256(GENERATOR.read_bytes()).hexdigest() == GENERATOR_SHA, 'Highway generator changed'
    scratch = Path(tempfile.mkdtemp(prefix='brightvale-study-', dir='/tmp/opencode'))
    def run(script, *arguments):
        cmd = ['blender', '--background', '--threads', '8', '--python-exit-code', '1', '--python', str(script), '--', *map(str, arguments)]
        print('BUILD STAGE ATTEMPT', cmd, flush=True)
        subprocess.run(cmd, check=True, timeout=180)
        print('BUILD STAGE SUCCESS', script.name, flush=True)
    try:
        run(PACKAGE/'assemble.py', '--output', scratch/'base.blend')
        run(GENERATOR, '--output-dir', scratch/'road', '--length', '42')
        run(PACKAGE/'scripts/compose.py', '--input', scratch/'base.blend', '--road', scratch/'road/highway-candidate.blend', '--output', scratch/'composition.blend')
        run(PACKAGE/'scripts/framing.py', '--input', scratch/'composition.blend', '--output', scratch/'framing.blend')
        run(PACKAGE/'scripts/ground.py', '--input', scratch/'framing.blend', '--output', scratch/'ground.blend')
        cmd = ['blender', '--background', str(scratch/'ground.blend'), '--threads', '8',
                '--python-exit-code', '1', '--python', str(PACKAGE/'validate.py'), '--',
                '--report', str(scratch/'validation.json'), '--negative-test']
        print('BUILD VALIDATION ATTEMPT', cmd, flush=True)
        subprocess.run(cmd, check=True, timeout=240)
        print('BUILD VALIDATION SUCCESS; shared city/playfield checks passed', flush=True)
        # Exclusive creation protects maintained files even if another process
        # creates the destination after the initial check.
        print('BUILD COPY ATTEMPT', dest, flush=True)
        with dest.open('xb') as output, (scratch/'ground.blend').open('rb') as source:
            shutil.copyfileobj(source, output)
        print('BUILD COPY SUCCESS', dest, flush=True)
    except BaseException:
        print('BUILD FAILED; diagnostic scratch retained:', scratch, flush=True)
        raise
    else:
        shutil.rmtree(scratch)
        print('BUILD SUCCESS; owned scratch removed', flush=True)


if __name__ == '__main__': main()
