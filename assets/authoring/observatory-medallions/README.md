# Observatory collection medallions — approved artwork

**Status: The user approved the brief and generation, then approved all three exact source artworks and explicitly authorized padded optimized derivatives and runtime integration. The recorded hashes identify the approved sources. Runtime visual acceptance remains pending.**

## Shared direction

Create three separate, reusable illustrated medallions for the Observatory collection overview and selected-collection detail. Match the richness and scale of the approved reference `.lore/work/concepts/song-select/observatory-collections.png`: lavish celestial anime-fantasy illustration, deep indigo/violet skies, luminous jewel tones, fine gold ornament, and a confident, readable central image. This reference approves the visual direction, not its placeholder collection names, imagery, counts, or story.

Each emblem should read as a **large illustrated celestial object**, not a small glyph, wireframe constellation, or generic icon enclosed by a ring. Give each a distinct outer silhouette and strong central motif, while coordinating their scale, detail density, gold edging, and fine astral ornament. Use light and glow painted as part of the illustration where they belong; the runtime may separately add a selected-state outline, halo, or animation. Do not bake UI states into the artwork.

The same source art is intended for the overview hotspot (currently up to **188 CSS px** across) and selected detail emblem (currently up to **165 CSS px**, and **68 CSS px** on narrow screens). Keep each motif recognizable at the 68 px display size. Current renderer pixel ratio is capped at 1.5; recommend **1024 × 1024 px, square 1:1 PNG** masters for comfortable downscaling. The art file-size budget is **unknown**; do not infer one. Place artwork within generous, consistent transparent safe padding so neither ornament nor integral painted light is clipped.

Transparent pixels outside each medallion are desired; the central illustration may be fully painted. Do not substitute a flat square/painted backdrop for transparency. PNG transparency must be inspected, not assumed, after generation. Include no text, collection names, song titles, counts, labels, buttons, borders from the page, or baked selection indicators. Output three individual image files, never a montage standing in for the assets.

The only intended factual inputs are the exact collection names and groupings in `data/proposed-collections.json`: **Lyra of Brightvale (6 songs), Christmas Star (17 songs), Outside Worlds (6 songs)**. Do not derive extra narrative, song-specific scenes, characters, places, or events from the member song titles.

## Approved motifs

1. **Lyra of Brightvale** — A graceful celestial lyre silhouette: luminous strings sweep into a star-like resonance at the center, with a few jewel-like lights woven through the frame. Proposed palette: royal indigo and plum, warm gold, and restrained lavender. This is symbolic treatment of the collection name, not a claim about the songs or Brightvale lore.
2. **Christmas Star** — A radiant, crystalline eight-point star with frost-like facets and restrained evergreen/holly ornament at the outer frame. Proposed palette: midnight blue, icy blue and silver, warm gold, with a small berry-red accent. Keep the star as the clear central silhouette; do not illustrate scenes or characters from member song titles.
3. **Outside Worlds** — An asymmetric planetary medallion: a luminous ringed world and small orbiting moon, crossed by a curved comet-light arc. Proposed palette: deep violet, teal/cyan, rose nebula accents, and shared gold detailing. Treat this as abstract celestial imagery, not a named destination or additional setting in the game's lore.

## Approved source provenance and review


Generated through the authorized `codex exec --skip-git-repo-check -` route using Codex CLI **0.162.1** and its normal built-in image-generation path on **2026-10-14**. The generator staged the native files below. Each native PNG was copied byte-for-byte to this authoring directory; native and durable SHA-256 hashes match. No resizing, background removal, or other source alteration was performed. Decoding verified 8-bit RGBA PNGs in sRGB with alpha minima 0 and maxima 255 (fully transparent and fully opaque pixels both present).

| Artwork | Durable source | Native source | Dimensions / bytes | SHA-256 |
|---|---|---|---|---|
| Lyra of Brightvale | `lyra-of-brightvale.png` | `/home/rjroy/.codex/generated_images/01a13d9a-a939-7380-93af-add78567b3c8/exec-56bcb62e-c2d5-4205-bfe1-ee9accbd9b3d.png` | 1254×1254 / 2,241,284 | `d05721c8a9ce36d23a5f7e78d8486b526160395e4073dad0948c12dde598121a` |
| Christmas Star | `christmas-star.png` | `/home/rjroy/.codex/generated_images/01a13d9a-a939-7380-93af-add78567b3c8/exec-fc1111ee-7c14-4470-8f83-128e0b53d433.png` | 1254×1254 / 2,353,252 | `58b79086d0f7af8360cbba566fae54390477923c1118e8691af1c3554d5dcfb3` |
| Outside Worlds | `outside-worlds.png` | `/home/rjroy/.codex/generated_images/01a13d9a-a939-7380-93af-add78567b3c8/exec-556b7f01-6e6b-4d89-8afb-6e6dc4b77a1a.png` | 1254×1254 / 2,058,627 | `712fcaf97c397387c7918f320e4cc79b444b55d606015d251c05c73bc2f38b12` |

