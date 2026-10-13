from pathlib import Path
import sys
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'brightvale-platform'))
from structural import validate_main
if __name__=='__main__':validate_main('highway',Path(__file__).resolve().parent)
