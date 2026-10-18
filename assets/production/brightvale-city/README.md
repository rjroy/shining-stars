# Brightvale city — native authoring and compressed runtime delivery

**Current runtime selection; imported CITY PBR materials approved.** The app loads [`city-meshopt.glb`](city-meshopt.glb), a losslessly Meshopt-compressed delivery of the spatially batched city. Compression changed no geometry, placement, camera, highway, source materials, or shadow policy. The subsequent city-only material decision is recorded below; no target-device performance or release approval is implied.

**Current material decision:** after an actual-app A/B comparison, the user explicitly selected **B, imported standard/PBR city materials**, rejecting the city Toon conversion. The normal runtime now uses owned clones of imported city materials. Actual-app verification confirmed Audience and settled Twilight match B and Observatory remains unchanged. Other game surfaces remain Toon; lights, renderer settings, camera, placement and highway are unchanged.

### Approved scope and preserved decisions

The user explicitly stated: **“The placement is perfect, but I agree that the geometry reduction needs to occur.”** Placement is accepted exactly as shown in [the actual existing-placement gameplay capture](evidence/consumer/gameplay-audience-existing-placement.png): external scale **.35**, translation **(0,3.9,-55)**, existing game camera/highway, including cropping and occlusion. **No reframing, city repositioning, camera or layout change is authorized or needed.** Earlier reviewer framing objections are no longer user blockers. This is placement acceptance and reduction authorization; visual validation is recorded in [the compressed normal-route browser review](evidence/consumer-compressed/REVIEW.md). No target-device performance claim is implied.

**Subsequent batching-only authorization:** after the actual reduced-candidate review found an Observatory performance regression, the user approved (“sure”) a bounds-limited batching revision. [SPATIAL.md](SPATIAL.md) records that process. The intermediate full/reduced/spatial GLBs are preserved locally in the gitignored archive listed in [archived-intermediates.json](archived-intermediates.json); their checksums and historical reports remain recorded. The maintained pipeline regenerates every stage from the immutable native master in a fresh workspace and does not read the archive.

**Lossless compression:** the selected file requires `EXT_meshopt_compression`; the runtime configures Three.js's bundled `MeshoptDecoder`. [`SPATIAL.md`](SPATIAL.md#selected-lossless-meshopt-runtime-delivery) records the verified chain. [`meshopt-manifest.json`](meshopt-manifest.json) records artifact identity and exact counts. Normal-route visual verification passed; GPU/performance and release certification remain outside this change.

The full, reduced, spatial, and initial compressed intermediate GLBs are retained locally under `assets/experiments/brightvale-city/production-intermediates/`; their exact hashes and former paths are listed in [`archived-intermediates.json`](archived-intermediates.json). That directory is gitignored. The committed reproduction pipeline does not depend on those local copies.

Superseded production comparison renders are preserved under `assets/experiments/brightvale-city/production-intermediates/evidence/`; [`archived-evidence.json`](archived-evidence.json) lists original/archive paths, sizes and hashes. The later material A/B decision evidence and current imported-PBR runtime screenshots remain in this package alongside historical reports and numeric comparisons. Historical screenshots/reports describe the consumer at capture time, not the current city shading contract.

## Deliverable and authority

- [`city-meshopt.glb`](city-meshopt.glb): **59,559,056 bytes**; SHA-256 **`db79454415423002bf87eb36d845a427f2c6c3e2dc4a3e63a05e4b2ded1be878`**; 2,589,764 triangles / 2,304 mesh nodes / 107 materials.
- Immutable input: [`../../authoring/brightvale-city/city.blend`](../../authoring/brightvale-city/city.blend), authoring commit `d37afb4`; SHA-256 `edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff`. User approved this exact native source (“great”, 2026-10-17); its documented interface limitations remain inherited.
- [`meshopt-manifest.json`](meshopt-manifest.json): current selected delivery identity, extension/decoder contract, and loader-equivalence counts. `manifest.json` retains the former full-baseline export record.
- [`material-map.json`](material-map.json): all **107** original-to-export material identities, values and semantic roles. Nothing collapsed to a shared palette.
- [`source-inventory.json`](source-inventory.json) and [`SOURCE-PREPARATION.md`](SOURCE-PREPARATION.md): historical measured inventory/proposal, superseded by this executed contract where proposals differed.
- [`validation.json`](validation.json), [`reproducibility.json`](reproducibility.json), and [`evidence/verification.json`](evidence/verification.json): historical full-baseline integrity, repeat-generation and image records; their comparison renders are in the local archive. [`production-chain-verification.json`](production-chain-verification.json) records the fresh full-to-compressed regeneration.

