"""Export the already-detailed 42-unit highway from current scene-review.blend."""
from pathlib import Path
import sys
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'brightvale-platform'))
from structural import export_main
if __name__=='__main__':export_main('highway',Path(__file__).resolve().parent)
