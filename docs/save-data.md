# Save data and backups

## Back up or move your progress

Open **Save data** in the Observatory to download a backup or choose a backup
file. The file includes favorites, earned song stars, and progression (victory
marks, spendable credits, and purchased collections and songs). It does not
include settings.

Before importing, choose how to use the backup:

- **Merge** keeps favorites from both saves and keeps the better complete star
  rating for each song. A rating is compared as a whole; normal stars rank
  first, with gold stars breaking ties.
- **Replace** uses the backup exactly. Favorites and ratings missing from the
  file are removed, and a rating can be lowered. Review the preview and confirm
  before replacing.

Choose progression separately when importing:

- **Keep current progression** leaves the current victory marks, balance, and
  purchases unchanged. This is the default, including when merging.
- **Replace progression** uses the backup's complete progression as a whole.
  Victory marks, credits, and unlocks are never unioned across saves.

Favorites and ratings still follow the selected Merge or Replace behavior,
independently of the progression choice. A session-only import or change is held
in memory and is not durable on the device; the save store reports this through
its persistence status and notice.

Song IDs that are not in the current catalog are kept in the backup and in
saved data, even though they do not appear in song lists.

If the browser cannot save an import locally, the game leaves your current data
and stored save unchanged. You can explicitly choose a session-only import
instead. Session-only changes are held in memory, not saved to the device; after
a reload, the older device save may return. Download a backup after a
session-only import if you want to keep those changes.

Backups are user-controlled. Clearing browser storage removes the device copy,
so keep downloaded backups somewhere safe. The game does not synchronize saves
between browsers or devices automatically.

## Save file format

Save files are JSON with this version-2 envelope:

```json
{
  "format": "shining-stars-save",
  "schemaVersion": 2,
  "favorites": ["song-id"],
  "ratings": {
    "song-id": {
      "played": true,
      "normalStars": 5,
      "goldStars": 2
    }
  },
  "progression": {
    "balance": 0,
    "victoryMarks": {},
    "collectionPurchases": {},
    "songPurchases": {}
  }
}
```

`favorites` is an array of song-ID strings. Each rating records a completed
song, including a zero-star result. Star counts are integers from 0 to 5; gold
stars require all five normal stars. The derived achievement ordinal is not
stored. Progression stores a nonnegative integer `balance`; `victoryMarks` maps
song IDs to their highest credited difficulty (`easy`, `normal`, or `hard`);
`collectionPurchases` maps collection IDs to the paid cost; and
`songPurchases` maps song IDs to their parent collection IDs. The save store
validates credit conservation: balance plus recorded purchase costs must match
the credits earned from victory marks. The format has no timestamp or settings
fields.

Version-1 saves are still accepted. Migration preserves all valid favorites and
ratings and initializes progression with zero victory marks, zero balance, no
purchases, and access to the free Lyra of Brightvale collection. It does not
infer victories from old scores or stars. A later save write exports schema
version 2.

Imports validate the complete file before applying it. The format identifier
and schema version must be supported; unexpected fields, non-string favorite
entries, blank rating IDs, invalid ratings, and malformed JSON are rejected
without changing player data.
Unknown song IDs remain intact. Generated chart targets, catalog data, and
caches are application data, not part of a player save.

## Device storage and migration

The current device save is stored under `shining-stars.save`. The game lazily
migrates the earlier favorites and song-ratings storage records into this
envelope on the next player-data change; simply opening or exporting does not
rewrite them. The original legacy records are left in place. A valid unified
save takes precedence over legacy records.

If the unified save is corrupt or unsupported, the game does not fall back to
older legacy records. If only one legacy record can be read, that valid data is
available for the session, but automatic writes are disabled so unreadable
stored bytes are not overwritten. In either case, export contains the data
available in memory; there is no automatic repair.

Writes check whether stored data changed since it was read and refuse to
overwrite a detected conflict. This is a sequential safeguard, not a
cross-tab transaction. To avoid competing edits, use one active game tab while
changing saved data.
