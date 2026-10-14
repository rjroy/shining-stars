#!/usr/bin/env python3
"""Exercise two complete, real-clock game runs in Chromium via WebDriver."""

import hashlib
import json
import argparse
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


OUTPUT = Path("/tmp/opencode/brightvale-stage5")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_PATH = PROJECT_ROOT / "data/charts/the-first-shining-star.beats.json"
DIFFICULTY_PROFILES_PATH = PROJECT_ROOT / "data/charts/difficulty-profiles.json"


def load_chart_reference():
    artifact = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
    source = artifact["source"]
    config = artifact["config"]
    source_path = (PROJECT_ROOT / source["path"]).resolve()
    actual_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
    if actual_hash != artifact["source_sha256"] or actual_hash != source["sha256"]:
        raise ValueError("beat artifact source SHA-256 does not match the selected recording")
    notes = artifact["notes"]
    if not notes:
        raise ValueError("beat artifact contains no selected notes")
    return artifact, config, notes


_, CHART_CONFIG, CHART_NOTES = load_chart_reference()
SOURCE_START = CHART_CONFIG["source_start"]
HANDOFF_TIME = CHART_CONFIG["boundary"]
FINAL_NOTE_TIME = max(note["relative_time"] for note in CHART_NOTES)
AUDIENCE_NOTE_COUNT = sum(
    note["relative_time"] < HANDOFF_TIME for note in CHART_NOTES
)
TWILIGHT_NOTE_COUNT = sum(
    note["relative_time"] > HANDOFF_TIME for note in CHART_NOTES
)
INITIAL_TWILIGHT_STRENGTH = CHART_CONFIG["twilight_strength"]
LANE_KEYS = {0: "d", 1: "f", 2: "j", 3: "k"}
AUDIENCE_NOTES = [
    note for note in CHART_NOTES if note["relative_time"] < HANDOFF_TIME
]
TWILIGHT_NOTES = [
    note for note in CHART_NOTES if note["relative_time"] > HANDOFF_TIME
]


def request(base, method, path, payload=None, timeout=30):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        base + path,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(
            f"{method} {path} returned {error.code}: "
            f"{error.read().decode(errors='replace')}"
        ) from error
    decoded = json.loads(raw) if raw else {}
    value = decoded.get("value")
    if isinstance(value, dict) and value.get("error") and value.get("message"):
        raise RuntimeError(f"WebDriver {method} {path}: {value}")
    return value


def execute(driver, session, script, args=None):
    return request(
        driver,
        "POST",
        f"/session/{session}/execute/sync",
        {"script": script, "args": args or []},
    )


def wait_for(driver, session, expression, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if execute(driver, session, f"return Boolean({expression})"):
            return
        time.sleep(0.1)
    diagnostics = execute(
        driver,
        session,
        "return ({panels:[...document.querySelectorAll('[data-panel]')].map(p=>"
        "({name:p.dataset.panel,hidden:p.hidden})),time:"
        "document.querySelector('[data-time]')?.textContent,mode:"
        "document.querySelector('[data-mode-label]')?.textContent,audit:(()=>{"
        "const a=window.__brightvaleFlow;return {state:a.context?.state,"
        "time:a.context?.currentTime,starts:a.starts,keys:a.keys,"
        "visibility:a.visibility,stops:a.stops,active:a.activeSources}})()})",
    )
    raise TimeoutError(f"Timed out waiting for {expression}; state={diagnostics}")


def click(driver, session, selector):
    element = request(
        driver,
        "POST",
        f"/session/{session}/element",
        {"using": "css selector", "value": selector},
    )["element-6066-11e4-a52e-4f735466cecf"]
    request(driver, "POST", f"/session/{session}/element/{element}/click", {})


def send_key(driver, session, value, repeat=False):
    path = f"/session/{session}/actions"
    key_source = {"type": "key", "id": "brightvale-keys"}
    if repeat:
        for _ in range(2):
            request(
                driver,
                "POST",
                path,
                {"actions": [{**key_source, "actions": [{"type": "keyDown", "value": value}]}]},
            )
        request(driver, "DELETE", path, {})
        return

    request(
        driver,
        "POST",
        path,
        {
            "actions": [
                {
                    **key_source,
                    "actions": [
                        {"type": "keyDown", "value": value},
                        {"type": "keyUp", "value": value},
                    ],
                }
            ]
        },
    )


def screenshot(driver, session, filename):
    import base64

    encoded = request(driver, "GET", f"/session/{session}/screenshot")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / filename).write_bytes(base64.b64decode(encoded))


