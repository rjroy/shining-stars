# Scoring system

This document records the agreed scoring rules for Shining Stars. Scoring implementation is tracked in `shining-stars-4f4.35`. Generated scoring metadata, local saved ratings, completed-result saving, and their song-selection display are tracked in `shining-stars-c0n`.

## Purpose

Score rewards timing accuracy and sustained successful hits. It is separate from Renown, Personal Strength, Twilight Strength, and defeating Twilight. Any future connection between those systems is undecided.

Scoring and combo continue uninterrupted through Audience, Twilight, and Radiant, including the remainder of the song after Twilight is defeated. Freezing strength changes does not freeze score. Starting a new run resets score and combo.

## Points per note

- **Perfect:** 100 base points throughout the Perfect timing window.
- **Good:** base points decrease linearly from 100 at the Perfect boundary to zero at the Miss boundary.
- **Miss:** zero points and resets the combo.
- Both Perfect and Good advance the successful-hit streak.

Use absolute timing error, so equally early and late hits earn the same points. Initially, scoring uses the existing difficulty-specific gameplay timing boundaries. Separate scoring timing windows may be introduced later, but are not currently part of the design.

For a Good hit, with absolute timing error `e`, Perfect boundary `P`, and outer successful-hit boundary `G`:

```text
basePoints = 100 × (G − e) / (G − P)
```

The score itself is an integer, not merely formatted as one. The implementation rounds each hit to the nearest integer **after** multiplying:

```text
awardedPoints = round(basePoints × multiplier)
score += awardedPoints
```

## Combo and multiplier

| Successful note in the current streak | Multiplier |
| ------------------------------------- | ---------- |
| 1–10                                  | ×1         |
| 11–20                                 | ×2         |
| 21–30                                 | ×3         |
| 31–40                                 | ×4         |
| 41 onward                             | ×5         |

The tenth successful hit earns the increased multiplier for the **next** note. The HUD shows that next-note multiplier: after hit 10 it displays ×2, although hit 10 earned ×1 points.

A Miss resets the streak to zero and the next-note multiplier to ×1. It does not subtract previously earned score. Mode transitions do not reset the streak.

### Example: 60 consecutive Perfects

```text
10 × 100 × 1 =  1,000
10 × 100 × 2 =  2,000
10 × 100 × 3 =  3,000
10 × 100 × 4 =  4,000
20 × 100 × 5 = 10,000
Total          20,000
```

## Shared song baseline

Each song uses the theoretical maximum score of its **Normal chart**, including combo multipliers, as the baseline for all difficulties. This is the score for hitting every Normal-chart note Perfect without breaking combo.

Easy, Normal, and Hard use the same star thresholds for that song. Easy is allowed to earn gold, including five gold stars, if its score reaches those thresholds. There are no difficulty-specific star caps. A score may exceed the Normal maximum.

All current songs have a Normal chart. The current implementation falls back to the selected chart if Normal is absent; that fallback does not provide a shared Normal baseline and should not be treated as the intended rule for future catalog entries.

## Five stars, two progress tracks

Display **five stars**, not ten. They progressively fill as normal stars, then the same five stars progressively turn gold.

| Completed star | Normal threshold | Gold threshold |
| -------------- | ---------------- | -------------- |
| 1              | 20%              | 70%            |
| 2              | 30%              | 75%            |
| 3              | 40%              | 80%            |
| 4              | 50%              | 85%            |
| 5              | 60%              | 90%            |

Percentages refer to the song’s Normal maximum.

Filling is continuous between thresholds, like two successive progress bars:

- From 0% to 20%, the first normal star fills.
- Each subsequent normal star fills over the next 10 percentage points, reaching five full normal stars at 60%.
- From 60% to 70%, the first star progressively turns gold.
- Each subsequent gold star fills over the next 5 percentage points, reaching five full gold stars at 90%.
- Above 90%, the display remains five gold stars while score can continue increasing.

Examples: at 10%, the first normal star is half filled. At 65%, all five normal stars are full and the first has a half-filled gold overlay. At 75%, two stars are gold and three remain normal.

For the 20,000-point example, five normal stars require 12,000 points and five gold stars require 18,000 points.

## Presentation

Follow the approved mockups:

- [Golden City Rhythm Concert](../.lore/work/mockups/Golden%20City%20Rhythm%20Concert.webp)
- [Neon Twilight Rhythm City](../.lore/work/mockups/Neon%20Twilight%20Rhythm%20City.webp)

