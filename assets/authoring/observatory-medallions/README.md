# Observatory collection medallions — approved artwork

**Status: The user approved the four exact source artworks and authorized padded derivatives and runtime integration. The recorded hashes identify the approved sources. Source approval is separate from runtime visual acceptance.**

## Shared direction

Create separate, reusable illustrated medallions for the Observatory collection overview and selected-collection detail. Match the richness and scale of the approved reference `.lore/work/concepts/song-select/observatory-collections.png`: lavish celestial anime-fantasy illustration, deep indigo/violet skies, luminous jewel tones, fine gold ornament, and a confident, readable central image. This reference approves the visual direction, not its placeholder collection names, imagery, counts, or story.

Each emblem should read as a **large illustrated celestial object**, not a small glyph, wireframe constellation, or generic icon enclosed by a ring. Give each a distinct outer silhouette and strong central motif, while coordinating their scale, detail density, gold edging, and fine astral ornament. Use light and glow painted as part of the illustration where they belong; the runtime may separately add a selected-state outline, halo, or animation. Do not bake UI states into the artwork.

The same source art is intended for the overview hotspot (currently up to **188 CSS px** across) and selected detail emblem (currently up to **165 CSS px**, and **68 CSS px** on narrow screens). Keep each motif recognizable at the 68 px display size. Current renderer pixel ratio is capped at 1.5; recommend **1024 × 1024 px, square 1:1 PNG** masters for comfortable downscaling. The art file-size budget is **unknown**; do not infer one. Place artwork within generous, consistent transparent safe padding so neither ornament nor integral painted light is clipped.

Transparent pixels outside each medallion are desired; the central illustration may be fully painted. Do not substitute a flat square/painted backdrop for transparency. PNG transparency must be inspected, not assumed, after generation. Include no text, collection names, song titles, counts, labels, buttons, borders from the page, or baked selection indicators. Keep each medallion in an individual source file.

Use the collection names and groupings in `data/proposed-collections.json` as factual inputs. Do not derive extra narrative, song-specific scenes, characters, places, or events from the member song titles.

## Approved motifs

1. **Lyra of Brightvale** — A graceful celestial lyre silhouette: luminous strings sweep into a star-like resonance at the center, with a few jewel-like lights woven through the frame. Proposed palette: royal indigo and plum, warm gold, and restrained lavender. This is symbolic treatment of the collection name, not a claim about the songs or Brightvale lore.
2. **Christmas Star** — A radiant, crystalline eight-point star with frost-like facets and restrained evergreen/holly ornament at the outer frame. Proposed palette: midnight blue, icy blue and silver, warm gold, with a small berry-red accent. Keep the star as the clear central silhouette; do not illustrate scenes or characters from member song titles.
3. **Outside Worlds** — An asymmetric planetary medallion: a luminous ringed world and small orbiting moon, crossed by a curved comet-light arc. Proposed palette: deep violet, teal/cyan, rose nebula accents, and shared gold detailing. Treat this as abstract celestial imagery, not a named destination or additional setting in the game's lore.
4. **Halloween** — An enchanted, gold-edged jack-o'-lantern with a glowing amber face, violet gems, and a fine gold astrolabe against an indigo sky. Use the three existing medallions as the style and scale reference.

## Original three medallions: source provenance and review

Generated through the authorized `codex exec --skip-git-repo-check -` route using Codex CLI **0.162.1** and its built-in image-generation path on **2026-10-14**. Each native PNG was originally copied byte-for-byte to this directory; decoding verified 8-bit sRGB RGBA with alpha 0–255. Commit `0db1025` later replaced the authoring PNGs with WebP copies. The exact approved PNGs are the native outputs below or the files at Git revision `4bb15d1`, which match the recorded approval hashes. Do not use the authoring WebP copies to reproduce the existing runtime files.

| Artwork | Approved PNG in `4bb15d1` | Native source | Dimensions / bytes | SHA-256 |
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

## Halloween: approved master

