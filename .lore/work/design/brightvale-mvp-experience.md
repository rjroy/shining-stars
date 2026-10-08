---
title: "Brightvale MVP gameplay and visual design"
date: 2026-10-07
status: draft
tags: [design, brightvale, rhythm-game, threejs, mvp]
related: [.lore/work/intents/brightvale-threejs-mvp.md, .lore/work/brainstorms/brightvale-shining-stars.md]
---

# Brightvale MVP gameplay and visual design

This is a proposed, implementable first-playable design for parent review and reconciliation with audio/timing advice. It is not an approved requirement or a full visual identity. All mechanics and visual treatments below are provisional unless already stated in the intent.

## Player promise and slice

The player is already a Shining Star and the lead performer. In one short playable sequence, they perform before Brightvale, gather a little strength, then keep performing as the city joins them against the Twilight. Rhythm quality affects the performance and how much accompaniment the city can offer; it never determines whether the player consents to being consumed. Standing defiant protects the player independently of accuracy.

**Provisional desktop-first slice:** use `data/music/The First Shining Star (Remastered).mp3`. The machine analysis proposes an excerpt from 107.1s to 172.9s, with a mode boundary at 146.3s. The structure file labels 107.1–146.3 as a verse and 146.3–172.9 as a chorus; these are automated labels, not listening-verified boundaries. The excerpt, chart, and boundary remain provisional until a human listens and the parent reconciles the separate timing analysis. Do not present the machine's labels as confirmed musical facts.

## Recommended playable rules

### Controls and note display

- Four fixed lanes map left-to-right to `D`, `F`, `J`, `K`. Show the letters on the hit pads and in a short pre-play instruction. Accept only the matching lane key; avoid requiring simultaneous chords in the first slice.
- Notes travel toward one fixed hit line. Use a single clear note shape and stable lane colors/positions; distinguish hit, miss, and upcoming notes with shape/position as well as color.
- Start and retry use `Enter` or a plainly labeled clickable button. Escape pauses. The browser must receive a user gesture before playback; the start screen explains this simply.
- Use Perfect at absolute error 75ms or less and Good at absolute error 150ms or less from chart time; both count as successful hits and earn the same resource amount. For input offset `o`, judge at `transportTime - o`: positive `o` means a later physical press is accepted. Hit-window endpoints are inclusive; a miss is due only strictly after `note.time + 0.150 + o`. Apply input offset once, without changing these player-facing windows.
- Chart only the candidate excerpt, with note timing authored or verified against its audio. Do not generate a dense chart from estimated BPM alone. The 136 BPM estimate and possible 68 BPM half-time feel are hypotheses, not chart instructions.

### One resource: Resonance (provisional name)

Use one integer resource, **Resonance**, from 0 to 100. It is a temporary slice resource, not a replacement decision for the longer-term concepts of self-esteem, skill, or personal resources.

- Begin at 0. In audience mode, each Good or Perfect hit attempts to add 2 Resonance; cap at 100. **Resonance earned** is only the amount actually added to the capped balance; overflow is ignored, not earned or discarded. A miss adds none and removes none. Do not add an accuracy multiplier or streak penalty in this slice.
- At the mode boundary, automatically spend `min(current Resonance, 40)`. Set Resonance to 0, including when the player had more than 40; explicitly discard any balance over 40 rather than preserving a hidden remainder. Add twice the amount spent to a 0–80 **City Answer** value. City Answer is a contribution meter, not another spendable resource.
- During Twilight mode, each Good or Perfect hit adds 2 City Answer, capped at 100; misses do not reduce it. This is the city's visible response/defense contribution, not the player's personal safety.
- In Ready instructions, explain plainly that performance builds Resonance, automatically used to strengthen the city's answer at the transition, and leftovers are lost. Keep conversion arithmetic out of the live note HUD. Automatic transfer preserves the uninterrupted song and avoids a mid-song spending prompt.
- At 0 Resonance, the Twilight sequence still plays in full. Say that the player can continue; show a quiet city response at first, then allow subsequent hits to brighten it. Never show a failed/surrendered state because of resource shortage.
- If every note is missed, audience Resonance stays 0; City Answer starts at 0 and stays there. The player remains defiant and the encounter still completes. The result says that the city's song was faint / had room to grow (wording can be tuned), not that the player gave in or Brightvale was consumed. There is no restart demand or punitive game-over in this slice.
- The final charted note window must close at least 0.5 seconds before excerpt end. Keep the game in Playing through the remaining audio tail: Pause and Restart stay available, and unmatched lane presses cannot earn resources. Do not stop audio or show results when the final note resolves. At excerpt duration, catch up and resolve any remaining chart notes as misses, then show results. Show audience Resonance earned/spent/discarded, Perfect/Good/Miss counts, whole-run hit accuracy, and final City Answer separately; City Answer is not accuracy. Hit accuracy is `(Perfect + Good) / total charted notes * 100`; if there are no notes, display “No notes,” not 100%. The MVP has no death, surrender choice, persistent save, or progression reward.

