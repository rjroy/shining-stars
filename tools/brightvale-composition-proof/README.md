# Brightvale runtime composition proof

An isolated Chromium/SwiftShader proof of the current runtime composition. It loads all seven production GLBs through `loadBrightvaleRuntimeAssets`, assembles `BRIGHTVALE_RUNTIME_LAYOUT` with `createBrightvaleComposition`, and uses the accepted shared appearance implementation. It does not wire the game scene, UI, scoring, or frame loop.

## Current evidence

- `audience-reference.webp`, `twilight-reference.webp`, `audience-narrow.webp`, `twilight-narrow.webp` are the four current captures. Each pair uses the same camera position and orientation; the reference view uses the layout camera and 1600×900 view, and the narrow sample uses 1120×700 with an 896×568 scene viewport and persistent HUD reservations.
- `report.json` keeps assembled scene-tree triangles separate from actual `renderer.info` triangles and draw calls. It also records source mesh counts, repeated batch/instance totals, group bounds, camera values, scene-crop Audience/Twilight pixel differences, and per-person occlusion-aware ID-pass pixel counts.
- `main.js`, `index.html`, and `validate.sh` are the isolated proof harness and validator.

The captures keep the four-lane platform prominent in the foreground, with the skyline and crowd supporting rather than competing with it. Audience and Twilight change visible scene geometry under the same camera, not just the backdrop. The depth-tested ID pass finds no fully occluded person in either viewport. One review-fill person has only 18 visible pixels in the narrow sample; partial visibility is allowed, but this is a small visual remnant rather than strong crowd legibility. No camera or placement changes were made to conceal it.

The current report verifies computed vertex normals on both generated ground surfaces. Captures are generated from the current runtime composition; no provisional ground-normal caveat remains.

The crowd pass assigns each placement an ID color across its instanced primitives, then renders the complete assembled scene with depth testing. A placement is reported fully occluded only when none of its ID pixels survive. Partial visibility is acceptable. The report is a visual review aid, not a semantic visibility score.

## Run

```bash
tools/brightvale-composition-proof/validate.sh
```

Uses the already-installed Vite, Chromium, Three.js, and WebP support. It starts a fresh loopback server, sets `VITE_SONG_VOLUME=0`, clears prior evidence before running, and verifies the owned listener is gone on exit. Failure scratch is retained under `/tmp/opencode`.

## Limits

The narrow view is one tested sample, not a minimum viewport guarantee. SwiftShader captures do not establish target-device performance or a hardware budget. Renderer counters are for the rendered frame; assembled triangle count is geometry inventory and does not account for culling or visibility.
