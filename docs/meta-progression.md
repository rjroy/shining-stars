# Meta-progression

This document records the approved rules for song unlocks, collections, and
victory credits. Meta-progression is separate from song mastery and scoring.

## Two independent kinds of progress

Song mastery is the star rating earned from a song's score, as described in the
[scoring system](scoring-system.md). Unlock progression instead uses permanent
victory-credit marks earned by defeating Twilight. A victory mark is not a star
or a score, and earning or spending credits does not change a song's saved star
record.

Each song can award at most three lifetime victory-credit marks: one each for
victory on Easy, Normal, and Hard. A victory on a difficulty credits that tier
and any still-uncredited lower tiers. Therefore:

| Victories, in order | New marks credited |
| ------------------- | ------------------ |
| Normal first        | 2 (Easy and Normal) |
| Hard first          | 3 (Easy, Normal, and Hard) |
| Easy, then Hard     | 2 (Easy first; then Normal and Hard) |
| Repeating a tier already credited | 0 |

Marks are permanent and distinct from the spendable credit balance. Spending
credits never erases the marks that record which victories have been credited.
Do not fabricate lower-difficulty scores, performance, or star records when a
higher-difficulty victory credits those lower-tier marks: crediting is only
meta-progression, not evidence of a lower-tier run.

## Starting access and collection costs

The player begins with the **Lyra of Brightvale** collection and all songs in
that collection unlocked. **Christmas Star** costs 3 spendable collection
credits to unlock; **Outside Worlds** costs 1. Each song in a purchased
collection costs 1 additional credit to unlock.

These costs deliberately encourage earning credits through higher-difficulty
victories. They do not guarantee that an Easy-only player can unlock the entire
future catalog. The free starting songs nevertheless allow a player to earn a
limited surplus of credits for spending.

## Narrative and scoring boundaries

The opening narrative establishes the reason to enter the world and save it;
unlock progression is the ongoing collection of songs and victories. Neither
changes the rules for score, stars, Renown, Personal Strength, or Twilight
Strength. In particular, Renown and scoring remain unchanged by this
meta-progression system.

## Award timing and existing saves

Credit victory marks as soon as Twilight is defeated, even if the player later
quits during the Radiant phase. Do not wait for song completion or a terminal
result. Award the defeated difficulty and any uncredited lower tiers according
to the table above. This event does not create or change a score, performance,
or star record.

When an existing save is first read by the progression system, retain its
existing stars and favorites. Initialize it with zero victory marks, zero
spendable credits, no purchased collections or songs, and the free Lyra of
Brightvale collection. Do not infer historical victories or fabricate marks
from scores or stars.

## Import and merge behavior

Continue to support merging imported favorites and song-star records with the
current save. Progression is not merged: when an import supplies progression,
the player must explicitly choose either to keep current progression or replace
it with the imported progression. Never union victory marks, spendable credits,
or collection/song unlocks across saves. Replacing progression uses the
imported progression as a whole; keeping it leaves the current progression
unchanged.

## Player-facing rules

- Show credited difficulty marks compactly as **E / N / H**, separate from the
  song's star rating. Only credited marks are shown as earned.
- Show the spendable credit balance near **Save data**.
- Keep locked songs and collections visible, selectable, and searchable so
  players can discover what they can unlock and what it costs.
- Before a purchase, show its explicit credit cost and the player's current
  balance, then ask for confirmation. Never autoplay a song after a purchase or
  unlock.
- Unlocking a collection does not unlock the songs in it; each collection song
  is unlocked separately at its stated cost.
- Keep this information usable within existing desktop and portrait layouts.

## Implementation status

The progression domain, catalog pricing adapter, save persistence, validation,
and import-preview/apply behavior are implemented. Runtime victory-credit
awarding and locked-song playback checks are wired to the save store. Player
interface integration and final validation remain in progress; implementation
of the foundation does not mean the complete player experience is finished.
