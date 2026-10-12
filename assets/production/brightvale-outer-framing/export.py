"""Export one original reusable module at its floor-centered local origin."""
from pathlib import Path
import sys
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'brightvale-platform'))
from structural import export_main
if __name__=='__main__':
 # Remove package-specific selector before shared CLI parsing.
 i=sys.argv.index('--kind');kind=sys.argv[i+1];del sys.argv[i:i+2]
 assert kind in ('long','short','post')
 export_main(kind,Path(__file__).resolve().parent)
