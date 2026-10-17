"""Export the approved maintained platform revision, never a study/reference copy."""
from pathlib import Path
import sys
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from structural import export_main
if __name__=='__main__':export_main('platform',Path(__file__).resolve().parent)