This gives resource spending a visible consequence while making the zero-resource and all-miss cases complete, playable outcomes. A tuning pass can change point values after chart length is known, without changing these semantics.

## Scene, camera, and visual language

Build one compact, low-overhead Three.js scene from simple geometry and a small number of reusable meshes. The scene should feel like one specific place, not a generic arena: a low stage/performer anchor, a small audience silhouette band, and three legible city motifs—overhead power lines, a few block-like building forms, and broad wind ribbons. Keep visual detail behind the rhythm layer.

Use a locked, slightly elevated wide camera framing performer and city participants together. Do not rotate, chase notes, or cut away during play. A small, deliberate camera push at the handoff is optional only if it does not alter lane positions. Choose a twilight-dark base with warm stage light and restrained luminous city responses; these are provisional scene roles rather than a permanent palette. Favor crisp silhouettes and a few strong light fields over particles, detailed textures, or asset-heavy scenery. No factual setting detail beyond the supplied premise is implied.

The performer remains the brightest human focal point in both modes. In audience mode, audience silhouettes face and respond to the performer. During Twilight mode, keep the performer visible as the lead while the three city motifs react: lines visibly flex/pulse, building faces answer with a soft beat pulse, and wind ribbons gather into a sustained visual chorus. Tie the intensity of those responses to Resonance/City Answer, but keep the hit line and approaching notes higher in contrast and never cover them.

## Audio honesty

Play the mixed MP3 unchanged. No isolated stems or separately audible power-line strings, building percussion, or wind chorus are available, so do not synthesize or label extra sounds as if they were extracted parts. The city's accompaniment is represented through visual motion synchronized to the chart/resource response, while the original mix remains the only music. Do not imply that the visual pulse proves a specific instrument is sounding.

## Flow and state changes

1. **Ready:** scene and performer visible, track/title identifier, controls, concise instruction (including automatic Resonance conversion and loss of leftovers), and Start button. If loading is still in progress, disable Start and explain that the track is loading.
2. **Start/countdown:** after the deliberate start action, show a two-second countdown before playback. Keep input disabled until audio begins. Resume also uses a two-second countdown, freezing the saved chart position and disabling input until playback starts.
3. **Audience performance:** run the excerpt/chart against the actual audio playback clock. Keep a small mode label, Resonance count, timing feedback, and pause control visible. Chart skeletons and fixtures can be prepared before listening; final musical chart and excerpt/cut acceptance require human listening.
4. **Mode handoff:** keep audio and chart clock uninterrupted. Across every supported input offset (`+/-200ms`), keep the complete note hit envelopes clear of the exclusion interval: an audience note's latest eligible time is strictly before `boundary - 0.5s`; a Twilight note's earliest eligible time is strictly after `boundary + 0.5s`. Endpoints do not touch the exclusion boundary. This ensures audience judgments resolve before automatic transfer. At the boundary, when `boundary <= transportTime`, use a roughly two-second visual transformation over the running music: audience light recedes, the same camera reveals the city motifs answering, and the mode label changes. Briefly report Resonance spent, discarded, and the resulting City Answer in plain language. Do not insert a loading screen, stop/restart the MP3, or move the hit line. Automatic spending preserves continuous play. If listening shows the boundary is unsuitable, move it before accepting the final chart rather than forcing the analyzed timestamp.
5. **Twilight performance:** continue the same four-lane interaction and same song. Increase visual pressure at the city edge, but keep it away from notes and performer. Hits visibly reinforce the city's answer; misses produce neutral feedback and do not make the Twilight enter.
6. **Result:** after the final chart note window, keep the game Playing through the audio tail. Pause and Restart remain available; unmatched lane presses have no resource effect. At excerpt duration, catch up logical events, resolve any remaining notes as misses, freeze the model, and show results plus Retry. Do not stop audio or reveal results early. Show audience performance counts/earned-spent-discarded Resonance, whole-run hit accuracy, and City Answer separately. Outcome language reflects contribution, never consent, worth, or a claim that imperfect play caused the Twilight to consume anyone.

