# Brightvale city — approved editable authoring master

## Status and authority

This is the byte-preserved native Blender master from the approved Brightvale city experiment. The user approved this exact scene on 2026-10-17 (“great”) after the right approach and water/interface limitations were disclosed. This approval is for the editable source, not a production derivative, runtime integration, runtime acceptance, performance target, or engineering certification.

- Master: [`city.blend`](city.blend), 26,693,060 bytes, SHA-256 `edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff`.
- Exact source: `assets/experiments/brightvale-city/finishing/model/candidate.blend`; it remains in place and unchanged.
- Blender: 5.2.1 LTS. The scene uses provisional Blender units (BU), not agreed physical scale.
- Family 01–07 bounds: `(-105.026, -52.164, -13.648)` to `(103.477, 113.021, 97.001)` BU; 5,368 meshes in these families.
- Intended use: replacement authoring source for the existing distant city, ahead of production preparation. The existing `assets/authoring/brightvale-distant-city/` and its production consumer remain untouched until a separately authorized production/integration change.
- Production and runtime status: pending. Do not infer game-camera fit, device performance, or runtime readiness from this authoring approval.

## References and authority hierarchy

The approved concepts are copied here so this package does not require experiment files to inspect its visual references. They guide character and relationships; they are not measured construction drawings or a pixel-exact contract.

1. [`references/city-reference-four-panel.webp`](references/city-reference-four-panel.webp) — original full-city composition and placement authority.
2. [`references/citadel-approved-large-left.png`](references/citadel-approved-large-left.png) — approved citadel; the large left panel is authoritative, smaller panels are supporting studies.
3. [`references/ravine-crossing-approved-upper.png`](references/ravine-crossing-approved-upper.png) — approved crossing; upper panel is authoritative, lower routing study is supporting interpretation only.
4. [`references/paired-districts-approved.png`](references/paired-districts-approved.png) — approved left/right district studies; contextual landmark drift does not supersede the approved citadel/crossing.
5. [`references/skyline-corrected-approved.png`](references/skyline-corrected-approved.png) — corrected approved subordinate skyline vocabulary only. Placement and overlap come from the full-city reference. The failed initial skyline sheet is not included.
6. [`references/water-vegetation-approved.png`](references/water-vegetation-approved.png) — approved supplemental water/planting relationships; concealed routing, roots, and joins remain interpretation.
7. [`references/lighting-direction-comparison.png`](references/lighting-direction-comparison.png) — approved lighting direction only. The edited image has disclosed architecture/foliage drift and is not an architectural or geometry authority.

The [`evidence/`](evidence/) directory keeps two actual final Blender mood renders, the matched water-side before/after sheet, and the independent [authoring verification report](evidence/authoring-verification.json). Render images are source-scene evidence, not runtime captures. The manifest records source paths, exact byte counts, and SHA-256 checksums for the master, each copied reference, and each evidence file. The report also discloses weak, non-loading references to an experiment checkpoint retained in Blender material provenance; the data-blocks are local, and this is not a linked-library dependency. References should remain distinct from actual model renders.

## Model evidence and limitations

The model contains eight named city families. The source scene has 5,417 total objects and no external Blender libraries, images, or fonts. The family 01–07 measurement above excludes cameras, lighting, atmosphere, and inspection-only collections. `validate.py` checks the packaged hash, family presence, finite mesh data, measured family bounds, and common external image/font/library dependencies; it does not repeat the experiment's baseline-fingerprint or exhaustive interface tests.

Known limits carried with the approved source:

- Water is a stylized static surface, not a fluid simulation.
- The far-right approach remains locally raised/narrow; inherited stair/sidebank and downstream water contacts remain outside the bounded correction.
- The assembly is not asserted to be a watertight union, collision-free, fully navigable, physically scaled, structurally certified, or hydrologically solved.
- No exact game-camera match, runtime suitability, performance measurement, production export, or integration is claimed.

See the [experiment record](../../experiments/brightvale-city/README.md) and [detailing retrospective](../../../.lore/work/retros/brightvale-city-detailing-experiment.md) for the preserved history. The experiment's other checkpoints, full preview history, one-off construction scripts, and detailed validation reports remain in place; they are not copied into this maintained authoring package.