def create_session(driver, url):
    capabilities = {
        "capabilities": {
            "alwaysMatch": {
                "browserName": "chrome",
                "goog:chromeOptions": {
                    "binary": "/usr/bin/chromium",
                    "args": [
                        "--headless=new",
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--window-size=1024,600",
                    ],
                },
            }
        }
    }
    session = request(driver, "POST", "/session", capabilities, timeout=45)[
        "sessionId"
    ]
    request(
        driver,
        "POST",
        f"/session/{session}/timeouts",
        {"script": 15000, "pageLoad": 60000, "implicit": 0},
    )
    instrumentation = r"""(()=>{
      const audit={contexts:[],starts:[],keys:[],visibility:[],stops:0,
        activeSources:0,maxActiveSources:0,firstResultsVisibleAt:null,
        firstResultsSourceActive:null};
      window.__brightvaleFlow=audit;
      const NativeContext=window.AudioContext;
      window.AudioContext=class extends NativeContext{
        constructor(...args){super(...args);audit.contexts.push(this);audit.context=this}
        createBufferSource(){
          const source=super.createBufferSource();
          const start=source.start.bind(source),stop=source.stop.bind(source);
          const becameInactive=()=>{
            if(source.__brightvaleActive){
              source.__brightvaleActive=false;audit.activeSources--;
            }
          };
          source.addEventListener('ended',becameInactive,{once:true});
          source.start=(...values)=>{
            source.__brightvaleActive=true;audit.activeSources++;
            audit.maxActiveSources=Math.max(audit.maxActiveSources,audit.activeSources);
            audit.starts.push({values,time:this.currentTime,state:this.state});
            return start(...values);
          };
          source.stop=(...values)=>{
            audit.stops++;becameInactive();return stop(...values);
          };
          return source;
        }
      };
      window.addEventListener('keydown',event=>audit.keys.push({
        code:event.code,repeat:event.repeat,target:event.target?.tagName,
        time:audit.context?.currentTime??null
      }),true);
      document.addEventListener('visibilitychange',()=>audit.visibility.push({
        state:document.visibilityState,time:audit.context?.currentTime??null
      }),true);
      const resultVisibilityObserver=new MutationObserver(()=>{
        const panel=document.querySelector('[data-panel=results]');
        if(panel&&!panel.hidden&&audit.firstResultsVisibleAt===null&&audit.context){
          audit.firstResultsVisibleAt=audit.context.currentTime;
          audit.firstResultsSourceActive=audit.activeSources>0;
        }
      });
      const observeResults=()=>resultVisibilityObserver.observe(
        document.documentElement,
        {subtree:true,attributes:true,attributeFilter:['hidden']}
      );
      if(document.documentElement)observeResults();
      else document.addEventListener('DOMContentLoaded',observeResults,{once:true});
    })();"""
    request(
        driver,
        "POST",
        f"/session/{session}/goog/cdp/execute",
        {
            "cmd": "Page.addScriptToEvaluateOnNewDocument",
            "params": {"source": instrumentation},
        },
    )
    request(driver, "POST", f"/session/{session}/url", {"url": url}, timeout=70)
    wait_for(driver, session, "document.readyState==='complete'", timeout=30)
    wait_for(
        driver,
        session,
        "!document.querySelector('[data-panel=ready]').hidden",
    )
    return session


def browser_state(driver, session):
    return execute(
        driver,
        session,
        "const a=window.__brightvaleFlow;return ({audit:{currentTime:"
        "a.context.currentTime,contextState:a.context.state,starts:a.starts,"
         "keys:a.keys,visibility:a.visibility,stops:a.stops,"
         "activeSources:a.activeSources,maxActiveSources:a.maxActiveSources,"
         "firstResultsVisibleAt:a.firstResultsVisibleAt,"
         "firstResultsSourceActive:a.firstResultsSourceActive,},mode:"
         "document.querySelector('[data-mode-label]').textContent,resourceName:"
         "document.querySelector('[data-resource-name]').textContent,resourceValue:"
         "document.querySelector('[data-resource-value]').textContent,personalStrength:"
         "document.querySelector('[data-personal-strength]').textContent,twilightStrength:"
         "document.querySelector('[data-twilight-strength]').textContent,resultTitle:"
         "document.querySelector('[data-result-title]').textContent,time:"
        "document.querySelector('[data-time]').textContent,panels:"
        "[...document.querySelectorAll('[data-panel]')].filter(p=>!p.hidden)"
        ".map(p=>p.dataset.panel),results:[...document.querySelectorAll("
        "'[data-result-grid] .result-line')].map(x=>x.innerText),resultText:"
        "document.querySelector('[data-panel=results]').innerText})",
    )


