---
title: Brightvale city high-to-low detail and download experiment
date: 2026-10-18
status: draft
tags: [brightvale, city, geometry, textures, visual-review, export, download-size]
related: [.lore/work/retros/brightvale-city-detailing-experiment.md]
---

# Brightvale city high-to-low detail and download experiment

The user authorized a bounded facade pilot, then an extension across suitable shallow city details. After review, the user accepted the pilot's softer visual result, then stopped further high-to-low work in favor of current direction and download priorities. Neither candidate was promoted. The current 59,559,056-byte shipping GLB remains unchanged.

The pilot changed a small surround/bar prototype from 840 to 180 triangles. Its softer detail was accepted in the reviewed views. The pilot control and candidate used the same exporter; the pilot candidate did not replace the shipping asset.

The whole-city candidate reduced geometry from 2,589,764 to 2,323,960 triangles (265,804 fewer, 10.26%). In the same-exporter comparison, primitives rose from 2,304 to 2,458, materials from 107 to 118, and gameplay render calls from 2,536 to 2,690. Decoded geometry buffer-view bytes fell from 136,043,244 to 133,318,836. Four 1024×512 PNG maps totaled 92,583 encoded bytes; the estimated RGBA8 texture cost was 8 MiB, or 10.67 MiB with mipmaps.

Despite fewer triangles and decoded geometry bytes, the compressed candidate grew from 63,253,793 to 64,264,237 bytes, an increase of 1,010,444 bytes. No per-buffer analysis was done, so the increase is unexplained; it is not attributed to the textures alone. The GLB values compare the two experiment exports, not the unchanged shipping asset.

The temporary game comparison found no broad regression in the sampled views. Emission was sampled at stepped states, not validated as a real-time transition. The run used SwiftShader, not target hardware, and does not establish device performance. The native and exported candidates, comparison captures and test outputs have been discarded; the Blender production source and shipping GLB were retained unchanged.

A broader shared workflow update was planned during the experiment, then canceled with the high-to-low work. No shared skills were changed. These observations describe this bounded experiment and do not establish an overall performance win or explain the compressed-size increase.
