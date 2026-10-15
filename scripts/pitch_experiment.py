"""Isolated, deterministic pitch-informed lane experiment (not production code)."""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import json
import math
import os
import statistics
import subprocess
import tempfile
import time
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/music/The Rising Star (Remastered).mp3"
CHART = ROOT / "data/charts/generated/the-rising-star.charts.json"
EVIDENCE = ROOT / ".lore/local/evidence/music-lane-experiment"
SAMPLE_RATE, BUFFER, HOP = 22050, 2048, 256
WINDOW_BEFORE, WINDOW_AFTER = 0.030, 0.150
BLOCK_NOTES, BEAM_WIDTH = 32, 64
PARAMS = {"sampleRate": SAMPLE_RATE, "buffer": BUFFER, "hop": HOP,
          "pitchWindowSeconds": [WINDOW_BEFORE, WINDOW_AFTER], "blockNotes": BLOCK_NOTES,
          "beamWidth": BEAM_WIDTH, "stableCoverageMin": 0.5, "stableMadMaxMidi": 2.5,
          "lanePreferenceWeight": 0.15, "contourWeight": 0.8,
          "runOverThreeCost": 0.55, "largeJumpCost": 0.35, "imbalanceWeight": 0.08,
          "balanceWeight": 0.03}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def run_logged(command, timeout=1800, attempt_log=None, attempt_log_path=None):
    start = time.monotonic()
    attempt = {"command": command, "status": "attempted", "startedMonotonic": start,
               "evidencePath":str(attempt_log_path) if attempt_log_path else None}
    if attempt_log is not None:
        attempt_log.append(attempt)
        _persist_attempts(attempt_log)
    try:
        p = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        outcome = {"command": command, "status": "succeeded" if p.returncode == 0 else "failed", "returnCode": p.returncode, "elapsedSeconds": round(time.monotonic()-start, 3),
                   "stdout": p.stdout[-2000:], "stderr": p.stderr[-2000:]}
        if attempt_log is not None:
            attempt_log[-1].update(outcome); _persist_attempts(attempt_log)
        if p.returncode:
            raise RuntimeError(f"Command failed ({p.returncode}): {' '.join(command)}\n{p.stderr[-1000:]}")
        return p.stdout, outcome
    except subprocess.TimeoutExpired as exc:
        if attempt_log is not None:
            attempt_log[-1].update({"status":"timed_out", "elapsedSeconds":round(time.monotonic()-start,3), "timeoutSeconds":timeout})
            _persist_attempts(attempt_log)
        raise RuntimeError(f"Command timed out after {timeout}s: {' '.join(command)}") from exc
    except OSError as exc:
        if attempt_log is not None:
            attempt_log[-1].update({"status":"failed_to_start", "elapsedSeconds":round(time.monotonic()-start,3), "error":str(exc)})
            _persist_attempts(attempt_log)
        raise


def _persist_attempts(attempts):
    if not attempts:
        return
    path = Path(next(item["evidencePath"] for item in attempts if item.get("evidencePath")))
    serializable = [{k:v for k,v in item.items() if k != "evidencePath" and k != "startedMonotonic"} for item in attempts]
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(serializable, indent=2)+"\n")
    temp.replace(path)


def temporary_audio_directory():
    return tempfile.TemporaryDirectory(prefix="pitch-lane-", dir="/tmp/opencode")


def candidate_with_lanes(data, lanes):
    candidate = copy.deepcopy(data)
    for note, lane in zip(candidate["charts"]["normal"]["notes"], lanes):
        note["lane"] = lane
    return candidate


def pitch_records(rows, note_time, source_start):
    """Summarize valid positive MIDI samples inside onset+offset-relative window."""
    begin, end = note_time + source_start + WINDOW_BEFORE, note_time + source_start + WINDOW_AFTER
    values = [float(p) for t, p in rows if begin <= float(t) <= end and _valid_pitch(p)]
    return summarize_pitch(values)


def _valid_pitch(value):
    try:
        v = float(value)
        return math.isfinite(v) and v > 0
    except (TypeError, ValueError):
        return False


def summarize_pitch(values):
    vals = sorted(float(x) for x in values if _valid_pitch(x))
    if not vals:
        return {"pitch": None, "coverage": 0.0, "mad": None, "stable": False}
    med = statistics.median(vals)
    mad = statistics.median(abs(x-med) for x in vals)
    coverage = min(1.0, len(vals) / max(1, math.ceil((WINDOW_AFTER-WINDOW_BEFORE)*SAMPLE_RATE/HOP)))
    return {"pitch": med, "coverage": coverage, "mad": mad,
            "stable": coverage >= PARAMS["stableCoverageMin"] and mad <= PARAMS["stableMadMaxMidi"]}


def preferred_lanes(records):
    """Within each bounded heuristic block, map pitch quartiles to lanes."""
    preferred = [None] * len(records)
    for start in range(0, len(records), BLOCK_NOTES):
        indices = [i for i in range(start, min(start+BLOCK_NOTES, len(records))) if records[i]["stable"]]
        pitches = sorted(records[i]["pitch"] for i in indices)
        if not pitches:
            continue
        for i in indices:
            p = records[i]["pitch"]
            preferred[i] = min(3, sum(p > pitches[min(len(pitches)-1, math.floor(q*len(pitches)))] for q in (.25,.5,.75)))
    return preferred


