# Brightvale sky artwork candidates

**Status:** both exact artwork versions below were approved by the user on 2026-10-15. Runtime integration is authorized and underway; runtime acceptance remains pending actual-game review.

## Approved direction and use

These are authored cloud/celestial overlays for review behind the existing Three.js Brightvale city. Preserve the current city, gameplay framing, highway, and shadows. Three.js remains responsible for the sky gradient, horizon haze, stars, mode tint/transitions, and any glow. Audience uses cool blue above a peach-gold illuminated horizon; Twilight uses darker indigo/violet cloud depth; Radiant is a grander luminous golden twilight, not daytime. Observatory uses the same restrained atmosphere behind its controls.

The artwork is informed by `.lore/work/mockups/Golden City Rhythm Concert.webp`, `.lore/work/mockups/Neon Twilight Rhythm City.webp`, `.lore/work/concepts/song-select/observatory-collections.png`, and `.lore/work/concepts/song-select/observatory-song-browser.png`. These are sky-mood/composition references, not permission to reproduce their city, UI, gameplay decorations, or full-scene illustrations. Current constraints are in `.lore/work/design/brightvale-perspective-highway.md` and `.lore/work/design/observatory-song-catalog.md`.

## Candidate files

- `audience-radiant-clouds.png` — framed warm illuminated cloud banks for Audience and Radiant.
- `twilight-cosmic-clouds.png` — framed indigo/violet cloud and restrained cosmic-depth overlay for Twilight.
- `audience-radiant-clouds-source.png` and `twilight-cosmic-clouds-source.png` — exact native generated sources, retained unchanged for provenance.
- [sky-art-review.webp](sky-art-review.webp) — palette composites on twilight gradients plus light/dark edge checks. This is an art review sheet, not an in-game capture. The generated PNG intermediate is temporary and is not retained.

Intended placement: broad, asymmetric clouds in the upper sky and selected skyline gaps, behind the unchanged 3D city. Keep the central upper gameplay field and UI reading zones quieter; preserve a clean low horizon for the city silhouette. No skyline, ground, text, controls, highway, HUD, baked stars, or baked glow is intended.

## Technical choices and runtime derivatives

These are implementation choices, not user-set budgets: the framed approved artwork is 1672×941 landscape with genuine transparent RGBA. The framed candidates are uniformly scaled to 80% and centered on transparent canvases for safer aspect-ratio cropping; no painting, keying, or background removal was applied. The faithful runtime derivatives are 1535×864 RGBA PNGs under `assets/production/brightvale-sky/`, resized with Lanczos without stretching, palette reduction, or lossy conversion. The script excludes volatile PNG date/time chunks so identical ImageMagick inputs produce byte-identical outputs. This size is a quality/delivery choice, not a device or memory budget. Run `bash assets/authoring/brightvale-sky/build-production.sh` from the repository root to reproduce and validate them. Tool: ImageMagick 7.1.2-31 Q16-HDRI.

## Provenance and review

Generation route: explicitly authorized `codex exec --skip-git-repo-check -` using the built-in `image_gen` mechanism, Codex CLI **0.162.1**, on 2026-10-15. Exact-version approval was given after the user reviewed the contact sheet and both exact candidates.

| Candidate             | Native generated source                                                                                                  | Source SHA-256                                                     | Source inspection                                                                                                            | Framed candidate SHA-256                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Audience/Radiant warm | `/home/rjroy/.codex/generated_images/01a13f1a-3ca6-7fc1-8cfb-ffa96691fd78/exec-c872b5d1-8c3d-48be-a754-edf811aac9ca.png` | `558d86fb83cf3238c38aa8a56e6a193772857069c6d72092e203800921f4771d` | PNG, 1672×941, sRGBA; alpha min 0/max 255; original visible/low-alpha bounds 1601×867 at +49+23, so margin needed correction | `8a8405fd2f8da926e9c27dbef73936be7c26602bc404a55f1fd274e5434da75d` |
| Twilight violet       | `/home/rjroy/.codex/generated_images/01a13f17-894f-77b1-92c0-c2183e707b69/exec-83d56491-e7ef-4212-b279-1ffae41cd12f.png` | `c4d3ec95858e57577344541641d0fa2f083cf48bd53fd59324d64cbcd7d9a779` | PNG, 1672×941, sRGBA; alpha min 0/max 255; original visible/low-alpha bounds 1658×912 at +0+29, so margin needed correction  | `496e103fc63a4326a44c08a20564c8da9da960e623cc89a8c440f781c4e9aa8c` |

