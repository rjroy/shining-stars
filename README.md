# Shining Stars

**[Play Shining Stars](https://rjroy.github.io/shining-stars/)**

Take the stage as a performer whose songs can help save Brightvale. Hit notes in time with the music, rally the Audience, and carry that strength into a confrontation with Twilight.

## The Observatory

Browse 29 songs across **Lyra of Brightvale**, **Christmas Star**, and **Outside Worlds**, or open **All Songs**. Search the catalog, filter songs, and keep favorites close. Song details show duration, available difficulties, a personal-best star rating, and the target for five gold stars.

The Filters panel offers separate **Unlock status** (All songs by default, Unlocked, Locked), **Show Unplayed**, **Undefeated on difficulty** (None, Easy, Normal, Hard), **Less than 5 normal stars**, and **Less than 5 golden stars** controls. Active filters combine with search, collection, Favorites, and the other progression controls; All songs, unchecked controls, and None impose no condition. A completed defeat counts as played, even with zero stars. Star filters use your best result across difficulties, and unplayed songs qualify for both below-five filters. Undefeated uses credited victories (Normal includes Easy; Hard includes all three), independently of the difficulty chosen for Play. Locked songs remain browsable unless Unlock status excludes them; Locked is the inverse of actual progression access; editorially unavailable songs stay hidden. Filters last only for the current session.

The **Sort** panel offers **Unsorted** (original catalog or collection order), **Alphabetical** (A–Z), **Length** (shortest first), and **Difficulty** (lowest first). Difficulty is the generated five-gold target divided by playable seconds from the default browse chart, not the difficulty chosen for Play. Equal values retain original order; missing or invalid values appear last. Sorting combines with all filters, preserves a matching selection, and lasts only for the current session. Sort and Filters open one at a time; click or tap outside to dismiss them.

Choose Easy, Normal, or Hard. Each difficulty has its own chart and timing profile. Charts are still being refined.

## Perform

- **Audience:** successful notes build Renown. At Twilight, your Renown becomes Personal Strength.
- **Twilight:** successful notes weaken Twilight, while misses cost Personal Strength. If your strength runs out first, the result is Defeat. If the song ends while Twilight remains, you Survive. Defeating Twilight is a Victory.
- **Radiant:** after victory, the song continues to its end, and your score and combo continue with it.

On desktop, use **D**, **F**, **J**, and **K** for the four lanes. Press **Escape** to pause. On portrait phones, four touch targets support simultaneous thumbs. On small phone screens in landscape, gameplay pauses and asks you to rotate upright; choose Resume when ready. Device and browser experience may vary.

## Score and records

Accurate hits and sustained combos raise your score and multiplier. Five stars fill as normal stars first, then the same stars turn gold. Star targets use the song's Normal-chart maximum across difficulties. Your best completed-run star rating and favorites are saved in this browser; clearing browser storage removes them. Use Save data in the Observatory to download or restore a backup. See [Scoring system](docs/scoring-system.md) and [Save data and backups](docs/save-data.md) for details.

## Development

Requirements: Node.js `^22.13.0 || ^24.0.0 || >=26.0.0` and npm.

```sh
npm ci
npm run dev
```

Run the available checks with:

```sh
npm test             # Vitest unit and app integration tests; integration needs Chromium
npm run typecheck
npm run build
npm run test:chart
npm run chart:artifact-check # verify committed chart artifact consistency without pitch caches
npm run chart:check  # strict full pitch-cache-backed recomputation
```

Chart authoring uses FFmpeg/FFprobe and aubio tools when cached analysis is unavailable. These are offline tools, not browser dependencies. `npm run chart:generate` processes the configured catalog. See the [beat-chart workflow](docs/beat-chart-workflow.md) for authoring inputs, provenance, and cache details. Do not modify or redistribute source recordings based on the software license alone.

The project software is licensed under the [MIT License](LICENSE). Media may have separate rights and terms.