def map_lanes(records, baseline_lanes):
    """Width-bounded beam traverses the whole chart; ties prefer lane tuple."""
    prefs = preferred_lanes(records)
    # state=(cost, path, counts, previous lane, run)
    states = [(0.0, (), (0,0,0,0), None, 0)]
    for i, record in enumerate(records):
        candidates = []
        pitch = record["pitch"] if record["stable"] else None
        for cost, path, counts, prev_lane, run in states:
            for lane in range(4):
                c = cost
                if pitch is not None and prefs[i] is not None:
                    c += PARAMS["lanePreferenceWeight"] * abs(lane-prefs[i])
                elif pitch is None:
                    c += 0.015 * abs(lane-baseline_lanes[i])
                # Only immediately adjacent stable records are paired: unknown notes
                # break contour comparisons rather than bridging pitch over a gap.
                prior_record_pitch = records[i-1]["pitch"] if i > 0 and records[i-1]["stable"] else None
                if pitch is not None and prior_record_pitch is not None and abs(pitch-prior_record_pitch) > 0.25:
                    direction = 1 if pitch > prior_record_pitch else -1
                    lane_dir = 1 if prev_lane is not None and lane > prev_lane else (-1 if prev_lane is not None and lane < prev_lane else 0)
                    if lane_dir and lane_dir != direction:
                        c += PARAMS["contourWeight"]
                nr = run+1 if prev_lane == lane else 1
                if nr > 3: c += PARAMS["runOverThreeCost"]
                if prev_lane is not None and abs(lane-prev_lane) == 3: c += PARAMS["largeJumpCost"]
                nc = list(counts); nc[lane] += 1
                total = i+1
                c += PARAMS["imbalanceWeight"] * sum((x/total - 0.25)**2 for x in nc)
                # Soft marginal balancing: underrepresented lanes are less costly;
                # no hard cap or exact 25% requirement is imposed.
                c += PARAMS["balanceWeight"] * (sum(x*x for x in nc) - sum(x*x for x in counts))
                candidates.append((c, path+(lane,), tuple(nc), lane, nr))
        candidates.sort(key=lambda s: (round(s[0], 12), s[1]))
        states = candidates[:BEAM_WIDTH]
    return list(min(states, key=lambda s: (round(s[0], 12), s[1]))[1]), prefs


def _run_metrics(lanes):
    longest = 0; current = 0; previous = None
    for lane in lanes:
        current = current+1 if lane == previous else 1
        longest = max(longest, current); previous = lane
    return longest


def eligible_contour_pairs(records):
    return [(i, i+1) for i in range(len(records)-1)
            if records[i]["stable"] and records[i+1]["stable"]
            and abs(records[i+1]["pitch"]-records[i]["pitch"]) > 0.25]


def worst_rolling32_concentration(lanes):
    """All complete overlapping 32-note windows; no complete window => None."""
    if len(lanes) < 32:
        return None
    return max(max(lanes[start:start+32].count(lane) for lane in range(4))/32
               for start in range(len(lanes)-31))


