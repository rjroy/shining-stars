# Brightvale — bounds-limited batching candidate

**Historical spatial-batching report; its large GLB is locally archived.** User approved (“sure”) the bounded batching revision after the first optimized candidate's Observatory regression. The current runtime selects the byte-exact compressed delivery `city-meshopt.glb`, derived from this spatial result; actual-browser review is pending. No geometry, placement `.35 / (0,3.9,-55)`, camera/highway, cropping, occlusion, material or shadow policy changed.

## Candidate and protected inputs

- Spatial intermediate (local archive): **135,037,616 bytes**, SHA-256 **`73022af6f2bc45e38cd5bcbb7eb03f24cfacdd43d9b3f715e91f489fe0e464ff`**.
- Reduced and full source intermediates are in the same local archive; exact filenames, former production paths, sizes and hashes are in [archived-intermediates.json](archived-intermediates.json).
- Immutable authoring: `../../authoring/brightvale-city/city.blend`, SHA-256 `edec71ce0b04189bcee6d7f98d14ad057be37ad6758bba9524a333819a34caff`.
- Existing `batch-coverage.json`, SHA-256 `f2c41820dbe2964513edb955c06b8b42a2ee598c34bdd8a9fe4af5d266dd0751`, identifies the original reduced source primitives' contiguous triangle-index ranges inside the previous batches. It is retained unchanged and is a reproducible input, not reconstructed by eye.

[`spatial-manifest.json`](spatial-manifest.json), [`spatial-config.json`](spatial-config.json), [`spatial-coverage.json`](spatial-coverage.json) and [`spatial-validation.json`](spatial-validation.json) identify the result and complete ownership/verification. The original [107-material map](material-map.json) applies unchanged.

| Resource | Previous optimized → spatial candidate |
|---|---:|
| Unique / placed triangles | **2,589,764 / 2,589,764 → exactly the same** |
| Mesh resources / single-material primitives | 1,116 → **2,304** |
| GPU-instanced nodes | 0 → 0 |
| Material dictionaries | **107 → 107, exactly equal** |
| Original objects / reduced material pieces accounted for | **5,368 / 6,644**, unchanged |
| Serialized GLB bytes | 136,641,564 → **135,037,616** |

These are asset/resource counts, **not new observed renderer calls or timings**. The reduced geometry remains substantial; this is not a shipping-size/performance claim.

## Selected lossless Meshopt runtime delivery

At the user's explicit request, the selected spatial GLB was compressed without geometry simplification, quantization, filtering, attribute/index reordering, or triangle changes. The archived spatial input remains byte-identical.

- Runtime delivery: [`city-meshopt.glb`](city-meshopt.glb), **59,559,056 bytes** (56.8 MiB), SHA-256 **`db79454415423002bf87eb36d845a427f2c6c3e2dc4a3e63a05e4b2ded1be878`**. That's **44.1055%** of the input (55.8945% smaller), below the 90 MiB / 94,371,840-byte delivery gate.
- Uses installed `meshoptimizer` **1.1.1**, `EXT_meshopt_compression` version-0 streams: 4,643 `ATTRIBUTES` views and 2,304 `INDICES` views. Generic `INDICES` mode was chosen to preserve each index byte exactly rather than risk triangle-codec rotation. No meshopt filters are used.
- The extension is listed as both used and required; uncompressed fallback data is omitted. Each input stream was decoded and compared byte-for-byte before packaging. Non-compression glTF JSON metadata is preserved, including all accessor, scene, node, mesh, primitive, material, extras, and bounds data.
- Tested against Three.js 0.186.1 `GLTFLoader` with its bundled `MeshoptDecoder`: decoded graph equals the original for all 2,304 meshes/geometries, **2,589,764 triangles**, all material assignments/properties, and 107 materials. An explicit runtime regression test confirms corrupt compressed data rejects and acquired textures are released.
- The extension is required and has no uncompressed fallback. The runtime configures the bundled decoder and selects the maintained compressed file. Actual-browser Observatory/Audience/settled-Twilight review passed; no target-device performance claim is inferred. See [consumer-compressed/REVIEW.md](evidence/consumer-compressed/REVIEW.md).

Reproduce the full authoring-to-delivery chain from repository root into a new workspace (the script refuses existing workspaces and does not require the local archive):

```bash
node assets/production/brightvale-city/reproduce-city.mjs \
  "/tmp/opencode/brightvale-city-reproduce-$(date +%s)"
npm run test:brightvale:meshopt
```

The pipeline emits full → reduced → spatial → compressed stages in the workspace, computes input hashes for the spatial config, checks streams byte-for-byte, and verifies the compressed delivery through GLTFLoader. `meshoptimizer` 1.1.1 is an explicit development dependency; the decoder comes from the installed Three.js distribution. No decoder download or compression fallback is involved.

