#!/usr/bin/env python3
"""Browser-level lifecycle regressions; requires a running Vite URL and Chromium."""

import argparse
import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request


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
    value = json.loads(raw) if raw else {}
    return value.get("value")


def execute(base, session_id, script, args=None):
    return request(
        base,
        "POST",
        f"/session/{session_id}/execute/sync",
        {"script": script, "args": args or []},
    )


def wait_for(base, session_id, script, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if execute(base, session_id, f"return Boolean({script})"):
            return
        time.sleep(0.1)
    try:
        state = execute(
            base,
            session_id,
            "return ({title:document.title,panels:"
            "[...document.querySelectorAll('[data-panel]')].map(p=>"
            "({name:p.dataset.panel,hidden:p.hidden})),busy:"
            "document.querySelector('[data-busy]')?.textContent,error:"
            "document.querySelector('[data-audio-error]')?.textContent,audit:"
            "window.__brightvaleLifecycle})",
        )
    except Exception as error:
        state = {"diagnostic_error": str(error)}
    raise TimeoutError(
        f"Timed out waiting for browser condition: {script}; state={state}"
    )


def click(base, session_id, selector):
    element = request(
        base,
        "POST",
        f"/session/{session_id}/element",
        {"using": "css selector", "value": selector},
    )["element-6066-11e4-a52e-4f735466cecf"]
    request(base, "POST", f"/session/{session_id}/element/{element}/click", {})


def app03_recovery_ready_script():
    return (
        "(()=>{"
        "const a=window.__brightvaleLifecycle;"
        "const pending=document.querySelector('[data-pending-status]');"
        "const buttons=[...document.querySelectorAll('[data-action]')];"
        "for(const b of buttons)b.removeAttribute('data-app03-recovery-target');"
        "const action=buttons.find(b=>['start','resume'].includes(b.dataset.action)&&"
        "!b.disabled&&!b.closest('[hidden]')&&"
        "getComputedStyle(b).display!=='none'&&"
        "getComputedStyle(b).visibility!=='hidden'&&b.getClientRects().length>0);"
        "if(action)action.setAttribute('data-app03-recovery-target','true');"
        "return a.fetches.length>0&&a.fetchDone.length>=a.fetches.length&&"
        "pending&&pending.hidden&&"
        "document.querySelector('.play-surface')?.getAttribute('aria-busy')!=='true'&&"
        "Boolean(action)"
        "})()"
    )


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


def create_session(base, page_url, suppress_raf=True):
    caps = {
        "capabilities": {
            "alwaysMatch": {
                "browserName": "chrome",
                "goog:chromeOptions": {
                    "binary": "/usr/bin/chromium",
                    "args": [
                        "--headless=new",
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--window-size=1440,1000",
                    ],
                },
            }
        }
    }
    session_id = request(base, "POST", "/session", caps, timeout=45)["sessionId"]
    request(
        base,
        "POST",
        f"/session/{session_id}/timeouts",
        {"script": 10000, "pageLoad": 60000, "implicit": 0},
    )
    raf_mode = (
        "window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{};"
        if suppress_raf
        else ""
    )
    instrumentation = r"""(()=>{
      const audit={fetches:[],fetchDone:[],delayNextMp3:0,failNextSourceCreate:0,
        sourceFactoryAttempts:0,starts:[],console:[]};
      window.__brightvaleLifecycle=audit;
      // The default mode isolates these checks from APP01; --normal-raf leaves
      // the application's animation loop active for real-browser validation.
      /*RAF_MODE*/
      for(const name of ['log','info','warn','error']){
        const original=console[name].bind(console);
        console[name]=(...args)=>{audit.console.push({name,args:args.map(x=>{
          try{return typeof x==='string'?x:JSON.parse(JSON.stringify(x))}
          catch{return String(x)}
        })});return original(...args)};
      }
      const originalFetch=window.fetch.bind(window);
      window.fetch=(input,...args)=>{
        const url=typeof input==='string'?input:(input&&input.url)||String(input);
        if(!url.includes('.mp3'))return originalFetch(input,...args);
        audit.fetches.push(url);
        const delay=audit.delayNextMp3;
        audit.delayNextMp3=0;
        return new Promise((resolve,reject)=>setTimeout(()=>{
          originalFetch(input,...args).then(response=>{
            audit.fetchDone.push(url);resolve(response)
          },reject)
        },delay));
      };
      const NativeContext=window.AudioContext;
      window.AudioContext=class extends NativeContext{
        createBufferSource(){
          audit.sourceFactoryAttempts++;
          if(audit.failNextSourceCreate>0){
            audit.failNextSourceCreate--;
            throw new Error('synthetic createBufferSource failure');
          }
          const source=super.createBufferSource(),start=source.start.bind(source);
          source.start=(...values)=>{
            audit.starts.push({values,contextTime:this.currentTime,state:this.state});
            return start(...values);
          };
          return source;
        }
      };
    })();""".replace("/*RAF_MODE*/", raf_mode)
    request(
        base,
        "POST",
        f"/session/{session_id}/goog/cdp/execute",
        {
            "cmd": "Page.addScriptToEvaluateOnNewDocument",
            "params": {"source": instrumentation},
        },
    )
    request(base, "POST", f"/session/{session_id}/url", {"url": page_url}, timeout=70)
    wait_for(base, session_id, "document.readyState==='complete'", timeout=30)
    wait_for(
        base,
        session_id,
        "document.querySelector('[data-panel=ready]') && "
        "!document.querySelector('[data-panel=ready]').hidden",
    )
    return session_id


def structured_log_events(audit):
    events = []
    for entry in audit.get("console", []):
        for value in entry.get("args", []):
            if isinstance(value, dict):
                candidate = value
            elif isinstance(value, str):
                try:
                    candidate = json.loads(value)
                except (TypeError, json.JSONDecodeError):
                    continue
            else:
                continue
            if isinstance(candidate, dict) and "operation" in candidate:
                events.append(candidate)
    return events


def browser_checks(url, suppress_raf=True):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    driver_process = subprocess.Popen(
        ["/usr/bin/chromedriver", f"--port={port}", "--allowed-ips="],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    driver = f"http://127.0.0.1:{port}"
    sessions = []
    results = {}
    failures = []

    try:
        for _ in range(120):
            if driver_process.poll() is not None:
                raise RuntimeError("chromedriver exited before becoming ready")
            try:
                request(driver, "GET", "/status", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise TimeoutError("chromedriver did not become ready")

        # First user click must schedule normally with the browser's actual RAF loop.
        retry_session = create_session(driver, url, suppress_raf)
        sessions.append(retry_session)
        click(driver, retry_session, '[data-panel="ready"] [data-action="start"]')
        wait_for(
            driver,
            retry_session,
            "window.__brightvaleLifecycle.starts.length>0",
            timeout=45,
        )
        first_click = execute(
            driver,
            retry_session,
            "return ({starts:window.__brightvaleLifecycle.starts,"
            "attempts:window.__brightvaleLifecycle.sourceFactoryAttempts})",
        )
        results["normal_first_click_scheduled"] = bool(first_click["starts"])

        # APP02: cached audio plus one source-factory failure must remain retryable.
        escape_was_handled = execute(
            driver,
            retry_session,
            "const event=new KeyboardEvent('keydown',{code:'Escape',key:'Escape',bubbles:true,cancelable:true});"
            "window.dispatchEvent(event);return event.defaultPrevented",
        )
        results["escape_pause_prevented_default"] = bool(escape_was_handled)
        wait_for(
            driver,
            retry_session,
            "!document.querySelector('[data-panel=pause]').hidden",
        )
        execute(driver, retry_session, "window.__brightvaleLifecycle.failNextSourceCreate=1")
        click(driver, retry_session, '[data-panel="pause"] [data-action="resume"]')
        wait_for(
            driver,
            retry_session,
            "!document.querySelector('[data-panel=error]').hidden",
            timeout=90,
        )
        first_error = execute(
            driver,
            retry_session,
            "return ({audit:window.__brightvaleLifecycle, message:"
            "document.querySelector('[data-audio-error]').textContent})",
        )
        click(driver, retry_session, '[data-panel="error"] [data-action="start"]')
        time.sleep(5)
        retry_state = execute(
            driver,
            retry_session,
            "return ({audit:window.__brightvaleLifecycle, errorHidden:"
            "document.querySelector('[data-panel=error]').hidden})",
        )
        retried = retry_state["audit"]["sourceFactoryAttempts"] > first_error["audit"]["sourceFactoryAttempts"]
        results["APP02_retry_source_attempted"] = retried
        if not retried:
            failures.append("APP02 Retry did not attempt a new audio source")

        # APP04: require structured attempt/outcome records across real service boundaries.
        events = structured_log_events(retry_state["audit"])
        required = {"fetch", "decode", "context-resume", "source-schedule"}
        logging_evidence = {
            operation: {
                outcome: any(
                    event.get("operation") == operation
                    and event.get("outcome") == outcome
                    for event in events
                )
                for outcome in ("attempt", "success")
            }
            for operation in sorted(required)
        }
        logging_evidence["state-transition"] = any(
            event.get("operation") == "state-transition" for event in events
        )
        logging_ok = all(
            all(outcomes.values()) if isinstance(outcomes, dict) else outcomes
            for outcomes in logging_evidence.values()
        )
        results["APP04_structured_log_evidence"] = logging_evidence
        if not logging_ok:
            failures.append("APP04 missing structured boundary/state-transition logs")

        # APP03: blur while the selected recording fetch is deliberately held open.
        leave_session = create_session(driver, url, suppress_raf)
        sessions.append(leave_session)
        execute(driver, leave_session, "window.__brightvaleLifecycle.delayNextMp3=2500")
        click(driver, leave_session, '[data-panel="ready"] [data-action="start"]')
        wait_for(
            driver,
            leave_session,
            "window.__brightvaleLifecycle.fetches.length>0",
            timeout=10,
        )
        execute(
            driver,
            leave_session,
            "window.dispatchEvent(new Event('blur'));"
            "try{Object.defineProperty(document,'visibilityState',"
            "{configurable:true,value:'hidden'})}catch{}"
            "document.dispatchEvent(new Event('visibilitychange'))",
        )
        wait_for(
            driver,
            leave_session,
            "window.__brightvaleLifecycle.fetchDone.length>0",
            timeout=90,
        )
        wait_for(
            driver,
            leave_session,
            app03_recovery_ready_script(),
            timeout=90,
        )
        leave_state = execute(
            driver,
            leave_session,
            "const action=document.querySelector('[data-app03-recovery-target=true]');"
            "return ({audit:window.__brightvaleLifecycle,recoveryAction:action?{"
            "name:action.dataset.action,enabled:!action.disabled,visible:"
            "!action.closest('[hidden]')&&getComputedStyle(action).display!=='none'&&"
            "getComputedStyle(action).visibility!=='hidden'&&"
            "action.getClientRects().length>0}:null,"
            "panels:[...document.querySelectorAll('[data-panel]')].filter(p=>"
            "!p.hidden).map(p=>p.dataset.panel)})",
        )
        no_source_on_leave = len(leave_state["audit"]["starts"]) == 0
        results["APP03_no_source_after_blur_during_load"] = no_source_on_leave
        recovery_action = leave_state["recoveryAction"]
        results["APP03_visible_recovery_action"] = recovery_action
        if not no_source_on_leave:
            failures.append("APP03 scheduled audio after blur during the pending fetch")
        action_is_eligible = bool(
            recovery_action
            and recovery_action["enabled"]
            and recovery_action["visible"]
            and recovery_action["name"] in ("start", "resume")
        )
        if not action_is_eligible:
            failures.append("APP03 had no visible explicit start/resume recovery action")

        # Click the exact recovery node that satisfied the wait predicate.
        if action_is_eligible:
            click(driver, leave_session, '[data-app03-recovery-target="true"]')
            wait_for(
                driver,
                leave_session,
                "window.__brightvaleLifecycle.starts.length>0",
                timeout=30,
            )
            results["APP03_explicit_recovery_scheduled"] = True
        else:
            results["APP03_explicit_recovery_scheduled"] = False

        print(json.dumps(results, indent=2, sort_keys=True))
        return failures
    finally:
        for session_id in sessions:
            try:
                request(driver, "DELETE", f"/session/{session_id}", {}, timeout=10)
            except Exception:
                pass
        stop_owned_driver(driver_process, port)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "url",
        help="running app URL, e.g. http://127.0.0.1:5173/",
    )
    parser.add_argument(
        "--normal-raf",
        action="store_true",
        help="run browser lifecycle checks with the real animation-frame loop",
    )
    args = parser.parse_args()
    try:
        failures = browser_checks(args.url, suppress_raf=not args.normal_raf)
    except Exception as error:
        print(f"browser lifecycle harness error: {error}", file=sys.stderr)
        return 2
    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