def metrics(baseline, candidate, records):
    def counts(xs): return [xs.count(i) for i in range(4)]
    stable_pairs = eligible_contour_pairs(records)
    def agreement(lanes):
        n = len(stable_pairs)
        return sum((lanes[j]-lanes[i])*(records[j]["pitch"]-records[i]["pitch"]) > 0 for i,j in stable_pairs)/n if n else None
    jumps = [abs(records[j]["pitch"]-records[i]["pitch"]) for i,j in stable_pairs]
    return {"noteCount":len(baseline), "baselineLaneCounts":counts(baseline), "candidateLaneCounts":counts(candidate),
            "baselineLaneShares":[x/len(baseline) for x in counts(baseline)],
            "candidateLaneShares":[x/len(candidate) for x in counts(candidate)],
            "baselineLongestLaneRun":_run_metrics(baseline), "candidateLongestLaneRun":_run_metrics(candidate),
            "baselineHandCounts":[sum(x for i,x in enumerate(counts(baseline)) if i<2),sum(x for i,x in enumerate(counts(baseline)) if i>=2)],
            "candidateHandCounts":[sum(x for i,x in enumerate(counts(candidate)) if i<2),sum(x for i,x in enumerate(counts(candidate)) if i>=2)],
            "baselineWorstRolling32Concentration":worst_rolling32_concentration(baseline), "candidateWorstRolling32Concentration":worst_rolling32_concentration(candidate),
            "rolling32Definition":"maximum lane share over every complete sliding window of 32 notes; no complete windows => null; trailing partial windows excluded",
            "stableUnequalPitchAdjacentPairs":len(stable_pairs), "baselineExtractedF0DirectionAgreement":agreement(baseline),
            "candidateExtractedF0DirectionAgreement":agreement(candidate),
            "adjacentStableF0JumpCountOver12Midi":sum(x > 12 for x in jumps), "maxAdjacentStableF0JumpMidi":max(jumps,default=None),
            "unknownPitchCount":sum(not r["stable"] for r in records), "stablePitchCount":sum(r["stable"] for r in records),
            "stablePitchCoverage":sum(r["stable"] for r in records)/len(records) if records else 0}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=SOURCE); parser.add_argument("--chart", type=Path, default=CHART)
    parser.add_argument("--evidence", type=Path, default=EVIDENCE); args=parser.parse_args()
    started=time.monotonic(); args.evidence.mkdir(parents=True, exist_ok=True)
    source_hash, chart_hash = sha256(args.source), sha256(args.chart)
    data=json.loads(args.chart.read_text()); normal=data["charts"]["normal"]
    notes=normal["notes"]; source_start=float(normal["sourceStart"])
    if not notes: raise RuntimeError("Normal chart has no notes")
    logs=[]
    attempt_log=args.evidence/"subprocess-attempts.json"
    attempts=[]
    with temporary_audio_directory() as td:
        wav=Path(td)/"audio.wav"
        _,log=run_logged(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y","-i",str(args.source),"-map","0:a:0","-ac","1","-ar",str(SAMPLE_RATE),"-f","wav",str(wav)], attempt_log=attempts, attempt_log_path=attempt_log)
        logs.append(log)
        pitch_stdout,log=run_logged(["aubiopitch","-i",str(wav),"-r",str(SAMPLE_RATE),"-B",str(BUFFER),"-H",str(HOP),"-p","yinfft","-u","midi","-T","seconds","-s","-90"], attempt_log=attempts, attempt_log_path=attempt_log)
        logs.append(log)
        # Retain compact values; aubio emits time and pitch separated by whitespace.
        rows=[]
        for line in pitch_stdout.splitlines():
            bits=line.split()
            if len(bits)>=2:
                try: rows.append((float(bits[0]),float(bits[1])))
                except ValueError: pass
        if not rows: raise RuntimeError("aubiopitch produced no parseable samples")
    records=[pitch_records(rows,float(n["time"]),source_start) for n in notes]
    baseline=[int(n["lane"]) for n in notes]
    candidate,prefs=map_lanes(records,baseline)
    output=candidate_with_lanes(data,candidate)
    out_chart=args.evidence/"the-rising-star.pitch-candidate.charts.json"
    out_chart.write_text(json.dumps(output,indent=2)+"\n")
    # Version/flag commands are bounded and recorded separately from analysis.
    ffmpeg_version, version_log = run_logged(["ffmpeg", "-version"], timeout=30, attempt_log=attempts, attempt_log_path=attempt_log)
    aubio_help, aubio_log = run_logged(["aubiopitch", "-h"], timeout=30, attempt_log=attempts, attempt_log_path=attempt_log)
    aubio_executable=Path(shutil.which("aubiopitch") or "aubiopitch")
    with (args.evidence/"timeline.csv").open("w",newline="") as f:
        w=csv.writer(f); w.writerow(["timestamp","baseline_lane","candidate_lane","pitch_midi","coverage","mad_midi","stable","preferred_lane"])
        for n,l,r,p in zip(notes,candidate,records,prefs): w.writerow([n["time"],n["lane"],l,r["pitch"],r["coverage"],r["mad"],r["stable"],p])
    rerun,_=map_lanes(records,baseline)
    evidence={"task":"shining-stars-3hj isolated research experiment", "source":{"path":str(args.source.relative_to(ROOT)),"sha256":source_hash},
              "chart":{"path":str(args.chart.relative_to(ROOT)),"sha256":chart_hash,"duration":normal["duration"],"sourceStart":source_start},
              "parameters":PARAMS,"commands":logs+[{"versionCheck":version_log},{"cliCheck":aubio_log}],
              "toolVersions":{"ffmpeg":ffmpeg_version.splitlines()[0], "aubiopitchVersion":"not exposed by CLI; executable SHA-256 is identity", "aubiopitchExecutable":str(aubio_executable), "aubiopitchExecutableSha256":sha256(aubio_executable)},
              "metrics":metrics(baseline,candidate,records),"mappingDeterministicRerun":candidate==rerun,
              "determinismScope":"lane mapping rerun on the same extracted pitch records; audio extraction was not repeated",
              "subprocessAttemptsFile":str(attempt_log.relative_to(ROOT)),
              "candidateChartSha256":sha256(out_chart),
              "elapsedSeconds":round(time.monotonic()-started,3), "temporaryDirectoryCleaned":not Path(td).exists(),
              "limitations":["Single full-mix YINFFT F0 is not validated melody.","32-note blocks are heuristic segments, not detected phrases or key changes.","No motif recognition, listening, or playtest."]}
    (args.evidence/"metrics.json").write_text(json.dumps(evidence,indent=2)+"\n")
    print(json.dumps(evidence["metrics"],indent=2)); print(f"evidence: {args.evidence}")

if __name__=="__main__": main()