def assert_first_results_after_audio_tail(
    scenario, first_visible, scheduled_end, final_note_target
):
    end_threshold = scheduled_end - 0.05
    if first_visible < end_threshold or first_visible < final_note_target:
        raise AssertionError(
            f"{scenario} results became visible too early: "
            f"firstVisible={first_visible:.3f}s, "
            f"finalNote={final_note_target:.3f}s, "
            f"scheduledEnd={scheduled_end:.3f}s, "
            f"endThreshold={end_threshold:.3f}s"
        )


def audio_clock(driver, session):
    return execute(
        driver,
        session,
        "return window.__brightvaleFlow.context.currentTime",
    )


def wait_for_clock(driver, session, target, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        now = audio_clock(driver, session)
        if now >= target:
            return now
        time.sleep(min(0.02, max(0.001, target - now)))
    raise TimeoutError(
        f"AudioContext.currentTime did not reach {target:.3f}s "
        f"(last={audio_clock(driver, session):.3f}s)"
    )


def latest_start(driver, session):
    state = browser_state(driver, session)
    if not state["audit"]["starts"]:
        raise AssertionError("No native AudioBufferSourceNode.start was observed")
    return state["audit"]["starts"][-1]


def resume_offset_at_keydown(source_start, keydown_time):
    source_position = max(0, keydown_time - source_start["values"][0])
    return source_start["values"][1] + source_position


def escape_keydown_event(events):
    event = next((event for event in events if event["code"] == "Escape"), None)
    if event is None:
        raise AssertionError("Escape pause did not produce an audited native keydown")
    return event


def press_at_note(driver, session, start, note_time, key, repeat=False):
    when, offset = start["values"][0], start["values"][1]
    position_at_start = offset - SOURCE_START
    target = when + (note_time - position_at_start)
    if target <= audio_clock(driver, session):
        raise AssertionError(f"Key target {note_time}s already passed at {target:.3f}")
    before = len(browser_state(driver, session)["audit"]["keys"])
    wait_for_clock(driver, session, target - 0.06)
    send_key(driver, session, key, repeat=repeat)
    state = browser_state(driver, session)
    events = state["audit"]["keys"][before:]
    matching = [event for event in events if event["code"] == f"Key{key.upper()}"]
    if not matching:
        raise AssertionError(f"WebDriver key {key!r} produced no matching keydown")
    actual_time = matching[0]["time"]
    error = actual_time - target
    result = {
        "key": key,
        "targetTransportTime": note_time,
        "targetContextTime": target,
        "actualContextTime": actual_time,
        "timingErrorSeconds": error,
        "quality": "perfect" if abs(error) <= 0.075 else "good",
        "repeatObserved": any(event["repeat"] for event in matching),
        "resource": state["resourceValue"],
        "personalStrength": state["personalStrength"],
        "twilightStrength": state["twilightStrength"],
        "panels": state["panels"],
    }
    if abs(error) > 0.15:
        raise AssertionError(f"WebDriver key landed outside Good window: {result}")
    return result


def balance_from_config():
    profiles = json.loads(
        DIFFICULTY_PROFILES_PATH.read_text(encoding="utf-8")
    )["profiles"]
    profile = profiles["normal"]
    audience = profile["audience"]
    twilight = profile["twilight"]
    return {
        "audience": {
            "perfect": audience["perfect"],
            "good": audience["good"],
            "miss": audience["miss"],
        },
        "twilight": {
            "miss": {
                "personalCost": twilight["miss"]["personal_cost"],
                "damage": twilight["miss"]["damage"],
            },
            "good": {
                "personalCost": twilight["good"]["personal_cost"],
                "damage": twilight["good"]["damage"],
            },
            "perfect": {
                "personalCost": twilight["perfect"]["personal_cost"],
                "damage": twilight["perfect"]["damage"],
            },
        },
    }


def result_strength(lines, label):
    line = next((value for value in lines if value.lower().startswith(label.lower())), "")
    match = re.search(rf"{re.escape(label)}\s+(\d+)", line, re.IGNORECASE)
    if match is None:
        raise AssertionError(f"Missing {label!r} result value in {lines}")
    return int(match.group(1))


def assert_no_source_overlap(state, scenario):
    active = state["audit"]["activeSources"]
    peak = state["audit"]["maxActiveSources"]
    if peak > 1:
        raise AssertionError(f"{scenario}: more than one scheduled source at once ({peak})")
    return {"activeAtCheck": active, "maxActive": peak, "intentionalStops": state["audit"]["stops"]}


def all_miss_run(driver, url):
    session = create_session(driver, url)
    try:
        click(driver, session, '[data-panel="ready"] [data-action="start"]')
        wait_for(driver, session, "window.__brightvaleFlow.starts.length===1", timeout=45)
        start = latest_start(driver, session)
        if start["state"] != "running":
            raise AssertionError(f"All-miss source was scheduled while context={start['state']}")
        if abs(start["values"][1] - SOURCE_START) > 0.001:
            raise AssertionError(f"Unexpected excerpt source offset: {start}")
        screenshot(driver, session, "all-miss-playing.png")

        wait_for(
            driver,
            session,
            "document.querySelector('[data-mode-label]').textContent.includes('Twilight')",
            timeout=55,
        )
        mode_state = browser_state(driver, session)
        if mode_state["resourceName"] != "Twilight combat":
            raise AssertionError(f"Twilight mode did not expose combat strengths: {mode_state}")
        if mode_state["resourceValue"] != "0":
            raise AssertionError(
                f"All-miss handoff should preserve zero Renown; got {mode_state['resourceValue']}"
            )
        if mode_state["personalStrength"] != "0":
            raise AssertionError(f"Zero-Renown handoff should immediately defeat: {mode_state}")
        if float(mode_state["twilightStrength"]) != INITIAL_TWILIGHT_STRENGTH:
            raise AssertionError(f"Handoff changed initial Twilight Strength: {mode_state}")
        screenshot(driver, session, "all-miss-twilight.png")

        scheduled_end = start["values"][0] + start["values"][2]
        handoff_target = start["values"][0] + HANDOFF_TIME
        wait_for(
            driver,
            session,
            "!document.querySelector('[data-panel=results]').hidden",
            timeout=4,
        )
        first_visible = browser_state(driver, session)["audit"][
            "firstResultsVisibleAt"
        ]
        if first_visible is None:
            raise AssertionError("MutationObserver did not capture first results visibility")
        if abs(first_visible - handoff_target) > 1.0:
            raise AssertionError(
                "Zero-Renown defeat did not appear at the Twilight handoff: "
                f"visible={first_visible:.3f}s, handoff={handoff_target:.3f}s"
            )
        if first_visible >= scheduled_end - 0.5:
            raise AssertionError("Zero-Renown defeat waited for the natural audio end")
        wait_for(driver, session, "window.__brightvaleFlow.activeSources===0", timeout=3)
        result = browser_state(driver, session)
        result_time = result["audit"]["currentTime"]
        result_blob = "\n".join(result["results"]).lower()
        required = [
            "audience · accuracy",
            f"0 perfect · 0 good · {AUDIENCE_NOTE_COUNT} missed",
            "renown earned",
            "personal strength remaining",
            "twilight strength remaining",
            "twilight · accuracy",
            "no notes",
            "0 perfect · 0 good · 0 missed",
            "whole performance",
        ]
        absent = [text for text in required if text not in result_blob]
        if absent:
            raise AssertionError(f"Zero-Renown defeat panel missing {absent}: {result_blob}")
        if result["resultTitle"] != "Defeat":
            raise AssertionError(f"All-miss result title was not Defeat: {result}")
        if result_strength(result["results"], "Renown earned") != 0:
            raise AssertionError(f"Unexpected Renown in all-miss result: {result['results']}")
        if result_strength(result["results"], "Personal Strength remaining") != 0:
            raise AssertionError(f"Unexpected Personal Strength: {result['results']}")
        if result_strength(result["results"], "Twilight Strength remaining") != int(
            INITIAL_TWILIGHT_STRENGTH
        ):
            raise AssertionError(f"Unexpected Twilight Strength: {result['results']}")
        if result["audit"]["stops"] != 1 or result["audit"]["firstResultsSourceActive"]:
            raise AssertionError(f"Early defeat did not stop its source exactly once: {result['audit']}")
        lower_result = result["resultText"].lower()
        if "a missed note is not surrender." not in lower_result:
            raise AssertionError(
                "Results omitted the message that a missed note is not surrender"
            )
        screenshot(driver, session, "all-miss-results.png")
        click(driver, session, '[data-panel="results"] [data-action="restart"]')
        wait_for(driver, session, "window.__brightvaleFlow.starts.length===2", timeout=10)
        reset_state = browser_state(driver, session)
        reset_source = reset_state["audit"]["starts"][-1]
        if abs(reset_source["values"][1] - SOURCE_START) > 0.001:
            raise AssertionError(f"Restart did not reset source offset to excerpt start: {reset_source}")
        if reset_state["audit"]["maxActiveSources"] > 1:
            raise AssertionError("Restart overlapped its new source with the completed source")
        return {
            "scenario": "all-miss",
            "audioSource": start,
            "twilightMode": mode_state["mode"],
            "resultAudioTime": result_time,
            "firstResultsVisibleAudioTime": first_visible,
            "scheduledAudioEnd": scheduled_end,
            "handoffAudioTime": handoff_target,
            "resultLines": result["results"],
            "sourceAccounting": assert_no_source_overlap(result, "all-miss"),
            "resultRestartResetSource": reset_source,
            "restartMaxActiveSources": reset_state["audit"]["maxActiveSources"],
            "screenshots": [
                str(OUTPUT / name)
                for name in [
                    "all-miss-playing.png",
                    "all-miss-twilight.png",
                    "all-miss-results.png",
                ]
            ],
        }
    finally:
        request(driver, "DELETE", f"/session/{session}", {}, timeout=10)


def strategic_run(driver, url):
    session = create_session(driver, url)
    try:
        click(driver, session, '[data-panel="ready"] [data-action="start"]')
        wait_for(driver, session, "window.__brightvaleFlow.starts.length===1", timeout=45)
        first_start = latest_start(driver, session)
        if first_start["state"] != "running":
            raise AssertionError(f"Strategic source was scheduled while {first_start['state']}")
        hits = []
        balance = balance_from_config()
        expected_renown = 0

        strategic_notes = AUDIENCE_NOTES[:2]
        for index, note in enumerate(strategic_notes):
            note_time = note["relative_time"]
            key = LANE_KEYS[note["lane"]]
            hit = press_at_note(
                driver,
                session,
                latest_start(driver, session),
                note_time,
                key,
                repeat=(index == 0),
            )
            hits.append(hit)
            expected_renown += balance["audience"][hit["quality"]]
            if int(hit["resource"]) != expected_renown:
                raise AssertionError(
                    f"Audience Renown disagrees with displayed shared balance: "
                    f"expected={expected_renown}, hit={hit}"
                )

        # A real WebDriver key sent to a focused input must not reach the lane model.
        before_editable = browser_state(driver, session)["resourceValue"]
        execute(
            driver,
            session,
            "const input=document.createElement('input');input.id='stage5-editable';"
            "document.body.append(input);input.focus()",
        )
        target_start = latest_start(driver, session)
        when, offset = target_start["values"][0], target_start["values"][1]
        editable_note_time = (
            AUDIENCE_NOTES[1]["relative_time"]
            + (AUDIENCE_NOTES[2]["relative_time"] - AUDIENCE_NOTES[1]["relative_time"])
            / 2
        )
        input_target = when + (editable_note_time - (offset - SOURCE_START))
        wait_for_clock(driver, session, input_target - 0.05)
        send_key(driver, session, "d")
        after_editable = browser_state(driver, session)
        if after_editable["resourceValue"] != before_editable:
            raise AssertionError(
                "Editable input key changed game resources: "
                f"before={before_editable} after={after_editable['resourceValue']}"
            )
        execute(
            driver,
            session,
            "document.querySelector('#stage5-editable')?.remove();"
            "document.activeElement?.blur();document.body.tabIndex=-1;document.body.focus()",
        )

        keys_before_escape = len(browser_state(driver, session)["audit"]["keys"])
        pre_pause_source = latest_start(driver, session)
        send_key(driver, session, "\ue00c")
        escape_state = browser_state(driver, session)
        escape_events = escape_state["audit"]["keys"][keys_before_escape:]
        escape_keydown = escape_keydown_event(escape_events)
        wait_for(
            driver,
            session,
            "!document.querySelector('[data-panel=pause]').hidden",
            timeout=5,
        )
        expected_resume_offset = resume_offset_at_keydown(
            pre_pause_source, escape_keydown["time"]
        )
        before_resume_starts = len(browser_state(driver, session)["audit"]["starts"])
        click(driver, session, '[data-panel="pause"] [data-action="resume"]')
        wait_for(
            driver,
            session,
            f"window.__brightvaleFlow.starts.length==={before_resume_starts + 1}",
            timeout=10,
        )
        resumed_after_escape = latest_start(driver, session)
        if abs(resumed_after_escape["values"][1] - expected_resume_offset) > 0.2:
            raise AssertionError(
                "Resume after Escape did not preserve excerpt position: "
                f"expected offset {expected_resume_offset}, got {resumed_after_escape}"
            )
        screenshot(driver, session, "strategic-resumed.png")

        wait_for(
            driver,
            session,
            "window.__brightvaleFlow.context.currentTime >= "
            f"window.__brightvaleFlow.starts[{before_resume_starts}].values[0]",
            timeout=5,
        )
        # Switching to another real browser tab should pause without auto-resume.
        original_handle = request(driver, "GET", f"/session/{session}/window/handles")[0]
        new_handle = request(
            driver,
            "POST",
            f"/session/{session}/window/new",
            {"type": "tab"},
        )["handle"]
        request(
            driver,
            "POST",
            f"/session/{session}/window",
            {"handle": new_handle},
        )
        time.sleep(0.5)
        request(
            driver,
            "POST",
            f"/session/{session}/window",
            {"handle": original_handle},
        )
        wait_for(
            driver,
            session,
            "!document.querySelector('[data-panel=pause]').hidden",
            timeout=5,
        )
        hidden_events = [
            event
            for event in browser_state(driver, session)["audit"]["visibility"]
            if event["state"] == "hidden"
        ]
        if not hidden_events:
            raise AssertionError("Switching browser tabs did not emit a hidden transition")
        hidden_time = hidden_events[-1]["time"]
        hidden_source = latest_start(driver, session)
        expected_hidden_resume_offset = hidden_source["values"][1] + max(
            0, hidden_time - hidden_source["values"][0]
        )
        start_count_before_explicit_resume = len(
            browser_state(driver, session)["audit"]["starts"]
        )
        time.sleep(0.4)
        if len(browser_state(driver, session)["audit"]["starts"]) != start_count_before_explicit_resume:
            raise AssertionError("Audio auto-resumed merely because the tab became visible")
        click(driver, session, '[data-panel="pause"] [data-action="resume"]')
        wait_for(
            driver,
            session,
            "window.__brightvaleFlow.starts.length==="
            f"{start_count_before_explicit_resume + 1}",
            timeout=10,
        )
        resumed_after_hidden = latest_start(driver, session)
        if abs(resumed_after_hidden["values"][1] - expected_hidden_resume_offset) > 0.25:
            raise AssertionError(
                "Explicit resume after hidden-tab pause lost its position: "
                f"expected offset {expected_hidden_resume_offset}, got {resumed_after_hidden}"
            )

        # Lifecycle checks can consume enough wall-clock time to pass combat
        # notes. Restart from the pause/results panel, then run combat against
        # a fresh source with a deterministic chart-relative input plan.
        lifecycle_state = browser_state(driver, session)
        if "results" not in lifecycle_state["panels"] and "pause" not in lifecycle_state["panels"]:
            send_key(driver, session, "\ue00c")
            wait_for(
                driver,
                session,
                "!document.querySelector('[data-panel=pause]').hidden || "
                "!document.querySelector('[data-panel=results]').hidden",
                timeout=5,
            )
            lifecycle_state = browser_state(driver, session)
        restart_panel = (
            "results" if "results" in lifecycle_state["panels"] else "pause"
        )
        starts_before_combat_restart = len(lifecycle_state["audit"]["starts"])
        click(
            driver,
            session,
            f'[data-panel="{restart_panel}"] [data-action="restart"]',
        )
        wait_for(
            driver,
            session,
            "window.__brightvaleFlow.starts.length==="
            f"{starts_before_combat_restart + 1}",
            timeout=10,
        )
        combat_start = latest_start(driver, session)
        if abs(combat_start["values"][1] - SOURCE_START) > 0.001:
            raise AssertionError(f"Combat restart did not reset source offset: {combat_start}")
        if combat_start["state"] != "running":
            raise AssertionError(f"Combat restart source was not scheduled while running: {combat_start}")
        execute(
            driver,
            session,
            "const a=window.__brightvaleFlow;a.firstResultsVisibleAt=null;"
            "a.firstResultsSourceActive=null",
        )
        combat_stop_baseline = browser_state(driver, session)["audit"]["stops"]
        lifecycle_hits = hits
        hits = []
        expected_renown = 0
        combat_audience_notes = AUDIENCE_NOTES
        for note in combat_audience_notes:
            hit = press_at_note(
                driver,
                session,
                combat_start,
                note["relative_time"],
                LANE_KEYS[note["lane"]],
            )
            hits.append(hit)
            expected_renown += balance["audience"][hit["quality"]]
            if int(hit["resource"]) != expected_renown:
                raise AssertionError(
                    f"Fresh combat audience Renown mismatch: "
                    f"expected={expected_renown}, hit={hit}"
                )
        worst_case_twilight_miss_cost = (
            TWILIGHT_NOTE_COUNT * balance["twilight"]["miss"]["personalCost"]
        )
        if expected_renown <= worst_case_twilight_miss_cost:
            raise AssertionError(
                "Fresh combat setup did not build enough Renown to exceed the "
                f"chart's worst-case Twilight miss cost: {expected_renown} <= "
                f"{worst_case_twilight_miss_cost}"
            )

        expected_personal = expected_renown
        expected_twilight = INITIAL_TWILIGHT_STRENGTH
        twilight_hits = []
        for note in TWILIGHT_NOTES:
            hit = press_at_note(
                driver,
                session,
                combat_start,
                note["relative_time"],
                LANE_KEYS[note["lane"]],
            )
            hits.append(hit)
            twilight_hits.append(hit)
            applied = balance["twilight"][hit["quality"]]
            expected_personal = max(0, expected_personal - applied["personalCost"])
            expected_twilight = max(0, expected_twilight - applied["damage"])
            if int(hit["personalStrength"]) != expected_personal:
                raise AssertionError(f"Twilight personal-cost mismatch at note {note}: {hit}")
            if int(hit["twilightStrength"]) != expected_twilight:
                raise AssertionError(f"Twilight damage mismatch at note {note}: {hit}")
            if "results" in hit["panels"]:
                break
        screenshot(driver, session, "strategic-combat-outcome.png")

        active_start = latest_start(driver, session)
        active_when, active_offset, remaining_duration = active_start["values"]
        scheduled_end = active_when + remaining_duration
        final_note_target = (
            active_when + FINAL_NOTE_TIME - (active_offset - SOURCE_START)
        )
        wait_for(
            driver,
            session,
            "!document.querySelector('[data-panel=results]').hidden",
            timeout=85,
        )
        timing_state = browser_state(driver, session)
        first_visible = timing_state["audit"]["firstResultsVisibleAt"]
        if first_visible is None:
            raise AssertionError("MutationObserver did not capture strategic results visibility")
        wait_for(driver, session, "window.__brightvaleFlow.activeSources===0", timeout=3)
        result = browser_state(driver, session)
        lines = result["results"]
        audience_line = next(
            (line for line in lines if line.lower().startswith("audience · accuracy")), ""
        )
        twilight_line = next(
            (line for line in lines if line.lower().startswith("twilight · accuracy")), ""
        )
        audience_counts = re.search(r"(\d+) perfect · (\d+) good · (\d+) missed", audience_line)
        twilight_counts = re.search(r"(\d+) perfect · (\d+) good · (\d+) missed", twilight_line)
        if not all((audience_counts, twilight_counts)):
            raise AssertionError(f"Could not read final accuracy/count lines: {lines}")
        audience_perfect, audience_good, audience_missed = map(
            int, audience_counts.groups()
        )
        twilight_perfect, twilight_good, twilight_missed = map(
            int, twilight_counts.groups()
        )
        audience_hits = audience_perfect + audience_good
        twilight_hit_count = twilight_perfect + twilight_good
        unresolved_twilight_notes = TWILIGHT_NOTE_COUNT - (
            twilight_hit_count + twilight_missed
        )
        if unresolved_twilight_notes < 0:
            raise AssertionError(f"More Twilight notes resolved than the chart contains: {lines}")
        earned = (
            audience_perfect * balance["audience"]["perfect"]
            + audience_good * balance["audience"]["good"]
            + audience_missed * balance["audience"]["miss"]
        )
        expected_personal = max(
            0,
            earned
            - twilight_good * balance["twilight"]["good"]["personalCost"]
            - twilight_missed * balance["twilight"]["miss"]["personalCost"],
        )
        expected_twilight = max(
            0,
            INITIAL_TWILIGHT_STRENGTH
            - twilight_perfect * balance["twilight"]["perfect"]["damage"]
            - twilight_good * balance["twilight"]["good"]["damage"],
        )
        if audience_hits < 2 or twilight_hit_count < 1:
            raise AssertionError(
                f"Strategic inputs did not produce intended hits: audience={audience_hits}, "
                f"twilight={twilight_hit_count}, lines={lines}, inputEvents={hits}"
            )
        if result_strength(lines, "Renown earned") != earned:
            raise AssertionError(f"Renown total mismatch: expected {earned}, lines={lines}")
        if result_strength(lines, "Personal Strength remaining") != expected_personal:
            raise AssertionError(
                f"Personal Strength mismatch: expected {expected_personal}, lines={lines}"
            )
        if result_strength(lines, "Twilight Strength remaining") != expected_twilight:
            raise AssertionError(
                f"Twilight Strength mismatch: expected {expected_twilight}, lines={lines}"
            )
        expected_outcome = (
            "Victory"
            if expected_twilight == 0
            else "Defeat"
            if expected_personal == 0
            else "Survived"
        )
        if result["resultTitle"] != expected_outcome:
            raise AssertionError(
                f"Result outcome {result['resultTitle']!r} disagrees with strengths "
                f"(expected {expected_outcome}): {lines}"
            )
        if expected_outcome == "Victory" and twilight_missed != 0:
            raise AssertionError(
                f"Victory incorrectly counted future Twilight notes as misses: {lines}"
            )
        if (
            TWILIGHT_NOTE_COUNT * balance["twilight"]["perfect"]["damage"]
            >= INITIAL_TWILIGHT_STRENGTH
            and expected_outcome != "Victory"
        ):
            raise AssertionError(
                "Configured chart supports a perfect-hit victory, but the strategic "
                f"browser run did not achieve it: {hits}"
            )
        final_context_time = result["audit"]["currentTime"]
        if result["audit"]["maxActiveSources"] > 1:
            raise AssertionError("Strategic run had overlapping active audio sources")
        if result["audit"]["activeSources"] != 0:
            raise AssertionError("Final excerpt source remained active after results")
        if expected_outcome == "Survived":
            assert_first_results_after_audio_tail(
                "strategic", first_visible, scheduled_end, final_note_target
            )
            combat_source_stops = result["audit"]["stops"] - combat_stop_baseline
            if combat_source_stops != 0:
                raise AssertionError(
                    "Natural survival explicitly stopped its source during combat"
                )
        else:
            if first_visible >= scheduled_end - 0.5:
                raise AssertionError("Combat result waited for natural audio completion")
            combat_source_stops = result["audit"]["stops"] - combat_stop_baseline
            if combat_source_stops != 1:
                raise AssertionError(
                    f"Combat result did not stop its source once: {result['audit']}"
                )
            if result["audit"]["firstResultsSourceActive"]:
                raise AssertionError("Combat results appeared while audio was still active")
        screenshot(driver, session, "strategic-results.png")
        return {
            "scenario": "strategic-hits",
            "timedWebDriverKeys": hits,
            "webdriverRepeatEventObserved": lifecycle_hits[0]["repeatObserved"],
            "editableInputResourceBeforeAfter": [
                before_editable,
                after_editable["resourceValue"],
            ],
            "escapeResumeOffset": {
                "expected": expected_resume_offset,
                "actual": resumed_after_escape["values"][1],
                "escapeKeydownAudioTime": escape_keydown["time"],
            },
            "hiddenTabResumeOffset": {
                "expected": expected_hidden_resume_offset,
                "actual": resumed_after_hidden["values"][1],
            },
            "hiddenEvents": hidden_events,
            "noAutoResumeAfterTabSwitch": True,
            "audienceHits": audience_hits,
            "twilightHits": twilight_hit_count,
            "unresolvedTwilightNotes": unresolved_twilight_notes,
            "earned": earned,
            "personalStrength": expected_personal,
            "twilightStrength": expected_twilight,
            "outcome": expected_outcome,
            "results": lines,
            "audioStartCount": len(result["audit"]["starts"]),
            "intentionalStopCount": result["audit"]["stops"],
            "combatSourceStops": combat_source_stops,
            "maxActiveSources": result["audit"]["maxActiveSources"],
            "finalContextTime": final_context_time,
            "firstResultsVisibleAudioTime": first_visible,
            "scheduledExcerptEnd": scheduled_end,
            "screenshots": [
                str(OUTPUT / name)
                for name in [
                    "strategic-resumed.png",
                    "strategic-combat-outcome.png",
                    "strategic-results.png",
                ]
            ],
        }
    finally:
        request(driver, "DELETE", f"/session/{session}", {}, timeout=10)


def run(url, scenario="both"):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    chromedriver = subprocess.Popen(
        ["/usr/bin/chromedriver", f"--port={port}", "--allowed-ips="],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    driver = f"http://127.0.0.1:{port}"
    try:
        for _ in range(120):
            if chromedriver.poll() is not None:
                raise RuntimeError("chromedriver exited before becoming ready")
            try:
                request(driver, "GET", "/status", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise TimeoutError("chromedriver did not become ready")
        results = {}
        if scenario in ("both", "all-miss"):
            results["allMiss"] = all_miss_run(driver, url)
        if scenario in ("both", "strategic"):
            results["strategic"] = strategic_run(driver, url)
        results["screenshotsDirectory"] = str(OUTPUT)
        results["clock"] = "native AudioContext.currentTime; normal requestAnimationFrame"
        results["input"] = "WebDriver keyboard actions; synthetic clock/audio not used"
        return results
    finally:
        stop_owned_driver(chromedriver, port)


def stop_owned_driver(process, port):
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        with socket.socket() as sock:
            sock.settimeout(0.1)
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return
        time.sleep(0.05)
    raise RuntimeError(f"Owned chromedriver listener on port {port} remained open")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="running dev-server URL")
    parser.add_argument(
        "--scenario", choices=("both", "all-miss", "strategic"), default="both"
    )
    args = parser.parse_args()
    try:
        results = run(args.url, args.scenario)
    except Exception as error:
        print(f"browser flow failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(results, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
