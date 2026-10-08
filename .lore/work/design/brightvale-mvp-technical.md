---
title: "Brightvale MVP technical design"
date: 2026-10-07
status: draft
tags: [technical-design, brightvale, rhythm-game, audio, threejs]
modules: [chart, audio, game, main, scene, ui]
related: [.lore/work/intents/brightvale-threejs-mvp.md, .lore/work/design/brightvale-mvp-experience.md]
---

# Brightvale MVP technical design

This draft translates the current Brightvale slice and timing advice into implementation contracts. It is not implementation evidence or final musical approval. The experience design is being reconciled separately; this document does not replace or edit it.

## Runtime and ownership

Use Vite, TypeScript, Three.js, native DOM and Web Audio, and Vitest for deterministic tests. Do not add React, a backend, or another application framework. One application owner coordinates lifecycle, game state, the sole `requestAnimationFrame` loop, and disposal. Modules have these responsibilities:

- `chart`: typed hand-authored chart data and validation.
- `audio`: loading/decode, Web Audio transport, and audio lifecycle.
- `game`: deterministic event advancement, judgments, phases, and resource rules.
- `main`: application ownership, dependency wiring, lifecycle, input registration, and disposal.
- `scene`: Three.js scene setup/update/disposal; it does not own a second animation loop.
- `ui`: native DOM state, instructions, controls, feedback, and results.

Keep state transitions explicit and testable outside rendering. The animation loop reads current state, advances due logical events, then updates presentation; it is not the authority for elapsed song time.

## Excerpt and chart contract

Import only `data/music/The First Shining Star (Remastered).mp3` through Vite as an asset URL (`?url`). Do not move, transcode, rewrite, or copy the original into a broad public music directory. Analyze the selected excerpt from source offset **107.1 s**, duration **65.8 s**, with provisional Twilight transition at excerpt-relative **39.2 s** (source time 146.3 s). These are machine-analysis candidates and remain provisional until human listening confirms the cut and final chart. Do not treat analyzer verse/chorus labels or confidence values as verified musical facts.

Use a static, hand-authored, typed chart. Note times are seconds relative to excerpt start; each note has a unique ID, time, and lane `0..3` mapped to `D`, `F`, `J`, `K`. This slice authors no chords or holds. Validate unique IDs, finite in-range times, valid lanes, and chart timing constraints before play. Keep chart fixtures synthetic and independent of the MP3 so model tests do not require decoding or listening.

Use Perfect at absolute error `<= 0.075 s` and Good at absolute error `<= 0.150 s`; both count as successful hits. Apply input offset exactly once: a positive input offset means later physical presses are accepted, so `judgmentTime = transportTime - inputOffset`. Thus the inclusive hit interval for note time `t` is `t - 0.150 + inputOffset` through `t + 0.150 + inputOffset`; a note becomes a miss only when `transportTime > t + 0.150 + inputOffset`. At exact deadline it is still eligible for input. Visual positioning uses `visualTime = transportTime + visualOffset`. Both offsets default to zero, support `+/-200 ms`, and are frozen for the run. Do not subtract input latency anywhere else. Sample `AudioContext.currentTime` in the key handler rather than using `event.timestamp`.

For a press, choose the nearest eligible unresolved note in the same lane; ties go to the earlier note. One keydown resolves at most one note. Ignore key-repeat and duplicate held-key keydowns; clear held-key state on pause. Advance logical events in timestamp order before processing input or rendering. For each advance, order miss deadlines and phase/end events by their timestamps; a miss is due only strictly after its deadline, while a phase or excerpt-end event is due when `eventTime <= transportTime`. This keeps a just-reached hit deadline eligible and prevents a future-offset miss from resolving early. Determine phase and resource transfer from transport time, never calibrated judgment time or visual time.

Validate every note's full timing envelope across all supported input offsets `[-0.200, +0.200]`: earliest `note.time - 0.350`, latest `note.time + 0.350`, inclusive for hit eligibility. Require earliest `>= 0`; for an audience note require latest `< twilightAt - 0.5`; for a Twilight note require earliest `> twilightAt + 0.5`; require the final note's latest `<= excerptDuration - 0.5`. These strict/inclusive bounds leave no note envelope touching or crossing either mode-exclusion endpoint. The chart validator and tests must enforce these rules for the entire supported offset range, not merely at offset zero or at note centers.

## Audio transport and lifecycle

Fetch and decode the selected asset once; validate decoded duration against the requested source interval. The excerpt is played from the decoded buffer without altering the original. `AudioContext.currentTime` is authoritative. A new start or resume creates a fresh, single-use `AudioBufferSourceNode`, scheduled at `scheduledWhen`, with offset `sourceStart + savedPosition` and duration `excerptDuration - savedPosition`.

Starting and resuming use a two-second countdown. Keep saved position `p` unchanged and judgments disabled until the scheduled audio start. Once running, compute `transportTime = p + (AudioContext.currentTime - scheduledWhen)`. Pause samples that position (or retains `p` if the scheduled start has not occurred), advances logical events through the sample, stops and disconnects the source, clears held keys, and preserves model state. Resume schedules a fresh source; never reuse a stopped source.

