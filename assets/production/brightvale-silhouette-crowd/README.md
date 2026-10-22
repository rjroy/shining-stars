# Brightvale waist-up silhouette crowd

The approved source is `assets/authoring/brightvale-silhouette-crowd/pilot-candidate-waist-up.png` (SHA-256 `92cbcf67c40fea19978aaba31cb49ce0600f7bbfe886d7d076c34ce2b2d5c5ed`). The current derivative is the waist-up atlas and metadata; the runtime imports these files from `src/rendering/brightvale/silhouette-crowd-assets.ts`.

## Reproduce and inspect

Run from the project root with the installed Python/ImageMagick tools; no installs are required:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s assets/production/brightvale-silhouette-crowd -p test_produce.py
PYTHONDONTWRITEBYTECODE=1 python3 assets/production/brightvale-silhouette-crowd/produce.py --output /tmp/opencode/waist-up-reproduction
PYTHONDONTWRITEBYTECODE=1 python3 assets/production/brightvale-silhouette-crowd/review.py --qa-dir .lore/local/evidence/silhouette-crowd
```

`produce.py` verifies source identity, decoded tile pixels, gutters, UV bounds, and metadata, and emits the atlas, metadata, and validation report. `review.py` inspects the assembled atlas using its attachment metadata. The approved pixels and source are not modified by the producer. `validation-waist-up.json` and `.lore/local/evidence/silhouette-crowd/` retain current derivative and review provenance; older experiment hashes in the report are historical provenance only and the superseded files have been retired.

## Runtime contract

Use the JSON attachment anchors and UVs directly; parts share 560 source pixels per provisional local unit. Texture sampling uses sRGB, `flipY=true`, clamp-to-edge, linear filtering, and no mipmaps. Preserve the vertical stick, palm occlusion, and coordinated arm/stick wave. The game composition owns the approved 120-person, 31-stick population and mirrored-arm/varied-motion behavior; its tuning lives in runtime code, not in the asset producer.
