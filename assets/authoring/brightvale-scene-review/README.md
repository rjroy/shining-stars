# Brightvale assembled-scene review candidate

Authorized bounded assembly for `shining-stars-4f4.26`, following the [composition brief](composition-brief.md). **User review pending.** This is an editable Blender composition study using existing models, not an approved game scene, final crowd population, runtime integration, optimization, or export.

**Bounded refinement outcome:** three additional scene-transform/camera trials were inspected and stopped without promotion. None convincingly reconciles the intact city foundation, short horizontal highway and landscape/crop hierarchy. The candidate and its five matched-mode images below remain byte-for-byte unchanged. See [trial evidence and decision needed](#bounded-refinement--stopped-without-promotion).

[scene-review.blend](scene-review.blend), 1,456,560 bytes, SHA256:
`473beef0d6e72db25242edf3ba914d1508e70183493383d207f227785aa5b85f`

## Actual rendered evidence

- [Neutral/material-readable](preview-neutral.webp)
- [Audience](preview-audience.webp) — warm lighting
- [Twilight](preview-twilight.webp) — violet lighting
- [Audience narrow crop](preview-audience-narrow.webp)
- [Twilight narrow crop](preview-twilight-narrow.webp)

Landscape images are 1600×900. Narrow images are literal 800×900 center crops, source columns 400–1199, not a different camera or responsive composition. All five final WebPs were opened and visually inspected. Audience/Twilight change only world and lights; geometry, materials, poses, camera and placement stay identical. Images are lossless WebP conversions of actual Blender renders, not concept images or composites.

## Bounded refinement — stopped without promotion

[Three actual-render diagnostics](diagnostic-layout-trials.webp): vertically labeled contact sheet, three unaltered 800×450 neutral Cycles renders at eight samples, plus label strips. These are **alternative cameras/layouts**, not modes of the maintained candidate, same-camera crop evidence, or runtime-responsive validation. Compared directly with the original Golden City and Neon Twilight mockups; no model or material was redesigned.

| Trial | Camera / target / lens | City root position / uniform scale | City-to-road ground gap |
|---|---|---|---:|
| A, least-bad trial | `(0,-20,5.6)` / `(0,12,3.2)` / 28 mm | `(1.5,31,1.235)` / .145 | 8.56 |
| B, lower/nearer | `(0,-19,4.8)` / `(0,12,3.3)` / 26 mm | `(1.5,29,1.30)` / .15 | 6.50 |
| C, wider crop tradeoff | same as B, but 19 mm | same as B | 6.50 |

All three retain ten spectators at the same locations/scales/poses, with yaw recomputed toward each camera. Platform/endcap/highway and framing transforms are unchanged. City Z only compensates uniform scaling to keep its lowest point at ground Z=-.65: the foundation is **not buried, clipped away or disguised with fog**.

Trial A removes the conspicuous screen-space gap and broadens the city from approximately 662 to 890 landscape pixels, but its intact arcade/plinth reads as a wall behind the road. Lowering the camera foreshortens the highway: its projected vertical extent drops from 229 to 163 pixels. B reduces that extent further to 144 pixels. Neither creates the mockup's long, dominant road or inhabited lateral surroundings; the broad neutral floor and ten-person specimen remain visibly sparse. This is a composition/asset relationship limitation, not a lighting fix.

C keeps platform/endcaps, city and all spectators inside the literal center half-width, with only outer framing clipped. However, its highway is just 463 pixels wide and 105 pixels tall in the 1600×900 equivalent view, surrounded by more empty floor/sky. It sacrifices landscape dominance to obtain crop fit. A still clips about 93 pixels of endcap per side in that crop, and also clips the widened city and audience. No crop success is claimed for A/B or the maintained candidate.

All three passed source-geometry/material identity, positive uniform scale, unburied-city/road clearance, crowd facing/contact/lane exclusion, open framing, 420 unobstructed lane rays and ten own-head visibility rays. Four existing negative camera/facing/lane/framing tests and two additional city-overlap/buried-base negatives passed for each. The original validator's provisional **greater-than-10-unit** city-spacing assertion fails for all three; that is explicitly reported, not described as a full validator pass or silently changed in the maintained script. The physical clearances above are independently measured and positive.

All 116 source-package files, the maintained `.blend`, three maintained scripts and five original previews remain unchanged. Initial package, trial script, individual PNGs and reports are preserved in task scratch; no replacement blend or mode render set was promoted. Prior independent regeneration/reopen/matched-mode evidence therefore still describes the unchanged candidate. The contact sheet was decoded and opened after conversion.

**Decision needed before further work:** accept a documented composition tradeoff, or authorize a separate scope discussion about the road's extent/camera-fit contract and the city's foundation/environment relationship. These three tests do not prove every possible camera is exhausted; they do show that simply moving the city closer and lowering/widening the camera is not a convincing correction. No source redesign, extra population or further search is assumed authorized.

## Immutable source provenance

All six source files were checked before/after assembly, validation and rendering. No source package was edited. Source collection names containing `CANDIDATE`/`UNAPPROVED` are historical names, not a change to their recorded approval status.

| Source | Authoritative import | SHA256 |
|---|---|---|
| [Platform](../neon-twilight-platform/platform.blend) | `Collection`, filtered to its 53 asset geometry objects | `ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af` |
| [Endcaps](../brightvale-platform-endcaps/endcaps.blend) | `CANDIDATE \| endcap pair \| UNAPPROVED` | `c49ae80c34350ddb7281c3192c4ed90921852f0386fa047a9196087cc13b4207` |
| [Highway](../brightvale-highway/highway.blend) | `CANDIDATE \| static highway \| UNAPPROVED` | `2f2eca2987cd42b105c579420ca2e2cbc71ad75d73bcbf164aca60afe32652e5` |
| [Framing](../brightvale-outer-framing/framing.blend) | `CANDIDATE \| outer framing \| UNAPPROVED` | `cd17e3162c434ce4054f6c32d86d4b6a885e9dbad44c1841b563513fffd75542` |
| [City](../brightvale-distant-city/city.blend) | `CITY_ASSET` | `4beb993e9b580bb0b6dd47e5523a0ad9aecc8c26804a4b4cbdc42cc5488caa2c` |
| [Crowd variants](../brightvale-crowd/variants/variants.blend) | `A.Original`, `B.Bob`, `C.Gathered`; required saved pose actions | `854a120872c1152c0c7722e5f49f2d78572da69d485afbc646a5a6bcdba1b397` |

Collections are appended once into a separate scene. Source studios, reference assemblies, cameras and ground are excluded, including unused studio data. Crowd templates are replaced by ten pose instances, not retained as hidden extra people. Mesh data are shared where applicable; each instance has its own rig object and source-authored action. The saved candidate is self-contained, with no external libraries/images. Regeneration requires the six sibling source files, not their build scripts, scratch files, or the deleted failed prototype.

## Reproducible provisional layout

Axes: X left/right, +Y toward city, Z up. Values are **scene units, not approved meters or runtime scale**. Only scene-level transforms were changed; no asset geometry, material, rig or pose definition was redesigned or nonuniformly stretched.

- **Platform, endcaps, highway:** original transforms untouched. Platform bounds `(-6,-2.8,-.45)..(6,2.7,.695)`; endcaps `(-6.98,-2.8,-.65)..(6.98,2.7,1.15)`; highway `(-6,2.535,-.3)..(6,20.7,.505)`. The unchanged 18-unit highway chassis joins at Y=2.7 with zero gap; source terminal noses reach Y=2.535. Original crest/endcap relationship is retained.
- **City:** `CITY.ProvisionalLayout` position `(1.5,44,1.04)`, uniform scale `.13`, original rotation. Descendant local transforms unchanged. Actual bounds `(-15.79,42.44,-.65)..(18.79,56.87,16.38)`; its front is 21.74 units beyond the road end. The spire remains left of center. This consciously rescales the much larger authoring model, without claiming an approved physical scale.
- **Framing:** root X=±10.5, Z=-.65; long/post/short Y=2.8/8.5/14. Original ±90° rotations and unit scale retained. Measured longitudinal gaps are 3.77 and 4.07 on each side; minimum lateral clearance beyond the crowd aggregate is .212 left/.306 right. Prior stored source placement is not treated as a contract.
- **Review ground only:** Z=-.65, X±2000, Y=-100..2000; one quad/two triangles, roughness .88, linear RGB `(.036,.043,.060)`. No terrain, stage, performer or new environmental architecture.

### Ten static spectators

A is the original teal short-haired character; B coral bob; C mustard gathered hair. All poses are existing accepted source actions, not newly authored animations. Every root has Z=-.65 and uniform scale below. Root yaw is `atan2(-X, Y+18)` radians, orienting character forward −Y toward the player-side camera. No Rest spectators or additional hidden source rigs.

| Instance | Variant | Pose | X | Y | Scale |
|---|---|---|---:|---:|---:|
| L01 | B | Cheering | -8 | 1.3 | 1.02 |
| L02 | A | Reaching | -9.3 | 5 | 1 |
| L03 | C | Calm | -7.5 | 8.6 | .98 |
| L04 | B | Reaching | -9.2 | 9.4 | 1.03 |
| L05 | A | Cheering | -7.8 | 16.6 | 1 |
| R01 | C | Calm | 8 | .8 | 1.02 |
| R02 | A | Cheering | 9.2 | 3.7 | .97 |
| R03 | B | Reaching | 7.8 | 10.4 | 1 |
| R04 | C | Cheering | 9.3 | 11.7 | 1.03 |
| R05 | A | Calm | 7.5 | 18 | 1 |

Seven distinct source actions are used across the ten instances. Projected posed heights are 61.0–123.3 pixels in landscape. The arrangement is deliberately sparse and staggered, not a final density or placement decision.

### Shared camera and lighting

One **provisional** perspective camera at `(0,-18,7.5)`, aimed at `(0,12,3)`, 28 mm lens/36 mm sensor, clipping .1–5000. This is neither existing runtime camera and does not propose unifying runtime cameras. Frame 1 only; Blender 5.2.1 LTS, Cycles 24 samples with denoising, AgX Medium High Contrast, exposure 0. No fog, bloom or compositing.

Fixed lights: sun at `(-20,-35,45)` aimed at `(0,20,0)`, angular size .32 radians; disk key `(-7,-5,16)` diameter 14 aimed at `(0,6,0)`; disk fill `(12,-1,11)` diameter 12 aimed at `(0,7,1)`; disk rim `(0,22,17)` diameter 16 aimed at `(0,7,0)`. Exact mode values below are energy and linear RGB; area energies are Blender watts, sun uses Blender sun strength.

| Mode | World RGB / strength | Sun | Key | Fill | Rim |
|---|---|---|---|---|---|
| Neutral | `(.24,.26,.30) / .45` | `1.4 (1,.94,.86)` | `1900 (1,.92,.82)` | `1300 (.70,.82,1)` | `1700 (.72,.80,1)` |
| Audience | `(.11,.065,.042) / .50` | `1.5 (1,.77,.48)` | `2500 (1,.72,.42)` | `1600 (.64,.76,1)` | `2000 (1,.61,.30)` |
| Twilight | `(.030,.018,.075) / .65` | `.95 (.52,.40,1)` | `2100 (.74,.61,1)` | `1400 (.44,.63,1)` | `1900 (.67,.32,1)` |

## Measurements and checks

| Asset | Placed drawable objects |
|---|---:|
| Platform | 53 |
| Endcaps | 2 |
| Highway | 14 |
| Framing | 10 |
| City | 196 |
| Crowd | 173 |
| **Assets total** | **448** |

There are **601,400 placed evaluated asset triangles**, plus one ground drawable/two triangles; **84 used materials including ground**, **165 unique drawable data blocks including ground**, and **505 total scene objects**. City alone contributes 500,928 triangles. Unique data blocks are not placed objects or a runtime draw-call estimate. No merging/reduction/performance pass was attempted.

Actual evaluated-vertex screen rectangles in 1600×900 pixels, top-left origin:

| Asset | X range | Y range |
|---|---|---|
| Platform | 343.4–1256.6 | 676.5–860.8 |
| Endcaps | 264.0–1336.0 | 636.8–894.3 |
| Highway | 453.1–1146.9 | 487.6–717.0 |
| Framing | 132.2–1467.8 | 525.3–767.6 |
| City | 491.5–1153.8 | 91.4–431.5 |
| Crowd union | 267.8–1342.4 | 482.0–785.7 |

Validation passed on the saved maintained file after reopen:

- Six source hashes; mesh coordinates/topology/weights, curve controls, armature rest data, modifier/material boundaries and protected transforms compared against fresh read-only source imports. Source repaired hands and accepted pose data are preserved by identity, not resculpted.
- Ten own-rig instances with correct saved pose channels, uniform positive scales, grounded feet, plausible bounded heights, outside-lane geometry and camera-facing orientation. All ten face-target rays hit their own Head. These sampled visibility/contact checks are not exhaustive collision certification.
- 420 sampled lane-surface rays clear; fitted platform junction, actual framing gaps and crowd separation checked. No nested reference assemblies, hidden originals, imported studio objects, orphan studio materials or external file dependencies.
- Four intentional defects rejected: cropping camera lens, backwards-facing spectator, spectator inside lanes, and a framing post closing a gap. Restoration reproduces the original report.
- Independent regeneration under a relocated directory with only the six sibling source files matched every semantic validation field except the `.blend` container hash. One-thread original versus eight-thread rebuild agreed. Final maintained reopen also matched.
- 21 early-rejection guards passed, including existing/source output files, missing arguments/directories, wrong suffix, unauthorized output location and each deliberately wrong source hash. No guarded attempt constructed, rendered or saved an asset.
- Script syntax/local links and source-package integrity checked. No source `.blend` was resaved. All Blender build/validation/render jobs completed successfully; logs remain scratch, not package dependencies.

Source-identity fingerprint: `1c804ef658fba8d7508386af664cfb722132f0ffb4de7b11939373c47db28e13`.
Placed evaluated geometry/projection fingerprint: `44e11c61a4baca484de03ee2e24a936a15ca3c9c1adbddb1811f654f5425dc9e`.
Matched-mode camera/placement signature: `50d03bb68955ed298f880aef91cd1fb7f121be7833c250a8b3017aa9e95fab42`.

## Visual findings and unresolved limits

The platform/road dominates the foreground, all four lane cues remain unoccluded, and the fitted endcaps are attached rather than displaced. Ten spectators face the player with raised/reaching/calm poses and plausible relative scale; separated framing stays outside them. The city is well behind the road, with a visible offset spire. Twilight retains lane/window separation but makes small city/crowd detail dimmer. These scene-size faces are not a fresh anatomy/expression review.

**The narrow crop is not a complete composition-fit pass:** it retains the highway, all four lane cues, junction and city, but clips approximately 56.6 pixels of platform and 136 pixels of endcaps on each side, plus several spectators. Framing is sacrificed strongly, but so is important audience/platform information. No crop-specific FOV or placement correction conceals this. Even landscape endcaps have only about six pixels of bottom margin; camera fit remains provisional.

The immutable 18-unit road reads shorter/broader than the painted gameplay mockup. The city's literal cutaway foundation and separation from the road still read as a standalone diorama, not a seamless inhabited environment. The review ground has a plain horizon; no terrain/atmosphere solution was invented. Perfect cel-shader/material parity, final scale, game-distance layout, responsive fit, crowd density, placement, runtime cameras, draw calls and performance remain unvalidated. This task does not approve or implement any of those decisions.

## Reproduce without overwriting the candidate

[assemble.py](assemble.py) uses relative sibling sources with pinned checksums. [validate.py](validate.py) reopens and checks the actual saved scene. [preview.py](preview.py) renders mode-only comparisons without saving scene edits. All outputs must be **explicit new paths** under this package or `/tmp/opencode`; existing outputs are refused. Use installed Blender and `cwebp`; no downloads/installations are needed.

From repository root:

```bash
PACKAGE="$PWD/assets/authoring/brightvale-scene-review"
WORK=$(mktemp -d /tmp/opencode/brightvale-scene-rebuild-XXXXXX)
timeout 180 blender --background --threads 1 --python-exit-code 1 \
  --python "$PACKAGE/assemble.py" -- --output "$WORK/scene-review.blend"
timeout 180 blender --background "$WORK/scene-review.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/validate.py" -- \
  --negative-test --report "$WORK/validation.json"
timeout 240 blender --background "$WORK/scene-review.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/preview.py" -- \
  --output-dir "$WORK" --modes neutral audience twilight
for mode in neutral audience twilight; do
  cwebp -lossless -z 6 "$WORK/$mode.png" -o "$WORK/$mode.webp"
done
for mode in audience twilight; do
  cwebp -lossless -z 6 -crop 400 0 800 900 "$WORK/$mode.png" \
    -o "$WORK/$mode-narrow.webp"
done
```

For relocation, preserve the six sibling source paths beside the relocated scene-review scripts. The source models remain separately owned; this package grants no permission to modify them. Parent owns review, acceptance and checkpoint; no runtime/export or final population is included.