## Essential interface states

- **Audio loading:** show progress or a clear waiting state; never start a silent chart. Keep Start unavailable until audio is ready.
- **Audio failure:** explain that the selected track could not be loaded and provide Retry loading. Do not silently substitute another track or run unsynchronized play.
- **Pause / focus loss:** Escape opens a pause overlay with Resume and Restart. During play, pause audio/chart together and save position. During countdown, cancel pending playback; on blur/hidden-tab do the same and show the overlay on return. Never auto-resume or let notes pass invisibly. Resume is deliberate: two-second countdown, saved chart position frozen, input disabled until playback starts.
- **Reduced motion:** honor the reduced-motion preference by removing camera push, wind travel, and pulsing intensity; use static changes in brightness/shape to communicate mode and resource. The rhythm chart remains animated only as needed for note travel, at a restrained speed.
- **Retry:** restart the exact same excerpt from Ready, reset Resonance and City Answer, and re-enable input only after audio is ready and the countdown ends.

## Scope boundaries and review checks

First slice only: one mixed track excerpt, one chart, one scene, two modes, one resource, one result state. No new voiceover, extra sound effects, added musical stems, enemy roster, branching temptation mechanic, multiple songs, campaign, unlocks, progression tree, account/save system, mobile layout, or asset pipeline is required. These are not rejected future ideas; they are outside this test.

Runnable skeletons, visual fixtures, and chart scaffolds need not wait for listening. Human listening is required before accepting the final excerpt, musical boundary, or final chart; parent reconciles these with technical audio-clock advice. In the runnable prototype, test the two-second start/resume countdown with input disabled, frozen chart position, and cancellation on pause/focus loss. Test timing against actual playback through pause/resume; test inclusive hit-window endpoints and strictly-late misses at every supported input-offset extreme. Validate each note's entire `note.time +/- 0.350s` envelope: earliest `>= 0`, audience latest `< boundary - 0.5s`, Twilight earliest `> boundary + 0.5s`, and final latest `<= excerpt duration - 0.5s`. Verify the boundary resolves audience judgments before transfer and does not disrupt lane readability. First-time players should identify the keys and hit line, understand automatic spending and loss of unused Resonance, and understand that a miss does not mean surrender. Include a zero-resource/all-miss run. Verify city visuals suggest participation without suggesting extra audible stems.

## Recommended decisions for parent review

1. Use desktop keyboard play with `D F J K`, a fixed camera, one clear lane chart, and one uninterrupted mixed-MP3 excerpt.
2. Use Perfect <=75ms and Good <=150ms with inclusive endpoints; a miss occurs only strictly after its offset-adjusted deadline. Earned Resonance counts only points actually added before the cap; spend up to 40 at handoff, discard the remaining balance, and report all three separately. Track Perfect/Good/Miss counts by mode and overall; define hit accuracy by successful hits over charted notes, with zero denominator shown as “No notes.” City Answer is contribution only; zero/all-miss play completes without surrender or game-over.
3. Keep the transition visually and clock-continuous. Enforce the complete note-window exclusion constraints for all supported offsets, not just chart centers. Use a two-second frozen-position start/resume countdown canceled on pause/focus loss. Keep Playing through the audio tail; show frozen results only at excerpt duration. Excerpt and boundary remain provisional until listening, but skeleton/fixtures can be prepared meanwhile.
4. Use geometry-led city landmarks with visual-only accompaniment; do not fabricate stems or new musical parts.

The specific excerpt (107.1–172.9s) and boundary (146.3s) are machine-analysis candidates only. No human listening verification has occurred; adjust or replace them after listening before any note chart or implementation is treated as settled.
