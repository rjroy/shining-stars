# Approved crowd-character FK rig

**Rig and Rest/Cheering/Reaching poses approved 2026-10-11: “this is good enough,” after the bounded palm repair and revalidation. No extra characters, runtime animation, export or integration approval. Cleanup is separately authorized after checkpoint; none performed in this promotion.**

## Authority and source

On 2026-10-11 the user said “Setup the rigging.” Task `shining-stars-4f4.24.2` authorizes a compact reusable rig and rest/cheering/reaching tests on the approved corrected-T-pose base, not a face/body redesign. This later instruction supersedes the base README's older rigging prohibition only for this bounded trial. Cleanup belongs to separate task `shining-stars-4f4.24.3`, after the approval checkpoint.

After the inherited hand intersection was reported, the user explicitly chose **“Fix and revalidate.”** This authorized only the mirrored outer-palm/little-finger attachment repair, source-lineage checks and regeneration of this same rig and three poses. Previous base and rig packages were preserved in `/tmp/opencode/crowd-hand-repair-7u7ry0f4/before/`; nothing in that scratch history is a reproduction dependency.

The user then accepted the corrected result as **“this is good enough.”** This approves the repaired base, rig and three reviewed poses within that bounded scope, not the untested motions below. `rig-candidate.blend` was renamed to `rig.blend` with identical bytes, without resaving or changing geometry, rig, poses or materials. Existing approval previews are retained unchanged.

- Corrected source, immutable during rig construction: [`../neutral-base/character.blend`](../neutral-base/character.blend), SHA-256 `800ef1f869e69489e0ae049b2c952bfcbe227be17614e21843008aa19e5b33f8`. Previous approved base: `05d18729cd9c163cca5476049a10491639c36465b0fcd2494c9f70e656309735`.
- Base approval, construction and inherited limits: [`../neutral-base/README.md`](../neutral-base/README.md). Approved direction: [`../brief.md`](../brief.md), [`../concept-cel-shaded-candidate.webp`](../concept-cel-shaded-candidate.webp).
- Approved editable master: [`rig.blend`](rig.blend), **203,625 bytes**, SHA-256 `6758bb60c96ec14e912d71c06dc78dbfde4b46c57d9d05ccfd6d4c94ff74f1cb`. Previous candidate: `028fefe43dc2eb3adb7e5d0a951370bb52ad54bbc78ad7040c68cf1abaf2bbbd`.
- Reproduction: [`build.py`](build.py), [`validate.py`](validate.py), [`preview.py`](preview.py). The only build input is the checksum-verified sibling base blend; no helper from the failed parent package is used.

Blender **5.2.1 LTS**; meters, Z up, −Y forward, ground-center origin. All **17 meshes, 3,043 vertices, 5,530 triangles and 14 material regions** retain exact stored **corrected-source** coordinates, edges, polygons, material graphs/assignments and object transforms. No shape keys, rig-stage mesh edits, remeshing, subdivisions or “Apply Pose as Rest.” The master opens in the original neutral T-pose. Historical source-object and candidate-status scene metadata are retained to avoid resaving; this README records approval. The unchanged builder deliberately labels newly generated outputs as candidates, not automatically approved replacements. Skeleton, all weights and exact pose definitions are unchanged from the previous rig.

## Compact rig and weights

`CrowdRig` has **20 bones, 19 deforming**, parented to the original `NeutralBase` root. Original mesh object parenting is retained; one volume-preserving Armature modifier per mesh targets `CrowdRig`. Direct FK is sufficient for these planted-feet gestures, so no IK/constraints/control framework was added.

| Chain | Purpose |
| --- | --- |
| `root → pelvis → spine → chest → neck → head` | Root placement, torso and coherent head posing |
| `chest → clavicle.L/R → upper_arm.L/R → forearm.L/R → hand.L/R` | Scapular/clavicle contribution, raised/reaching arm, bent elbow and wrist |
| `pelvis → thigh.L/R → shin.L/R → foot.L/R` | Basic reusable lower-body FK; feet remain planted in the selected tests |

`.L` is character-left (+X); `.R` is −X. Local Y runs head-to-tail; local Z is projected toward −Y for a deterministic roll. Shoulder/elbow/wrist rest centers remain `(±0.200, −0.012, 1.409)`, `(±0.478, −0.012, 1.409)`, `(±0.687, −0.012, 1.409)`. Arms are connected bone chains, not independently positioned limb objects.

