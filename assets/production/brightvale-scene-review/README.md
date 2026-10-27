# Brightvale shared-scene browser review

This historical Three.js 0.186.1 harness reviewed the shared city, highway, platform, endcaps, framing and ground assets against a structure JSON that has since been retired. Its default layout input is no longer available; current gameplay layout is maintained in `src/rendering/brightvale/layout.data.ts`. Crowd GLB loading, placement, visibility and batching have been retired; crowd is reviewed through the current waist-up atlas/runtime pipeline instead. The historical review is not game integration, final runtime acceptance, or a target-device benchmark.

## Current harness

`main.js` loads and validates the six shared playfield/city GLBs, applies their recorded transforms, batches city/framing geometry, and captures the unchanged audience/twilight lighting modes. `validate.sh` runs the isolated browser check and a negative invalid-playfield-GLB route. It does not load or recreate deleted crowd assets.

The former crowd-inclusive report and screenshots were superseded when this harness was rerun without the 3D crowd. Current `report.json` and the two maintained WebP captures describe the six-GLB shared scene only; they contain no crowd placement or visibility evidence.

Run from the repository root:

```sh
assets/production/brightvale-scene-review/validate.sh
```

The script uses already-installed repository Vite, Chromium, Prettier and ImageMagick. It writes captures/report in this directory and uses `/tmp/opencode` for scratch. No dependencies are installed.

Metrics from this harness are local review evidence only, not GPU-memory or target-device performance estimates. It preserves the existing camera, playfield tilt, ground, enclosure and skyline framing.