On **2026-11-24** (local time), one render through Codex CLI **0.172.0** used its native OpenAI image-generation tool and a reference strip of the three existing medallions. The image model was not reported. The native PNG at `/home/rjroy/.codex/generated_images/01a210d0-452d-7b93-8591-206a59730cbb/exec-6ce1815d-701b-48e1-a869-f13365f81c5e.png` was copied byte-for-byte into the authoring package. The user approved that exact candidate and requested runtime integration. It was renamed to [`halloween.png`](halloween.png) without changing its bytes.

- **SHA-256:** `8e3248390b1af366372067b549cd68ed74f9a0fe3cace1ec6a75bc8bc3802720`
- **Native format:** 1254×1254, 8-bit sRGB RGBA PNG, 1,935,281 bytes.
- **Source inspection:** Alpha spans 0–255; at greater than 1% alpha, the bounds are `1103×1200+75+19`. Trace 1/255 alpha samples on the source border were not visible in the light and dark composites. No source cleanup was applied. The carved face remains legible at 68 px.

## Runtime derivatives and reproduction

`build-runtime-assets.sh APPROVED_SOURCE.png [OUTPUT_DIR]` builds one derivative, named for its source. It resizes proportionally into 840×840 with ImageMagick Lanczos, centers the image on a transparent 1024×1024 sRGB canvas, and encodes lossless WebP with `cwebp -lossless -exact -m 6 -q 100 -metadata all`. No cropping or background removal is used. Halloween was built with ImageMagick **7.1.2-34** and `cwebp` **1.6.0**; the original three used ImageMagick **7.1.2-31** and `cwebp` **1.6.0**.

From the repository root, rebuild Halloween into production:

```bash
dir=assets/authoring/observatory-medallions
bash "$dir/build-runtime-assets.sh" "$dir/halloween.png"
```

Pass a scratch output directory as the second argument to rebuild without replacing the production file. The command does not read or rewrite the other medallions. To recover one of the original masters for a rebuild, extract its exact approved PNG into a scratch directory; for example:

```bash
scratch=$(mktemp -d)
git show 4bb15d1:assets/authoring/observatory-medallions/lyra-of-brightvale.png \
  > "$scratch/lyra-of-brightvale.png"
```

| Artwork | Runtime derivative | Dimensions / bytes | SHA-256 | Decoded alpha |
|---|---|---:|---|---|
| Lyra of Brightvale | `assets/production/observatory-medallions/lyra-of-brightvale.webp` | 1024×1024 / 753,846 | `abcd514608b3c030edb294ef485fef2ce0a704489d04a016109f98c5e0e24b50` | min 0, max 1 |
| Christmas Star | `assets/production/observatory-medallions/christmas-star.webp` | 1024×1024 / 843,838 | `11eccc92b8dfc4d53b47058e977add04a5c72b2c55bedd190af4a9be8cfbeb36` | min 0, max 1 |
| Outside Worlds | `assets/production/observatory-medallions/outside-worlds.webp` | 1024×1024 / 735,726 | `f63ae0612cbcdc1db54eef28812f956dcfeb837adfa1f2d2b83e7712a19dbc42` | min 0, max 1 |
| Halloween | `assets/production/observatory-medallions/halloween.webp` | 1024×1024 / 706,208 | `0b26b9aa345ec6290ffc4a9c1399f1ee93b93b249cb0656e7555bb6a921464a6` | min 0, max 1 |

Each derivative matched its separate scratch build byte-for-byte at the time of its export. Halloween also decoded through `dwebp` **1.6.0** to the exact padded 8-bit RGBA pixels. The >1% alpha bounds in the common 1024 canvas are Lyra `780×797+122+112`, Christmas `750×813+137+106`, Outside Worlds `788×807+118+109`, and Halloween `739×803+142+105`. Light and dark composites at 188, 165, and 68 px showed recognizable motifs and no visible square matte or edge fringe. Halloween's decoded WebP matched the padded source inspection previews pixel-for-pixel. These are asset checks, not runtime visual acceptance.