Weights are deterministic, nonnegative and normalized; every deform vertex is covered. Sleeve and covered arm share a spatial chest/clavicle/upper-arm field; cuff/shaft follow upper arm together. Elbow weights blend across |X| 0.432–0.521 m, wrist weights across 0.660–0.709 m. Palms/fingers follow `hand` rigidly, with no finger rig: open-hand gestures do not require one. Head/neck blend over Z 1.466–1.530 m; facial inserts, overlays, ears and hair follow `head` rigidly. Waist, thigh/knee blends and shoes use pelvis/leg/foot weights. No automatic heat weights or simulations.

## Reusable poses and actual evidence

Three named **single-frame authoring actions**, all at frame 1, are stored on the same skeleton: `Pose.Rest`, `Pose.Cheering`, `Pose.Reaching`. These are not game animation clips. Select `CrowdRig` and select the named action in Blender's Action Editor; the master starts on `Pose.Rest`. `build.py`'s `POSES` dictionary and the rig's `pose_definitions` property also retain the exact rest-axis degree rotations. `apply_pose(name, use_action=True)` is the script interface. No baked pose variants or additional figures are stored.

| Pose | Intent | Actual model images |
| --- | --- | --- |
| Rest | Original symmetric T, palms forward, thumbs up | [front](preview-rest-front.webp), [three-quarter](preview-rest-threequarter.webp), [hand](preview-rest-hand.webp) |
| Cheering | Both upper arms raised, unequal elbow bends, open raised hands; slight head lift/turn | [front](preview-cheering-front.webp), [three-quarter](preview-cheering-threequarter.webp), [shoulder/elbow](preview-cheering-shoulder.webp), [corrected hand close-up](preview-cheering-hand.webp) |
| Reaching | Left arm reaches toward player, bent elbow and palm-up wrist; right arm opens lower | [front](preview-reaching-front.webp), [three-quarter](preview-reaching-threequarter.webp), [shoulder/elbow](preview-reaching-shoulder.webp), [corrected hand close-up](preview-reaching-hand.webp) |

Neutral geometry diagnostics, not runtime-camera evidence: Cycles 32 samples, denoising, gray world, three broad area lights, AgX Medium High Contrast, identical material assignments. Front and three-quarter are orthographic 1000×1100, full-body scale 2.34 m; shoulder 1000²/0.79 m, hand 900²/0.36 m. Three-quarter uses a +X camera. The reaching arm points partly toward this camera and is foreshortened; front plus close-up are also supplied. Shoulder framing intentionally crops non-target parts; full-body views show all hands and feet. No lighting/material changes were made to hide flaws. WebPs use installed `cwebp -q 92`.

## Hand repair and visual review

The arm/cloth weight revision removed the initial reaching sleeve penetration. Final front/three-quarter views show coherent bent limbs, cuffs enclosing their arms and no exposed second deltoid bulge. Shoulder/axilla folds remain angular and cloth stays simple rather than simulated; elbows are somewhat angular, wrists and hands simplified. The face remains neutral, not an expressive cheering face. Original chin, ears, hair, collar, trouser and shoe limitations remain. Lower-body FK exists but crouching, stepping, extreme shoulder rotations and finger gestures have not been approved or validated.

The old outer-palm edge ran backward from longitudinal hand distance 0.066 m to 0.060 m, producing 8 nonadjacent triangle crossings per hand and a dark slit in posed close-ups. The authorized repair moves only the shared little-finger-root front/back corners and midpoint to 0.067 m: **three existing vertices per hand, each 7 mm outward, seven existing faces affected**. No connectivity or count changes. All other 456 vertices per arm, all 15 other meshes, materials, transforms and bounds remain unchanged. See the base README for exact vertex/face indices and lineage.

Corrected rest and posed close-ups were rendered and opened: the former dark slit is gone, and the little finger joins the palm without that reverse fold. The hands retain their simplified angular webs/thumb transition; there was no finger/body/face redesign or lighting change. All eleven maintained rig previews were refreshed for the repair because their full-body or close-up views include the changed hands, then retained unchanged for approval. User acceptance followed this evidence; technical results alone did not grant approval.

## Verification