## Why this partition, not merely a smaller grid

The [actual-app comparison](evidence/consumer-optimized/REVIEW.md) found gameplay calls 6,876→1,348 and submitted triangles 3,132,176→2,775,392, with roughly 10–11% shorter software-rendered intervals. Observatory instead changed 4,353→915 calls but **1,804,124→2,395,945 submitted triangles** and approximately **34% longer intervals**. These prior measurements use SwiftShader, not target-device hardware; their complete conditions remain in the retained reports.

The former grouping used a 32-BU cell assigned by primitive center, with **no limit on the combined bounds**. The installed Three.js `GLTFLoader.js:4833–4840` builds a culling sphere from the **AABB center and half its diagonal**, not a tight vertex-distance sphere. Thus even depth extent can make an offscreen vertical/horizontal batch intersect the Observatory crop. The actual Observatory uses scale .18 / translation (0,-2.85,-7), camera (0,0,16), orthographic horizontal bounds ±12.8 and vertical bounds ±5 at 1440×900. Gameplay uses the recorded accepted perspective camera and original float32 city matrix. None are modified.

[`spatial-analysis.json`](spatial-analysis.json) evaluates only three candidate configurations, without exporting candidate GLBs. It uses the installed loader's box-diagonal sphere rule, original object maximum-axis scale where needed, and those actual frusta. No occlusion, UI masking, shadow/other-scene work or timing model is included. **All numbers in this table are offline city-only proxies, not observed renderer results.**

| Configuration | Asset groups | Observatory intersecting-group proxy | Observatory submitted-city-triangle proxy |
|---|---:|---:|---:|
| Full original material primitives | 6,644 | 4,349 | 1,803,775 |
| Retained 32-BU center-only optimized | 1,116 | 915 | 2,395,945 |
| Reduced primitives, no batching | 6,644 | 4,345 | 1,585,495 |
| **Selected: cell 16 / maximum span 24 BU** | **2,304** | **1,606** | **1,740,485** |
| Cell 8 / maximum span 12 BU | 4,254 | 2,848 | 1,626,473 |
| Cell 4 / maximum span 8 BU | 5,665 | 3,778 | 1,603,526 |

The retained optimized Observatory proxy happens to match its measured city-containing invocation exactly; this is useful diagnosis, **not proof that a new proxy predicts actual performance**. The full-baseline proxy differs slightly from its observed counters. All reduced configurations have gameplay city-triangle proxy **2,589,744**, essentially the same geometry submission; finer grouping mainly increases gameplay group count.

The selected 16/24 configuration removes most of the modeled Observatory over-submission while retaining substantially fewer groups than the full baseline. The 8/12 choice avoids another 114,012 proxy triangles but adds 1,950 groups (nearly doubles them); 4/8 has still smaller marginal triangle benefit. This is a bounded tradeoff for actual measurement, **not an invented budget or a promise to eliminate the regression**. Gameplay may pay more per-group overhead than the first optimized candidate.

## Exact geometry-preserving method

1. Read the preserved optimized GLB, not the native model or a lower-detail generator. Recover all **6,644** original reduced material primitives using the retained index-range coverage. Compact each piece to **only its referenced vertices**; never carry the old broad batch's unused vertex pool into a smaller group, which would create false large bounds.
2. Keep exact material, city family and attribute-layout boundaries. Bucket eligible pieces by 16-BU center cells, then use deterministic tightest-resulting-diagonal packing **only if the union AABB spans at most 24 BU on every axis**.
3. **298 original oversized primitives remain single-piece groups.** No other piece can join them. Their original long spans (maximum approximately 152.35 BU) remain disclosed rather than destructively cutting a water surface/structure. The 24-BU cap is not falsely claimed for these pre-existing exceptions.
4. Copy already-world-baked Y-up attributes **without any transform or normal normalization**. Deduplicate only bit-identical complete attribute tuples, including signed-zero bits. Preserve every triangle's winding, material, position, normal and UV. Select valid 16/32-bit index encoding; no coordinate quantization, compression or surface reconstruction.
5. Emit one identity `CITY.ProvisionalLayout` root and identity mesh nodes. Keep the real `Window`, all nine original emitting variants, original material names/metadata and all 107 dictionaries. The consumer's existing uniform city cast/receive-shadow policy remains applicable; no family or source object is omitted. No visibility-based geometry deletion occurs, including outside the two inspected cameras.

The existing first-reduction recipe, full/reduced artifacts, material map, coverage and evidence remain unchanged. New code lives in `spatial_core.py` / `produce_spatial.py`; configurable grouping is isolated from the prior reduction recipe so earlier evidence remains reproducible.

