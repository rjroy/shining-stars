# Brightvale asset production record

Project-specific package map and evidence for future asset work. This document
does not authorize new production or establish budgets. Generic workflow,
tool-use details, and separate approval gates belong to the configured
asset-development plugin. Read each package README and its provenance before
reusing an implementation: the examples below are tied to their recorded
revisions and do not automatically establish present-day validity or approval.

## Asset locations and source authority

| Asset / role | Maintained location | Authority and current caveat |
| --- | --- | --- |
| Platform endcaps | [`assets/production/brightvale-platform-endcaps/`](../assets/production/brightvale-platform-endcaps/) | Completed GLB transfer/material pilot, not production-approved game integration or final-appearance approval. Immutable authoring source and approval history: [`assets/authoring/brightvale-platform-endcaps/README.md`](../assets/authoring/brightvale-platform-endcaps/README.md). |
| Distant city | [`assets/production/brightvale-distant-city/`](../assets/production/brightvale-distant-city/) | Full-city derivative recorded ready for assembled browser review under `shining-stars-4f4.31`; that status does not mean final appearance, device performance, or game integration is accepted. Authoring authority: [`assets/authoring/brightvale-distant-city/`](../assets/authoring/brightvale-distant-city/). |
| Approved replacement city source | [`assets/authoring/brightvale-city/`](../assets/authoring/brightvale-city/) | User-approved native editable master copied byte-for-byte from the Brightvale experiment; intended to replace the current distant city after separate production and integration gates. Existing `brightvale-distant-city` authoring source and `assets/production/brightvale-distant-city/produce.py` remain unchanged and continue to identify the old source until a separately authorized production change. See the new package README for hash, references, bounds, limitations, and checks. |
| Crowd | [`assets/production/brightvale-crowd/`](../assets/production/brightvale-crowd/) | Reduced static nine-pose bank prepared for combined browser review. Static is a scoped review choice; required future motion and runtime population remain unresolved. Source rigs/variants: [`assets/authoring/brightvale-crowd/variants/README.md`](../assets/authoring/brightvale-crowd/variants/README.md). |
| Structure layout | [`assets/production/brightvale-structure-layout.json`](../assets/production/brightvale-structure-layout.json) | Assembly transform authority for the recorded combined review; preserve documented transforms and apply each exactly once. |
| Combined browser review | [`assets/production/brightvale-scene-review/`](../assets/production/brightvale-scene-review/) | Isolated Three.js 0.186.1 review harness and paired captures, not game integration, runtime acceptance, or target-device benchmark. |

The maintained detailed `.blend` and original authoring/generator scripts are
the source authority where package READMEs say so. Production derivatives,
export scripts, validation and selected evidence live in the production
packages. Do not create duplicate derivatives simply to repeat an established
path. Existing files may have changed since their documented snapshot; check
their current README, hashes, and status rather than treating this summary as a
live inventory.

## Recorded production examples (historical evidence)

These are measured results from documented packages, not approved performance
targets, universal thresholds, or authorization to repeat their work.

- **Endcaps — transfer baseline.** At the recorded pilot, Blender 5.2.1 LTS
  and exporter 5.2.40 produced a 138,388-byte GLB with 2,568 triangles. Direct
  exported positions matched evaluated source (maximum position error 0); the
  maximum direct normal-component error was 0.00006286. The source contains 14
  inherited near-zero-area triangles; the pilot did not remove them. No browser
  draw-call or target-device budget was established. README: [`brightvale-platform-endcaps/README.md`](../assets/production/brightvale-platform-endcaps/README.md).
- **City — bounded facade reduction.** The documented derivative retained 221
  objects, 196 placements, 64 unique meshes and all 21 districts. Placed
  triangles changed from 500,928 to 216,633 (56.8% fewer); GLB bytes changed
  from 7,063,500 to 3,359,324 (52.4% fewer). The comparison-sheet silhouette
  IoU was 1 with zero differing pixels; these are geometry/study-view findings,
  not browser appearance approval. Its 1600×900 study view inherited a spire
  crop of 187 px. Units were provisional, not agreed meters. README:
  [`brightvale-distant-city/README.md`](../assets/production/brightvale-distant-city/README.md).
- **Crowd — reduced static pose bank.** Nine poses changed from 50,520 to
  18,214 triangles (63.95% fewer); the assigned three-pose lineup was 6,072
  triangles. At a documented study camera, ten full projected bodies measured
  65.60–149.70 px; this is projected bounds, not visible pixels after
  occlusion. Geometry occupancy IoU worst case was 97.5945%. Required animation,
  runtime scale, final population and device performance were unresolved in the
  README. Its 25-person combined-review composition is explicitly not an
  approved final count. README:
  [`brightvale-crowd/README.md`](../assets/production/brightvale-crowd/README.md).
- **Combined browser review — historical capture.** The pipeline reference
  records 401,581 assembled-scene triangles, 401,177 rendered-frame triangles,
  and 485 draw calls under local SwiftShader. These are capture-specific
  measurements, not budgets or device claims. The harness distinguishes
  assembled placements, instanced multiplicity, frame visibility/culling, draw
  calls, and decoded resource storage. Review README:
  [`brightvale-scene-review/README.md`](../assets/production/brightvale-scene-review/README.md).

The pipeline examples were pinned in their source reference to commit
`0a38b74` (`shining-stars-4f4.31`). Treat their scripts, paths, and results as
evidence from that revision, not guaranteed current APIs or exporter recipes.
In particular, GLB transfer and loader success establish structural
compatibility, not accepted browser appearance. The recorded browser study
used shared material-role mapping and paired Audience/Twilight captures; its
toon treatment deliberately did not reproduce PBR metallic/roughness response.
Local SwiftShader metrics are not hardware benchmarks. Frustum intersection
alone does not establish that a crowd figure is visible or unobstructed.

## Reference documents

- [Approved visual direction and mockup context](asset-direction.md), plus the
  [approved highway design record](../.lore/work/design/brightvale-perspective-highway.md).
- [Beat-chart workflow](beat-chart-workflow.md), [scoring system](scoring-system.md),
  and [save-data documentation](save-data.md) are existing project docs; they
  describe adjacent game systems, not asset approvals.
- Historical provenance: the production-pipeline reference was originally at
  `.agents/skills/asset-production/references/brightvale-production-pipeline.md`;
  its relevant example measurements and caveats are preserved above. This is
  intentionally retained as a historical source-path record, not a live link.