Lifecycle states are `loading`, `ready`, `starting`, `playing`, `paused`, `results`, and recoverable `error`. Audience and Twilight are a separate phase value, not lifecycle states. A deliberate user gesture calls and awaits `AudioContext.resume()`; continue only when the context is running. Pause and cancel a pending countdown on explicit pause, blur, or hidden document; do not auto-resume. Unexpected context suspension enters paused/recovery behavior. End the run at excerpt duration, not at the final note. Catch up logical events to excerpt end, freeze results, and prevent later events from changing them. An unexpected early source end is a recoverable error. Restart resets chart/model/position and starts a new run generation.

Use a monotonically increasing **playback-request epoch**, separate from the run/model generation. Increment it before pause, blur/hidden interruption, restart, disposal, and every cancellation or replacement start. A start/resume captures its epoch before awaiting `AudioContext.resume()`; after the await, schedule nothing unless the epoch is still current, the desired state is still `starting`, the app is not disposed, and the context is running. Pause therefore cancels a pending resume even if no source or countdown exists yet. Unexpected interruption uses the same cancellation path.

Give each source an identity and active-source record. Before an intentional stop, mark that record intentional and detach it as active. An `onended` callback is ignored if the source was intentional, is not the current active source, or its request/run is stale. Only the current active, nonintentional source ending at its scheduled excerpt end is expected completion; an earlier end is a recoverable error. This identity check also prevents an older source in the same run from interrupting a resumed source. Keep the run generation for model reset, but do not use it as the only async/audio guard. Dispose sources, context, event listeners, and Three.js/GPU resources.

## Game rules and observable state

Audience hits (Good or Perfect) each attempt to add `2` Resonance, capped at `100`; misses add or remove nothing. **Resonance earned** is the sum actually added to the capped balance (`min(2, 100 - balanceBefore)` per audience hit). Capped overflow is ignored: it is neither earned nor later counted as discarded. At the Twilight boundary, exactly once, `spent = min(balance, 40)` and `discarded = balance - spent`; transfer `spent * 2` into City Answer, then reset Resonance to zero. At results, `earned = spent + discarded`. For example, 60 audience hits can yield `earned=100`, `spent=40`, `discarded=60`; the 20 points above the cap are ignored, not earned or discarded. Twilight hits each add `2` City Answer, capped at `100`; misses do not deduct it. City Answer is a contribution meter, not a spendable resource. A zero-resource or all-miss run still completes; misses never mean surrender or cause the player to surrender.

Store Perfect, Good, and Miss counts for audience, Twilight, and the whole run. For each mode and whole run, hit accuracy is `(Perfect + Good) / total charted notes * 100`; any charted notes still unresolved at excerpt end are first resolved as misses. If a denominator is zero, accuracy is `null` and the UI displays “No notes,” not 100%. The primary result shows whole-run accuracy; per-mode counts/percentages may also be shown. Expose Resonance earned/spent/discarded and final City Answer separately; City Answer is not accuracy. Explain automatic conversion and loss of excess in Ready instructions. Results settle at excerpt end after the chart's final window has already closed.

## Logging and risks

At service boundaries, log structured console attempts and outcomes for fetch, decode, context resume, source schedule, and stop. Log lifecycle/phase transitions with trigger, generation, and position, and summarize resource/results at completion. Do not log per frame or per note.

Decoding the full MP3 to PCM may require roughly **120–140 MB** of memory. Verify this on the target desktop/browser; do not silently switch to a different track, copied asset, or playback design. Fake clocks and synthetic charts prove deterministic model behavior, not speaker/device synchronization.

## Verification contract

Write deterministic Vitest coverage alongside implementation for exact timing-window edges and offset signs; at offsets `-0.200`, `0`, and `+0.200`, verify inclusive earliest/latest hit edges, exact-deadline eligibility, and miss only strictly after deadline. Test envelope validation for all four bounds, strict exclusion-boundary endpoints, and notes whose center appears safe but supported-offset envelope is not. Verify sparse advancement orders deadlines against boundary/end events and causes no early positive-offset misses. Also test duplicate/held key and nearest-note selection, boundary transfer exactly once including a jump to end, invalid charts and insufficient excerpt duration, pause/resume/restart, stale async/source events, countdown cancellation, and recoverable audio errors. Audio lifecycle tests must include pause before a resume promise settles, resume completion after blur, an old `onended` after a new source starts in the same run, and callbacks after restart/disposal. Use synthetic charts and controlled time; tests must not depend on MP3 analysis.

In a real browser, check both the Vite development server and built assets: gesture-gated playback and actual note alignment, early/late pause and resume without source overlap, blur/hidden-tab pause, restart, boundary behavior, and resource outcomes. Include a reduced-motion and readable-cue check from the experience design. Real playback checks are required because fake clocks do not prove device sync. Human listening is a hard gate for accepting the final musical excerpt, transition point, and chart—not for building the runnable skeleton, fixtures, or a playable draft. The user can listen during the playable-draft stage.