The requested target was 1024×1024; the image generator returned 1254×1254 for all three. Native outputs were preserved at their actual dimensions rather than resized. The art file-size budget remains unknown.

### Inspection

All three images decode and visibly match their approved symbolic motifs. Together they read as a coordinated set of richly illustrated celestial medallions: lyre, crystalline star with evergreen, and ringed planet. They contain no visible text or UI. The central silhouettes remain identifiable in 68 px previews, though fine filigree naturally softens at that size. Dark and light composites at 188 px and 165 px, plus dark and light 68 px previews, were inspected; no obvious square backdrop or distracting matte fringe was seen.

Transparent exterior was confirmed from the decoded alpha channel, not inferred from a checkerboard. At an alpha threshold above 1%, the source nontransparent bounds are Lyra `1164×1190+45+30`, Christmas Star `1119×1212+68+20`, and Outside Worlds `1177×1205+39+25`. Christmas Star has especially tight source padding; the runtime build adds a common transparent canvas around the resized art. Approved source PNGs have not been modified.

Temporary review composites are under `/tmp/opencode/observatory-medallion-review/`: `three-on-dark-188.png`, `three-on-light-188.png`, `three-on-dark-165.png`, `three-on-light-165.png`, `three-on-dark-68.png`, and `three-on-light-68.png`. They are inspection-only composites, not delivered assets.

**Approval gates:** all three exact source artworks and their recorded hashes were approved by the user's “perfect” response. Padded production derivatives and runtime integration were subsequently explicitly authorized. Approval of those assets is not runtime visual acceptance; the parent session owns independent review and the user retains final runtime acceptance.

## Runtime derivatives and reproduction

`build-runtime-assets.sh` is the reproducible authoring script. It resizes each approved source proportionally into an 840×840 area using ImageMagick Lanczos, centers that transparent result on a 1024×1024 canvas, then encodes lossless, exact-alpha WebP (`cwebp -lossless -exact -m 6 -q 100 -metadata all`). No cropping or background removal is used. Verified with ImageMagick **7.1.2-31** and `cwebp` **1.6.0**. Rebuild to the production directory with `bash assets/authoring/observatory-medallions/build-runtime-assets.sh`; pass a directory to safely build elsewhere for comparison.

| Artwork | Runtime derivative | Dimensions / bytes | SHA-256 | Decoded alpha |
|---|---|---:|---|---|
| Lyra of Brightvale | `assets/production/observatory-medallions/lyra-of-brightvale.webp` | 1024×1024 / 753,846 | `abcd514608b3c030edb294ef485fef2ce0a704489d04a016109f98c5e0e24b50` | min 0, max 1 |
| Christmas Star | `assets/production/observatory-medallions/christmas-star.webp` | 1024×1024 / 843,838 | `11eccc92b8dfc4d53b47058e977add04a5c72b2c55bedd190af4a9be8cfbeb36` | min 0, max 1 |
| Outside Worlds | `assets/production/observatory-medallions/outside-worlds.webp` | 1024×1024 / 735,726 | `f63ae0612cbcdc1db54eef28812f956dcfeb837adfa1f2d2b83e7712a19dbc42` | min 0, max 1 |

Reproducibility was checked by building all three to a separate temporary directory and comparing SHA-256 hashes; each matched its production derivative. The alpha channel contains fully transparent and fully opaque pixels. The >1% alpha bounds in the common 1024 canvas are Lyra `780×797+122+112`, Christmas `750×813+137+106`, Outside Worlds `788×807+118+109`. Review composites from the generated derivatives were inspected on light/dark backgrounds at 188, 165, and 68 px. The distinct lyre, crystalline star, and ringed planet remain recognizable; no square matte or obvious fringe was seen. Temporary derivative composites are in `/tmp/opencode/observatory-medallion-review/runtime/`.
