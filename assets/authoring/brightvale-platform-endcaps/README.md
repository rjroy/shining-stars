# Brightvale platform end cap

## Current status

The user clarified that the earlier full-sheet failure conflated shape and placement: the isolated sculpted end-cap form may be viable, but the full render made it a hero piece instead of placing it at the platform corners. The intervening “long, low rails” direction is superseded. The user explicitly approved `endcap-only-candidate.png` and authorized a placement-only concept. **Placement review is pending.** No modeling or runtime integration is authorized.

## Approved shape reference

[`endcap-only-candidate.png`](endcap-only-candidate.png) is the **approved isolated shape reference**, retaining its recorded filename. It is a 1356 × 1159 RGB PNG with SHA-256 `370a7620a05301c5f800aa85aa5675537c1b2b82247a048454d67a23fc922b40`. Native original: `/home/rjroy/.codex/generated_images/01a12899-226a-77f1-9f4f-8f3590c73be3/exec-268174bc-8907-40d7-a1f4-00a4c78f2cd5.png`, byte-identical to the durable copy. Generated 2026-10-10 with `codex exec --skip-git-repo-check`, Codex CLI 0.162.1, session `01a12899-226a-77f1-9f4f-8f3590c73be3`. Both files were opened and decoded.

The image shows one sculpted/sloped midnight-blue form with gold edging in a three-quarter view on plain neutral ground. It contains no platform, pair, scene, people, text, labels, or additional panels. The form resembles the isolated earlier study, but this image establishes neither corner placement, dimensions, nor fit. No correction pass was made.

The generation prompt supplied exactly two images: `/tmp/opencode/brightvale-endcap-isolated-reference-20261010/previous-isolated-endcap.png` (isolated form crop) and `/tmp/opencode/brightvale-endcap-reference-crops-20261010/golden-left.png` (one mockup corner crop). No reference-limit error was reported; the route supplied no separate per-image receipt. The earlier full-sheet composite and all other references were excluded.

## Placement-only concept

The authorized next image shows the approved end-cap shape as a pair beside the unchanged accepted platform, placed at the lower outer corners and partly cropped in a plain-background view. Keep the platform dominant and the caps subordinate. No city, crowd, highway, mode variations, extra panels, or labels. Placement and relative scale are visual approximations only; exact dimensions, orientation, attachment, clearances, and transforms remain unresolved. Do not reopen the approved shape or claim fit validation.

- Review image: [`placement-only-candidate.png`](placement-only-candidate.png), 1200 × 750 RGB PNG; SHA-256 `821a19110d842fb98ec9fd93e7da689f29f79c5974693769151871228e00fbf2`. Placement approval pending.
- This is a controlled pixel composite, not a generated platform image: it uses the actual accepted platform preview unchanged and the approved end-cap source with its neutral background removed, uniformly scaled to 270 × 231 px and mirrored. The pair was composited at `(-100, 550)` and `(1030, 550)` over the 1200 × 800 platform preview; the output was cropped to 1200 × 750 so the caps are partly cut by the lower and outside edges. These are illustration pixel coordinates only—not Blender measurements or transforms. Composite source at `/tmp/opencode/brightvale-endcap-placement-work-20261010/placement-composite-final.png`, byte-identical to the maintained image.
- Created with ImageMagick 7.1.2-31 Q16-HDRI. The cap matte combines saturation and highlight masks, removes small isolated pixels, and is thresholded after resizing. The cap uses the approved source image without repainting; silhouette edges are affected by background removal and resampling. Placement follows the mockup's near-corner relationship. The platform pixels remain from the accepted preview except where the caps overlap its lower outer edge; the platform itself was not regenerated or reshaped.
- The user-authorized image-generation route was also tried once with exactly three inputs (`endcap-only-candidate.png`, the accepted platform Audience preview, and `golden-left.png`), using Codex CLI 0.162.1 on 2026-10-10, session `01a128a9-79cf-7b20-820a-3e88cfb5dccb`. Its native image `/home/rjroy/.codex/generated_images/01a128a9-79cf-7b20-820a-3e88cfb5dccb/exec-62c416f3-6d0e-4e9b-9250-4a7a65f90060.png` was inspected but not promoted: it altered platform details and cropped the caps at the side edges rather than the lower corners. No correction pass was made to that generated image.
- The accepted platform scratch copy `/tmp/opencode/brightvale-endcap-placement-references-20261010/platform-audience-preview.png` is byte-identical to `assets/authoring/neon-twilight-platform/mode-audience-preview.png`, SHA-256 `6e18148287d2cafde949aded257f63027096d52dca284fe89651b945598152e9`.

## Previous candidates retained as history

- `concept-candidate.png` — earlier full sheet, PNG 1536×1024, SHA-256 `c678754097c7cd1d8eb685eb90e900a18e7790f180ec70adec4a5550d5e84e44`. Native: `/home/rjroy/.codex/generated_images/01a12883-30ca-7450-9610-40d411c26c6d/exec-77cf558c-a28e-4743-9012-5f67ee6198fa.png`. Its composition/placement was rejected; the user later reopened its isolated sculpted shape as potentially viable, not approved. Its composite is not a reference.
- `concept-candidate-corrected.png` — intervening long-rail sheet, PNG 1536×1024, SHA-256 `e7bce4d10107099650aa55d0ac95edadca4a911d5c26dc031074c652af113088`. Native: `/home/rjroy/.codex/generated_images/01a1288e-72c2-75f2-8f5c-6a060fdf97be/exec-aff84fd5-3308-4d33-b176-d5c0dc2b0df3.png`. Superseded by the shape/placement clarification; do not use as a reference.

## Reference crop provenance

- Isolated form input: `/tmp/opencode/brightvale-endcap-isolated-reference-20261010/previous-isolated-endcap.png`, a direct crop `(x=770, y=85, w=310, h=265)` from `concept-candidate.png`. It contains one isolated object and its plain study background; the composite panel is outside the crop.
- Mockup input: `/tmp/opencode/brightvale-endcap-reference-crops-20261010/golden-left.png`, a direct crop `(x=0, y=561, w=520, h=380)` from `.lore/work/mockups/Golden City Rhythm Concert.webp` (1672×941; SHA-256 `852751ea354e62f65a2f2554fd153959d6aa43746d8315320d84e6a3ac9d7114`).
- Other preserved mockup crops: Golden right `(x=1152, y=561, w=520, h=380)` at `/tmp/opencode/brightvale-endcap-reference-crops-20261010/golden-right.png`; Twilight source `.lore/work/mockups/Neon Twilight Rhythm City.webp` (1536×1024; SHA-256 `1c1dbd8d887551e544daadea7305034f602049ede759400dce1783df790921a2`), left `(x=0, y=644, w=520, h=380)` and right `(x=1016, y=644, w=520, h=380)` in the same scratch directory.
- Crops decode original image pixels to PNG without synthesized content. These scratch crops are not maintained project assets; source paths, dimensions, hashes, and crop coordinates preserve the reproducible reference record.

The isolated shape approval is recorded above against its exact image checksum. The placement image remains a review proposal; it does not establish world scale, attachment, clearance, or runtime fit and does not authorize modeling.
