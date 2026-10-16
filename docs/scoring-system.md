# Scoring system

This document records the agreed scoring rules for Shining Stars. Implementation is tracked in `shining-stars-4f4.35`; local best ratings and song-selection targets are separate follow-up work in `shining-stars-c0n`.

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
| --- | --- |
| 1–10 | ×1 |
| 11–20 | ×2 |
| 21–30 | ×3 |
| 31–40 | ×4 |
| 41 onward | ×5 |

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
| --- | --- | --- |
| 1 | 20% | 70% |
| 2 | 30% | 75% |
| 3 | 40% | 80% |
| 4 | 50% | 85% |
| 5 | 60% | 90% |

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

## Separate follow-up: saved achievements in song selection

`shining-stars-c0n` tracks displaying these alongside song length:

- The player’s best earned normal/gold star rating for each song, retained in localStorage across runs and reloads.
- The five-gold target score: **90% of the song’s Normal maximum**.
- Cached or precomputed values, rather than recalculating from full charts on every app load. Cached targets must refresh when their chart or scoring rules change.

Losing saved achievements when browser storage is cleared is an accepted limitation. Cloud synchronization, leaderboards, unlocks, and meta-progression are outside this scoring implementation.