- Saved scratch and maintained candidates reopened successfully. Exact raw rest mesh/material/transform comparison against the immutable base passed. Maximum evaluated rest-coordinate error **1.195×10⁻⁷ m** (float32 skin evaluation); rest-return checks passed.
- Bone parent/connectivity, rest landmarks, local roll/orientation, ownership, weights, actual posed geometry, finite normals and source-triangle/face areas passed. Both arm/hand meshes have **zero source and evaluated nonadjacent crossings and zero face-interior crossings in all three poses**. The raw nonadjacent query has no defect-pair exceptions; a second all-pairs query contracts triangles 0.01% about their centroids to remove shared-boundary contact while still testing adjacent face interiors. A guard also diagnoses possible zero-area retessellated ears at pre-existing collinear n-gon boundary points; the **final** three poses had zero such ears.
- Both arms, all three poses: **zero shirt/arm triangle intersections**; 24 radial directions at three covered-arm stations per side give minimum clearance **2.485 mm** across the selected poses. This is a local check, not exhaustive clothing certification. A separate diagnostic found no nonadjacent shirt self-crossings. Trouser inset cuffs retain their two source crossings; trousers do not move in these poses.
- Wrist ring centers remain within 0.0025 m of their posed joints; fingertip and face/hair attachment errors stay below 2×10⁻⁶ m. Both feet keep their original ground placement. Raised/forward wrist directions, actual bent elbow axes and connected bone endpoints passed.
- Saved actions reproduce the script pose transforms/evaluated coordinates. Missing hand weights, deliberately chest-weighted unmoving sleeves and reinstating the old palm fold are rejected by geometric/weight checks; data and all three evaluated poses restore afterward. Explicit-output/no-overwrite/wrong-base guards remain in place and were rerun for the repair.
- Independent relocation under a path containing a space used only the rig scripts and sibling source blend. An 8-thread regeneration exactly matched the 1-thread candidate's rig/weight fingerprint, all pose transforms and evaluated geometry fingerprints. Blend file bytes are not claimed deterministic across save locations; the semantic reports match exactly. Rig fingerprint: `01ceaf2010313ea7ac37be6c78586bc13489d59d990d74465bdd0243cddc9bd5`.
- Both corrected base and rig were independently regenerated under a relocated path and reopened. Source checksums stayed unchanged during inspection. Only the authorized hand-repair packages and affected evidence were updated; the parent failed diagnostic and all other assets remain untouched. Prior package copies, trial blends, PNGs, logs, reports and diagnostics remain in task scratch; no historic cleanup was performed and no owned process remains running.
- Approval promotion: stable `rig.blend` reopened in Blender 5.2.1 LTS; all structural/posed checks and three negative tests passed, exit 0. Every semantic report field matches the prior maintained and relocated regeneration reports (excluding file SHA-256 and review-status text). Builder/preview scripts are byte-identical to the relocated repair scripts; validator logic is unchanged apart from its informational review-status text. Nine explicit-output/no-overwrite/wrong-base guards, script syntax and local README links passed. Master/base bytes and all eleven previews remain unchanged; no rebuild or rerender was needed. Promotion logs and reports: `/tmp/opencode/crowd-rig-approval-a0u0s_h6/` (not a reproduction dependency).

Technical checks now reject any detected arm/hand crossing rather than accept the inherited defect. They still do not grant artistic approval or exhaustive collision certification. There is no approved runtime polygon/material budget, runtime shader validation or animation design.

## Reproduction (new outputs only)

Keep `rigged/` and sibling `neutral-base/character.blend` together. Set absolute `PACKAGE` to this directory and `WORK` to a new existing scratch directory. The maintained source is `$PACKAGE/rig.blend`; scripts require explicit paths and have no implicit master-output default. Do not point output at a source master. Builds/validation use 120-second bounds, render batches 240 seconds.

Read-only check of the approved master (report must not exist):

```bash
blender --background "$PACKAGE/rig.blend" --threads 1 \
  --python-exit-code 1 --python "$PACKAGE/validate.py" -- \
  --negative-test --report "$WORK/approved-validation.json"
```

Regenerate and inspect a **new candidate**, never overwrite the approved master:

```bash
blender --background --threads 1 --python-exit-code 1 \
  --python "$PACKAGE/build.py" -- --output "$WORK/rig-candidate.blend"
blender --background "$WORK/rig-candidate.blend" --threads 1 \
  --python-exit-code 1 --python "$PACKAGE/validate.py" -- \
  --negative-test --report "$WORK/validation.json"
blender --background "$WORK/rig-candidate.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/preview.py" -- \
  --output-dir "$WORK" --poses Rest Cheering Reaching --views front threequarter shoulder hand
```