Use five stars with the fill-then-gold behavior described above. Show the multiplier as part of the combo area. HUD and results must present the same authoritative score and star progress.

Adding scoring must preserve the approved city and highway positioning. Adapt the HUD rather than moving the scene to accommodate it.

### Milestone echoes

Completing a normal star produces an expanding, fading pearl-white copy; completing a gold star produces a gold copy. Partial fills do not trigger an echo. If one update completes several stars, each completed milestone receives its own copy.

An increased multiplier produces an expanding, fading copy of the new value. On a Miss that returns the multiplier to ×1, the HUD shows ×1 immediately while a copy of the old multiplier shrinks and fades. Unchanged multipliers do not repeat the effect.

These are decorative, non-interactive overlays, not additional stars or score. They do not change measured HUD bounds, exclusions, or city/highway framing. Star and multiplier-increase echoes last 2600 ms: they expand to 4× and 3.5× their source size respectively by 18%, hold at 0.9 opacity through 65% (1690 ms), then fade. Star copies expand down/right from their top-left corner; multiplier copies expand down/left from their top-right corner, keeping expansion inward at screen edges. Multiplier decreases use cool silver rather than celebratory cream/gold, remain at 2.2× size and 0.9 opacity through 55% of their 2000 ms lifetime (1100 ms), then contract to 0.45× and fade. All echoes are capped at 90% opacity and fade to zero. Echo-only #111111 outlines use a 1 px non-scaling SVG stroke for stars and a 0.35 px text stroke before scaling for multipliers, painted behind their unchanged fills. The original HUD has no added outline or opacity change. Large echoes can still temporarily overlap the HUD on narrow screens; translucency and outlines improve separation without shrinking or repositioning them. Cleanup fallback timers allow the complete animation plus 100 ms; simultaneous copies remain capped at 24.

Initial rendering, restart, results, and reduced-motion updates do not replay milestones. Audience, Twilight, and Radiant continue the same milestone history. Reduced motion disables the echoes without delaying the real HUD update. Transient copies, animation callbacks, and fallback timers are removed on completion, restart, pause/results, motion-preference changes, and UI disposal; disposal also removes preference and resize listeners.

## Generated targets and saved achievements

Each generated chart bundle carries version-1 scoring metadata derived offline
from its Normal chart: the theoretical all-Perfect Normal maximum, the
five-gold target (`ceil(normalMaximum × 0.9)`), and a SHA-256 fingerprint of the
scoring version and canonical Normal chart. Bundles without a Normal chart use
`null` for all three values. The runtime catalog validates and exposes this
metadata so target presentation can use the generated target instead of
scanning charts at startup. Regenerate and run `chart:check` after Normal-chart
or scoring-rule changes; the check verifies the generated target and fingerprint
are current.

The unified save store provides localStorage-backed best earned normal/gold
counts keyed by stable song ID alongside favorites. A missing rating entry means **unplayed**;
a stored `0 normal / 0 gold` rating means the song was played and completed with
no stars. Saved counts are the earned counts at completion, not a value
recomputed from current target metadata. A later target revision therefore does
not erase historical achievements, and a worse run never replaces a better
record. The saved ordering is `normalStars × 6 + goldStars`, so normal stars
dominate and gold stars break ties. Song selection shows five static star slots
in each song row and selected detail, retaining duration and distinguishing
unplayed from played with zero stars. The selected detail shows the generated
five-gold target unchanged across difficulty choices, or an explicit unavailable
state when there is no Normal chart. Menu ratings never trigger gameplay echoes.

Gameplay records the selected song's rating when it reaches a terminal result:
Victory, Survived, or Defeat, including a zero-star Defeat. Songs without a Normal
baseline are skipped. Quit and restart are not completions and do not write a
rating; active/per-frame updates do not write either. Returning to selection
refreshes both list and detail from saved ratings without another interaction.
Corrupt or denied localStorage falls back to in-memory session data with a
notice. The selector reads the current save-storage notice on normal rendering
and idle return, including fallback after a result write. Clearing browser
storage loses saved achievements and favorites. See [Save data and backups](save-data.md)
for the portable format, migration, and import/export behavior.
Cloud synchronization, leaderboards, unlocks, and meta-progression are outside
this scope. Independent actual-app validation of return-time row refresh and
storage notices remains separate from this implementation description.