## Verification and reproduction

Independent validation compares **all 7,769,292 triangle corners byte-for-byte**, including positions, normals, UVs and source material/winding, from the first optimized artifact to the new groups. All 5,368 source objects / 6,644 material pieces are accounted for exactly once. Overall bounds are **exactly unchanged**; root/nodes are identity; all material dictionaries match. No external buffers/textures, animation, skins, studio cameras or lights are introduced.

Clean Blender reimport yields 2,304 meshes and **2,587,386 triangles**, the same as the previous optimized import. Blender removes **2,378 duplicate index-faces**, while the GLB retains all **2,589,764** triangles. Every imported batch's unique triangle-coordinate set matches, with nearest matched vertex distance 0. This is disclosed importer cleanup, not new reduction. Native source, full baseline, previous optimized GLB and input coverage hashes are checked before/after.

**Completed:** 16/16 tests; production, independent validation, fresh-process repeat and all four actual renders exited **0**. The repeated GLB and coverage are **byte-identical**; manifests and canonical semantic hashes match. Details, exact commands, helper/input hashes and decoded-image records are in [spatial-verification.json](spatial-verification.json). Same-machine/pinned-version reproducibility, not a cross-platform guarantee.

| Actual inspected Blender comparison, 1440×900 | Previous reduced | Spatial candidate | Full / city-crop normalized RMSE |
|---|---|---|---:|
| Accepted game projection, Audience | historical render (archived) | historical render (archived) | 0.000175285 / 0.000216450 |
| Accepted game projection, Twilight | historical render (archived) | historical render (archived) | 0.000152680 / 0.000188398 |
| Observatory projection, neutral close view | historical render (archived) | historical render (archived) | 0.000097387 / 0.000108189 |

All six comparison inputs were decoded and visually inspected before the screenshots were archived. No new visible geometry, normal/UV seam, material, dominant shadow or placement change was found; minor pixel differences remain, so no pixel-identity claim. These were actual reimport renders in the original **Blender PBR inspection rigs**, not actual-app/Toon/culling captures. The game references were reused without duplicate copies. Observatory neutral disables authoring fog/local light anchors and reproduces the existing orthographic projection through pixel aspect 1.6 (checked projection matrix); it does not change the app camera or simulate its UI/lighting. RMSE is diagnostic, not acceptance criteria. Original filenames and checksums are in [archived-evidence.json](archived-evidence.json); current normal-route screenshots are in [consumer-compressed](evidence/consumer-compressed/REVIEW.md).

Serialized resource counts: **4,891,684 position-accessor entries**, unchanged from the first optimized artifact; 132,968,900 embedded binary bytes; all 2,304 index accessors now fit unsigned-short encoding. None is a GPU-memory/performance measurement. Owned repeat GLB/log scratch was cleaned after durable verification; no source, baseline, prior optimized artifact or previous evidence was deleted.

Use installed Blender 5.2.1 LTS; its bundled NumPy supplies the packing/checks. No exporter or native mesh evaluation is needed for production. From repository root, with new empty output directories:

```bash
P="$PWD/assets/production/brightvale-city"
S="$PWD/assets/authoring/brightvale-city/city.blend"
W=/tmp/opencode/brightvale-city-spatial-reproduce
mkdir -p "$W/output" "$W/images"
timeout 90 blender -b --threads 4 --python-exit-code 1 --python "$P/test_spatial.py"
timeout 240 blender -b --threads 8 --python-exit-code 1 \
  --python "$P/produce_spatial.py" -- --output-dir "$W/output"
timeout 600 blender -b --threads 8 --python-exit-code 1 \
  --python "$P/validate_spatial.py" -- --output-dir "$W/output"
timeout 1500 blender -b "$S" --threads 8 --python-exit-code 1 \
  --python "$P/render_spatial.py" -- --output-dir "$W/images"
```

`produce_spatial.py --config` accepts an explicit configuration; the retained default records the selected 16/24 choice and pinned inputs. The renderer intentionally inspects the **packaged** spatial artifact, not a scratch candidate implicitly. Helpers work from non-repository cwd with absolute paths. They refuse to overwrite existing candidate/images. Tests include bounds versus centers, oversized isolation, family/material/UV separation, signed-zero/attribute preservation, unused-vertex compaction, deterministic packing, transforms/instance rejection and the inherited ordinary-mesh-plus-four-instances accounting regression.

Parent/designer owns the next actual-app Audience/Twilight/Observatory comparison using the unchanged harness, accepted placement and fixtures. Do not promote this candidate or claim renderer/performance success from these offline checks.