## Assembly contract

One identity scene root: **`CITY.ProvisionalLayout`**. Full physical families 01–07 remain, including architecture, terrain, bridges, water and planting. Every mesh node records `source_object` and `city_family`. Original object placement is preserved; modifiers are evaluated, not discarded or regenerated as primitives.

glTF **+Y up**, with exactly one exporter conversion: native `(x,y,z)` → `(x,z,-y)`. Origin remains `(0,0,0)`. Source units are provisional BU (`NONE`, scale 1), not an agreed physical meter. Do **not** apply another axis rotation. Accepted external game placement **scale .35 / translation (0,3.9,-55)** is **not baked** and must remain unchanged.

glTF world bounds: min `[-105.025733948, -13.647832870, -113.020690918]`, max `[103.477485657, 97.000503540, 52.164455414]`.

| Measured artifact resource | Count |
|---|---:|
| Unique mesh resources / mesh nodes / placements | 5,368 / 5,368 / 5,368 |
| Unique / placed triangles | **2,946,548 / 2,946,548** |
| Material primitives | 6,644 |
| Materials | 107 |
| GPU-instanced nodes / source true instances / source linked-mesh repeat groups | 0 / 0 / 0 |
| Position-accessor entries, summed once per accessor | 6,055,157 |
| Mesh nodes carrying UVs | 153 |
| Textures / external dependencies | 0 / 0 |
| Embedded binary buffer bytes | 161,977,520 |

These are historical static full-assembly/resource counts, **not** the current compressed delivery's frame-visible triangles, draw calls, decoded GPU memory, frame time or a device budget. Source exact duplicates were measured but not deduplicated; no false instancing savings are claimed.

## Materials and excluded presentation

All 107 used surfaces are constant Principled→Output graphs, with no image textures or procedural surface variation to bake. Base color, metallic, roughness, IOR, alpha, double-sidedness, emission, normals and existing UVs are retained. All surfaces, **including water**, remain opaque and double-sided, with zero transmission.

The genuine source material `Citadel detail | amber glazing 0` is named **`Window`** for the existing loader. All nine genuinely emitting glazing/amber materials have `city_role="emissive_window"`. Their original RGB **and original strengths (0.02–0.70)** are carried separately through `KHR_materials_emissive_strength`; no strength clamp or palette merge. `source_material` preserves original names, and `surface_role` keeps the descriptive functional category. Other `city_role` values remain descriptive (`city.masonry`, `city.roof`, `city.rock`, water subroles, etc.), not a vocabulary whitelist.

The installed exporter omitted extras on two evaluated material copies and gated opaque-water IOR behind unrelated extensions. The recipe deterministically restores the whitelisted extras and emits `KHR_materials_ior` for the three IOR-1.333 water materials. It also restores source emission factorization that the exporter folded into RGB. **These JSON-only corrections leave the binary geometry buffer byte-identical**; no lighting, color, transparency or geometry is invented. Three.js 0.186.1's installed GLTFLoader supports these extensions; actual consumer loading/appearance is a separate review.

Excluded from the physical GLB: **30 cameras, 18 studio/local lights, all world shaders, and `Low.ravine.mist.volume`** (12-triangle volume container). Authoring world gradients, fog, area lights, AgX and Cycles illumination are presentation, not portable material graphs. Their omission is explicit, not a claim that GLB alone reproduces the source mood. No unsupported procedural **surface** graph was flattened.

**Current city consumer contract:** `city.*` and `emissive_window` imported standard/physical materials retain their authored properties and maps through appearance-owned clones. Same-source reuse is cached; separate source materials are not collapsed by a Toon color signature. Borrowed source materials/textures remain untouched and undisposed, including those shared with Observatory. Nine window variants retain source emission strength multiplied by projected city brightness across Audience, Twilight and Radiant. All 107 city materials remain represented (104 standard, 3 physical); other game surfaces retain their existing Toon mapper and signature sharing.

Normal, roughness, metalness, AO, base-color and emissive maps on future imported city materials are retained by cloning; this asset currently has no image/normal maps. This removes the old CITY Toon-mapper forwarding limitation, not the need to validate future bake UVs, tangent conventions and actual appearance. No baking or lighting retuning is included. Standard/PBR response under the app lights is not a promise to reproduce Blender atmosphere or studio illumination.

[consumer-compressed](evidence/consumer-compressed/REVIEW.md) records the earlier decoder/compression check while gameplay city materials were still Toon. The selected PBR behavior was verified on the normal runtime path; no A/B capture harness or generated comparison artifacts are retained.

## Historical full-baseline verification

