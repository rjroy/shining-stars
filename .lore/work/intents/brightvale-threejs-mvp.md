---
title: "Brightvale: first playable Three.js game"
date: 2026-10-07
status: approved
tags: [intent, brightvale, shining-stars, rhythm-game, threejs, mvp]
related: [.lore/work/brainstorms/brightvale-shining-stars.md]
---

# Brightvale: first playable Three.js game

We want to turn the Brightvale brainstorm into a playable Three.js game, starting with an MVP rather than the full progression system. There is no existing game implementation to extend.

The first version should include a small taste of both modes. We considered proving audience performance or Twilight combat alone, but the current direction is to experience the connection between them: perform for an audience, build strength, then use that strength to protect Brightvale. A short audience performance followed by one Twilight encounter is the proposed shape, not a settled duration or content count.

The player is already a Shining Star and remains the lead performer in both modes. This is not a story about attending another performer's concert or earning the right to become a performer. The city joining the song is central to the experience: power lines strum, buildings boom, and the wind becomes chorus. Three.js should help express that participation, rather than merely placing a rhythm interface over unrelated scenery.

The user chose keyboard rhythm inputs rather than microphone-based singing. They have supplied six tracks in `data/music/` and confirmed that the music is original or cleared for use in the game: Never Again, The Abandoned Child, The Commodity, The First Shining Star, The Last True Performer, and The Rising Star (all Remastered MP3s). The user selected `data/music/The First Shining Star (Remastered).mp3` to anchor the MVP. Having six tracks available does not mean all six belong in the MVP.

The MVP is meant to let us experience the core loop before investing in a larger game. The exact controls, rhythm presentation, spending rules, and outcomes are still undecided. In particular, choosing both modes does not settle whether self-esteem and skill are spent or persist. A single consumable resource could keep the first loop small, but that remains a suggestion rather than an agreed mechanic.

The setting's distinction between difficulty and surrender matters even in the first version. Fear, despair, or missing a note does not mean allowing the Twilight in. Defiance protects the individual; singing protects the city. How to express this distinction in play remains a design conversation, not a reason to equate imperfect timing with surrender.

Larger progression, additional songs, and broader content can follow after the first loop takes shape. Desktop-first play is the proposed starting point, not a settled platform commitment; the broader visual style remains open. Brightvale: Shining Stars remains the working title.

## A first playable slice around the music

Automated analysis measured the selected track at 362.92 seconds, approximately 6:03, and estimated a tempo near 136 BPM. A half-time feel near 68 BPM is also possible. Detected musical changes near 1:47, 2:26, and 2:53 suggest a useful starting excerpt, but these are machine-generated candidates, not confirmed verse or chorus boundaries. The analysis did not include listening to the track.

The recommendation is to try roughly 66 seconds, from 1:47 to 2:53, with an audience-to-Twilight transition around 2:26. Listening and beat-aligned edits may move those boundaries. This gives both modes room without requiring the entire six-minute song or a larger campaign.

For that slice, the proposed interaction uses four keyboard lanes mapped to `D F J K`. Audience performance earns one provisional consumable resource, called **Resonance** for now. At the transition, that strength is spent to bolster the city's defense, and the player continues performing through the Twilight encounter. The name, precise spending rule, and note chart are still proposals; this does not decide the longer-term role of self-esteem and skill.

One compact Three.js scene, a mostly fixed camera, and clear rhythm cues would keep the first experience readable. Power lines vibrate, buildings pulse, and wind becomes visible as the city participates. The supplied mixed MP3 plays unchanged: without isolated stems, this first version expresses city accompaniment visually rather than pretending to add separately audible instrumental parts.

The result should distinguish performance accuracy from city protection. Misses can weaken the performance without becoming surrender or revoking the player's defiance. Exactly how protection and success are represented remains to be worked out.

The suggested path is to establish rhythm timing and input first, connect the two modes next, and then add the city's reactions. The implementation plan can work out audio-clock synchronization and how to check that new players understand the transition and resource spending. These notes capture the proposed direction, not an implementation contract; no game code has been written yet.