Exact artwork approval (2026-10-15): warm candidate SHA-256 `8a8405fd2f8da926e9c27dbef73936be7c26602bc404a55f1fd274e5434da75d`; Twilight candidate SHA-256 `496e103fc63a4326a44c08a20564c8da9da960e623cc89a8c440f781c4e9aa8c`. Approval applies only to these framed authoring images, not derivative or runtime acceptance.

Runtime derivative identity after reproducible resize: warm `ee1c359490fc7169b9c467bed8e645872bf768834823e09d3e132c6ba65aff9f`; Twilight `d4676936b97a7a4134f4f2dde1457cd96ceaaa5d1efbd7233706fc8fd4d91f84`. Both decode as 1535×864 8-bit sRGBA PNG; decoded alpha ranges are warm 0–1 and Twilight 0–0.996078, confirming transparent and visible pixels survive. Derivative sizes are approximately 412 KB and 700 KB. These are image-file sizes, not decoded/GPU memory measurements.

## Runtime integration notes

One shared Three.js sky scene is rendered before the existing gameplay or Observatory city, with no DOM scenery, city/layout edits, or replacement of ground/shadows. Its gradient is static (so reduced-motion users get no sky animation); the 156-point star field is also static. Ordinary modes add three sky draw calls (gradient, one cloud image, stars); mode crossfades briefly show both cloud layers, for four. The old Observatory-specific gradient and 480-point star field are removed, so its steady scene gains one sky draw call net. A 1535×864 RGBA image is 5,304,960 decoded pixel bytes; the two source images total about 10.1 MiB before GPU mipmaps, potentially about 13.5 MiB with a full mip chain. These are theoretical storage estimates, not measured GPU allocation, frame time, or device budgets. SwiftShader captures verify appearance and rendering only, not target-GPU performance.

Cloud quads keep the approved aspect ratio and cover the sky height; portrait viewports crop the sides and bias the crop slightly toward the right cloud bank to retain visible cloud structure. The gradient and cloud blend respond to Audience/Twilight/Radiant state and Observatory applies reduced cloud opacity behind controls.

Both framed candidates decode as 1672×941 sRGBA with zero-alpha corners and feathered, non-opaque edges. Their nonzero-alpha bounds after the 80% transparent-canvas framing are 1262×661 at +208+137 (warm) and 1305×730 at +189+117 (violet). Candidate file sizes are about 453 KB and 780 KB. The original sources are about 675 KB and 1.18 MB. These are observed sizes, not an approved budget.

Rebuild the framed review candidates from their exact sources with `magick source.png -resize 80% -background none -gravity center -extent 1672x941 candidate.png` (ImageMagick; no package installation performed). Rebuild the WebP contact sheet with `bash assets/authoring/brightvale-sky/build-review.sh [new-output.webp]`; the default output is `sky-art-review.webp`, and an existing destination is refused rather than overwritten. The PNG intermediate is generated under temporary scratch and removed on exit. The sheet composites both candidate PNGs over representative mode gradients and over light and dark solids; these are illustrative, not runtime evidence. No alpha was removed or color-keyed. The violet artwork's painterly nebular texture is part of the approved candidate.

The runtime gate still requires actual-game captures in the three gameplay modes and both Observatory views, plus readable responsive compositions and lifecycle/performance verification. Any composite using gameplay screenshots is illustrative composition evidence only, not runtime evidence.