## Portable checks

Run from the repository root using Blender 5.2.1 LTS and Python 3 (standard library only):

```bash
PYTHONDONTWRITEBYTECODE=1 python3 assets/authoring/brightvale-city/test_package.py
blender --background assets/authoring/brightvale-city/city.blend \
  --python-exit-code 1 --python assets/authoring/brightvale-city/validate.py
```

For a fresh Audience/Twilight pair, create an empty scratch directory outside this package, then run:

```bash
blender --background assets/authoring/brightvale-city/city.blend \
  --python-exit-code 1 --python assets/authoring/brightvale-city/preview.py -- \
  --output-dir /tmp/opencode/brightvale-city-preview --mode both
```

`preview.py` uses the saved `Camera.Reference` and existing Audience/Twilight worlds and lighting collections. It changes render state in memory only, writes only new PNGs to the specified existing scratch directory, and verifies the `.blend` hash before/after. It does not save or modify the source. `test_package.py` tests manifest hash/size verification and path traversal protection without copying or opening the large scene.

### Independent execution verification — 2026-10-17

From `/tmp/opencode/brightvale-authoring-independent-check`, absolute-path helper execution passed **5/5 tests**, reopened scene/package validation, and **both actual Audience/Twilight renders** (Blender 5.2.1 LTS, 8 threads, Cycles 24 samples, 1792×1008; final exits 0). Both fresh images and both retained approved images were decoded and visually inspected. Each matching pair has **zero differing pixels and RMSE 0**; the existing approved evidence is therefore retained without duplicate renders. The master SHA-256 before/after remains `edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff`. Commands, results and limits are in [`evidence/authoring-verification.json`](evidence/authoring-verification.json). Only the verifier's newly created scratch files were cleaned; no packaged or old experiment files were deleted.

**Path-reference qualification:** no linked Blender libraries or external image/font/media dependencies were found, and helpers import only local `package_checks.py`, standard-library modules and Blender modules. However, `Water | falling sheets` and `Water | receiving lips` retain `library_weak_reference.filepath` values pointing to the old experiment's `landscape/model/checkpoints/approved-skyline-city.blend`. Blender identifies these as append-reuse history; both materials and their node trees are local, not linked loading dependencies. Thus the package works independently of repository cwd, but **“zero experiment path references” would be inaccurate**. Removing that history would require an explicitly authorized resave and a new master hash; none was performed. The experiment tree was not hidden or removed during this verification. Production remains unstarted.

## Consolidation inventory — no deletions performed

| Disposition | Content | Measured size |
| --- | --- | ---: |
| KEEP/COPY | `city.blend` | 26,693,060 bytes |
| KEEP/COPY | Seven approved reference images | 16,573,696 bytes total |
| KEEP/COPY | Three selected final evidence images | 6,419,126 bytes total |
| KEEP/COPY | Manifest | 5,109 bytes |
| KEEP/COPY | Four portable helper/test source files | 13,409 bytes total |
| MEASURED | Master, references, and selected evidence (11 files) | 49,685,882 bytes total; README and supporting checks excluded. |
| LEFT IN EXPERIMENT | Original approved `candidate.blend`, preserved byte-for-byte at its source path | 26,693,060 bytes |
| LEFT IN EXPERIMENT | Three construction checkpoints | 79,647,834 bytes total |
| LEFT IN EXPERIMENT | Ten incremental/helper scripts, including validation helpers that depend on sibling experiment data | 47,560 bytes total |
| LEFT IN EXPERIMENT | Full 27-file preview history, including source comparisons and superseded views | 59,910,303 bytes total |
| LEFT IN EXPERIMENT | Remaining experiment records and intermediate evidence | Finishing package total: 169,023,378 bytes across 55 files. |

This is a non-destructive authoring copy. A 6,370-byte Python import cache was incidentally generated during validation; it is not source inventory. No old authoring source, experiment file, checkpoint, runtime path, or production script was overwritten, removed, or retargeted. Any later cleanup or runtime replacement requires its own authorization and verification.
