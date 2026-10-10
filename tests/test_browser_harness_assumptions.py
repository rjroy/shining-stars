import importlib.util
import json
import shutil
import subprocess
import unittest
from pathlib import Path


TESTS = Path(__file__).resolve().parent


def load_script(name, filename):
    spec = importlib.util.spec_from_file_location(name, TESTS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FLOW = load_script("browser_flow", "browser-flow.py")
LIFECYCLE = load_script("browser_lifecycle", "browser-lifecycle.py")


class BrowserHarnessAssumptionTests(unittest.TestCase):
    def test_balance_parser_reads_current_audience_renown_and_twilight_copy(self):
        parsed = FLOW.balance_from_ui(
            {
                "rulesText": (
                    "Perfect ±75 ms · Good ±150 ms. Audience Renown: Perfect 3, "
                    "Good 2, Miss 0. Twilight: Miss costs 3; Good costs 1 and "
                    "deals 2; Perfect costs 0 and deals 3."
                )
            }
        )
        self.assertEqual(parsed["audience"], {"perfect": 3, "good": 2, "miss": 0})
        self.assertEqual(
            parsed["twilight"],
            {
                "miss": {"personalCost": 3, "damage": 0},
                "good": {"personalCost": 1, "damage": 2},
                "perfect": {"personalCost": 0, "damage": 3},
            },
        )

    def test_balance_parser_rejects_obsolete_audience_earnings_copy(self):
        with self.assertRaisesRegex(AssertionError, "current Audience Renown"):
            FLOW.balance_from_ui(
                {
                    "rulesText": (
                        "Perfect hits earn 10 Renown, good hits earn 5, and misses "
                        "earn 0. Misses cost 2 Personal Strength; good hits cost 1 "
                        "and deal 3 damage; perfect hits cost 0 and deal 5 damage."
                    )
                }
            )

    def test_escape_resume_position_uses_audited_keydown_time(self):
        source_start = {"values": [10.0, 2.5, 20.0]}
        escape = FLOW.escape_keydown_event(
            [
                {"code": "KeyD", "time": 12.9},
                {"code": "Escape", "time": 13.25},
                {"code": "KeyJ", "time": 18.0},
            ]
        )
        self.assertAlmostEqual(
            FLOW.resume_offset_at_keydown(source_start, escape["time"]), 5.75
        )
        self.assertAlmostEqual(
            FLOW.resume_offset_at_keydown(source_start, 9.0), 2.5
        )

    @unittest.skipUnless(shutil.which("node"), "installed Node.js runtime required")
    def test_app03_predicate_executes_against_pending_and_visible_action_states(self):
        predicate = LIFECYCLE.app03_recovery_ready_script()
        runtime = r"""
const vm = require('node:vm');
const predicate = process.argv[1];
function action(name, {disabled=false, hidden=false, display='block', visibility='visible', rects=1}={}) {
  const attributes = new Set();
  return {
    dataset: {action:name}, disabled, hidden,
    setAttribute(key) { attributes.add(key); },
    removeAttribute(key) { attributes.delete(key); },
    hasAttribute(key) { return attributes.has(key); },
    closest(selector) { return selector === '[hidden]' && hidden ? {} : null; },
    getClientRects() { return {length:rects}; },
    __style:{display,visibility}
  };
}
function evaluate({fetches=1,done=1,pendingHidden=true,busy=false,buttons=[]}) {
  const pending = {hidden:pendingHidden};
  const surface = {getAttribute:()=>busy?'true':'false'};
  const document = {
    querySelectorAll(selector) { return selector==='[data-action]' ? buttons : []; },
    querySelector(selector) {
      if(selector==='.play-surface') return surface;
      if(selector==="[data-pending-status]") return pending;
      if(selector==='[data-app03-recovery-target="true"]')
        return buttons.find(b=>b.hasAttribute('data-app03-recovery-target'))||null;
      return null;
    }
  };
  const window = {__brightvaleLifecycle:{fetches:Array(fetches),fetchDone:Array(done)}};
  const result = vm.runInNewContext(predicate, {window,document,
    getComputedStyle:element=>element.__style});
  return {result,marked:document.querySelector('[data-app03-recovery-target="true"]')};
}
const validResume=action('resume');
const hiddenStart=action('start',{hidden:true});
const visible=evaluate({buttons:[hiddenStart,validResume]});
const cases={
  valid:visible.result===true&&visible.marked===validResume,
  noFetch:evaluate({fetches:0,buttons:[action('start')]}).result===false,
  unfinishedFetch:evaluate({done:0,buttons:[action('start')]}).result===false,
  pendingUi:evaluate({pendingHidden:false,buttons:[action('start')]}).result===false,
  busy:evaluate({busy:true,buttons:[action('start')]}).result===false,
  hidden:evaluate({buttons:[action('start',{hidden:true})]}).result===false,
  disabled:evaluate({buttons:[action('start',{disabled:true})]}).result===false,
  displayNone:evaluate({buttons:[action('start',{display:'none'})]}).result===false,
  noAction:evaluate({buttons:[]}).result===false
};
if(Object.values(cases).some(value=>!value)) process.exitCode=1;
process.stdout.write(JSON.stringify(cases));
"""
        result = subprocess.run(
            [shutil.which("node"), "-e", runtime, predicate],
            check=True,
            capture_output=True,
            text=True,
        )
        cases = json.loads(result.stdout)
        self.assertTrue(all(cases.values()), cases)


if __name__ == "__main__":
    unittest.main()
