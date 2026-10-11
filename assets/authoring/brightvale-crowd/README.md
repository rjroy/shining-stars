# Brightvale crowd

The approved direction is the [clean cel-shaded crowd concept](concept-cel-shaded-candidate.webp), with contemporary clothing and player-facing poses. The [brief](brief.md) records the composition and reference constraints.

Concept approval: the user selected “Keep contemporary clothing” and “Approve concept” on 2026-10-10. The retained 1536 × 1024 WebP is a user-converted derivative, SHA-256 `1c21fefe24828f2a70f57afb12a4cea817fba02b1008ff95d6dbd950320e5a05`. It derives from the Codex CLI 0.162.1 generation in session `01a1283e-9321-7321-a3a5-e8c9b0d146d6`; original PNG SHA-256 `ade9b333eb1db3247fac96d61e356ae9a0fd905de70f3bcd74751b9cce3176e3`. The original PNG is not a maintained package dependency. Composite scenery is context, not approved crowd geometry or validated runtime appearance.

## Current authoring assets

- [`neutral-base/`](neutral-base/README.md) — approved corrected T-pose character source: [`character.blend`](neutral-base/character.blend).
- [`rigged/`](rigged/README.md) — accepted rig and reviewed single-frame `Pose.Rest`, `Pose.Cheering`, and `Pose.Reaching` references: [`rig.blend`](rigged/rig.blend).
- [`variants/`](variants/README.md) — approved three-character set with distinct hair, clothing and poses: [`variants.blend`](variants/variants.blend).

Each child README documents its source, evidence, checks, and reproduction steps. The approved base hash is `800ef1f869e69489e0ae049b2c952bfcbe227be17614e21843008aa19e5b33f8`; the accepted rig hash is `6758bb60c96ec14e912d71c06dc78dbfde4b46c57d9d05ccfd6d4c94ff74f1cb`.

These approvals cover the base, rig, reviewed authoring poses, and representative three-character set. Full crowd population, density and final placement remain open. Runtime animation, export, and integration are not authorized. The [saved character-pipeline research](../../../.lore/work/research/stylized-crowd-character-pipeline.md) records reusable findings; it is not a reproduction dependency.
