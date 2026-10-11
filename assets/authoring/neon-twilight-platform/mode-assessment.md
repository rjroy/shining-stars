# Platform mode suitability — Audience and Twilight

**Purpose:** appearance assessment of the exact saved approved platform model under two temporary studio-light treatments. These previews are for user review; they are not gameplay captures, model revisions, runtime-fidelity evidence, or approval of another layer. The existing v8.3 source, concept, generator, preview script, and validator were not modified.

## Evidence

- Audience: [`mode-audience-preview.png`](mode-audience-preview.png)
- Twilight: [`mode-twilight-preview.png`](mode-twilight-preview.png)
- Both PNGs decoded at 1200 × 800 and were visually inspected. SHA-256: Audience `6e18148287d2cafde949aded257f63027096d52dca284fe89651b945598152e9`; Twilight `f7faab6cdaa9b84f599cd6960fbdf7a1ccc32453668c6658ac88a5fdcc4d3f25`.
- Reusable read-only renderer: [`mode-preview.py`](mode-preview.py)
- Source: `platform.blend`, SHA-256 before and after rendering: `ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af` (unchanged; matches the approved source recorded in `README.md`).
- Blender 5.2.1 LTS, Cycles, 32 samples, 1200×800 PNG, AgX, exposure 0, unchanged compositor. Both views use the saved `Camera | concept v4 comparison`: perspective, 50 mm, location `(0, -16, 12.5)`. This is the existing asset-comparison camera, not a validated gameplay camera.
- Source geometry: 59 scene objects / 45 meshes; excluding studio ground, bounds are 12 × 5.5 × 1.145 authoring units. The saved model contains distinct chassis/crest, gold frame, four lane-glass, lane-edge, hit emitter/rim, and inlay materials. Pure hit emitters and colored lane materials retain their authored color in both modes.

## Temporary presentation changes

Only in-memory studio presentation values changed between renders: the four existing studio-light colors and energies, world background color/strength, studio-ground base color, and PNG output settings. RGB values below are Blender linear values.

| Mode | World RGB / strength | Ground RGB | Key RGB / energy | Fill RGB / energy | Rim RGB / energy | Front RGB / energy |
|---|---|---|---|---|---|---|
| Audience | `(0.10, 0.055, 0.022)` / `0.32` | `(0.050, 0.030, 0.018)` | `(1.00, 0.72, 0.43)` / `330` | `(1.00, 0.78, 0.54)` / `225` | `(1.00, 0.48, 0.22)` / `180` | `(1.00, 0.86, 0.68)` / `150` |
| Twilight | `(0.010, 0.012, 0.050)` / `0.28` | `(0.012, 0.016, 0.050)` | `(0.58, 0.63, 1.00)` / `300` | `(0.32, 0.42, 1.00)` / `260` | `(0.62, 0.30, 1.00)` / `255` | `(0.48, 0.58, 1.00)` / `135` |

Geometry, camera, model material nodes/slots, color management, and compositor were left unchanged; the source blend was never saved. The full settings and runtime manifest are also in `/tmp/opencode/shining-stars-4f4-4-2-1/renders/mode-preview-manifest.json`.

## Assessment for user acceptance

**User decision (2026-10-10): “Accept shared platform”.** The current model is accepted for both Audience and Twilight based on the paired previews above. Tune final mode lighting during runtime integration; this is not runtime appearance approval or approval of the missing end caps.

**Audience suitability: plausible without rebuilding the model.** Under warmer lighting the metallic gold rails and warm lane read become more welcoming while the four distinct cyan, magenta, amber, and green lanes remain legible. The amber lane and gold framing are visually strong and may feel more ceremonial than soft/welcoming, but this is a presentation preference, not a geometry defect. The platform's current geometry and material separation provide useful control for a future mode treatment.

Twilight remains cooler and darker with the same geometry, while the gold trim and fixed lane hues continue to show through. This is a lighting-based study only; the four emissive lane colors are not switched by the temporary setup. Whether the game should additionally change material response is untested and not decided here.

The matched camera makes the two studio renders directly comparable, but it is an elevated product/comparison view of the standalone platform. It does not establish the platform's appearance, fit, or readability in the approved low game camera with highway, crowd, city, HUD, and controls. Blender's Cycles, AgX, emission and compositor do not establish Three.js/GLB appearance. No export or runtime change was made. Shared-model suitability is accepted; runtime acceptance remains separate.

## Reproduction

From the repository root, use a new scratch directory for each run:

```bash
blender --background "$PWD/assets/authoring/neon-twilight-platform/platform.blend" \
  --python-exit-code 1 \
  --python "$PWD/assets/authoring/neon-twilight-platform/mode-preview.py" \
  -- --output-dir /tmp/opencode/<new-unique-directory>
```

The script refuses a non-approved source, unexpected camera/light rig, non-scratch output path, or an existing output directory. It renders only the two named previews and exits without saving the source.