Blender **5.2.1 LTS**, official installed glTF exporter **5.2.40**, eight threads, bounded timeouts, from a non-repository cwd with absolute helper/source paths. Helpers import only their local `glb_checks.py`, standard library and installed Blender modules (including Blender's bundled NumPy); they do not import experiment or runtime helpers. Source SHA-256 was checked before/after; **no source save**.

- **10/10 unit tests**, including an ordinary mesh plus four instances (unique vs placed counts), linked meshes not mislabelled GPU instances, transforms/dependency guards, GLB round trips and sub-unit emission preservation.
- Two fresh-process full conversions: **byte-identical GLBs and material maps**, including canonical JSON+BIN semantic hash. This is measured same-machine/version determinism, not a cross-platform guarantee.
- Direct source-to-GLB comparison of **all 8,839,644 triangle corners**, material groups, transformed normals and UV-bearing corners. Maximum position-component error **0.0000265531 BU**, world-normal-component error **0.0000908810**, UV error **0**; exact overall bounds. Every material's numeric/semantic checks passed.
- Reopened GLB in a factory-empty Blender scene: 5,368 meshes, 107 assigned materials, correct root, exact native bounds, no cameras/lights/linked libraries. Blender's importer calls `mesh.validate()` and removes **four duplicate faces** in `Ravine water | unified connected routes`, yielding **2,946,544** reimport triangles. The source and GLB retain all **2,946,548**. Validation proves the water's unique triangle-coordinate sets remain identical (matched-vertex error 0); this is importer cleanup, **not export reduction**.
- Final commands exited **0**. No external buffer/image URI or experiment path occurs in the GLB JSON. Native unused-material append-history references are not transferred.

### Historical full-baseline transfer images

| View | Approved/native source | Reimported final GLB | Normalized RGB RMSE |
|---|---|---|---:|
| Audience, 1792×1008 | retained authoring image | historical GLB render (archived) | 0.00248004 |
| Twilight, 1792×1008 | retained authoring image | historical GLB render (archived) | 0.00198341 |
| Water neutral close view, 1600×1100 | historical native/render pair (archived) | historical GLB render (archived) | 0.00311746 |

All six historical images were decoded and visually inspected before archival. No missing/displaced city family, changed waterfall course, lost bridge opening, or obvious palette drift was observed. Small pixel/shading differences remain; **not pixel-identical**. The city-heavy `1600×600+100+400` crops give RMSE 0.00331098 / 0.00262763, so the comparison is not background-only. These are diagnostics, not approval thresholds. Same original cameras/rigs, Cycles 24 samples, same full-baseline GLB geometry in both moods. Original mist and studio lights were inspection context only, absent from the GLB. Neutral water disables atmosphere/local light anchors. The images are preserved in the local ignored evidence archive; they are historical Blender/PBR evidence, never browser/Toon evidence.

## Reproduction

The maintained chain starts from the unchanged approved native master, builds full → reduced → spatial → compressed in a **new workspace outside the repository**, then checks the decoded graph. It does not need the locally archived intermediates. Use installed Blender 5.2.1 LTS and project Node dependencies:

```bash
node assets/production/brightvale-city/reproduce-city.mjs \
  "/tmp/opencode/brightvale-city-reproduce-$(date +%s)"
```

The workspace must not already exist; the script refuses to place outputs inside this repository. It records all stage outputs and scratch there and refuses to overwrite a stage. The encoder verifies every input stream before packaging; the decoder compares the final GLTFLoader scene against the spatial GLB. The standalone `test_transfer.py`, `validate.py`, and earlier Blender render reports above document the former full-baseline pipeline and are historical evidence, not the current compressed-delivery acceptance test.

## Verification boundary

Actual-browser verification of the normal compressed route and approved city PBR behavior passed. Reproduce that bounded controlled smoke without a material override:

```bash
CITY_REVIEW_CONTROLLED=1 CITY_REVIEW_INTEGRATED_SMOKE=1 CITY_REVIEW_CURRENT_PBR=1 \
  CITY_REVIEW_VARIANT=meshopt timeout 150 \
  node tests/browser/brightvale/city-production-review.mjs
```

Placement, camera, highway, source materials, shadows and scene transforms remain unchanged. Gameplay city shading now uses the explicitly approved imported PBR response instead of Toon; historical checks must not be read as saying the consumer was always PBR. No renderer-performance gain is claimed from compression or this material selection, and the smoke was not a target-device benchmark. Existing raised/narrow right approach, static water and inherited local contacts remain as disclosed by the approved authoring source; this conversion neither repairs nor certifies them. This package is not a collision, navigation, hydrology or engineering certification.
