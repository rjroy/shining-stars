# Approved three-character variation set

**Representative three-person model/pose set approved 2026-10-11: “Approve variants.”** The earlier “go” authorized task `shining-stars-4f4.24.4`: the accepted original plus two representative variations, reviewed before any crowd population. Approval covers this bounded authoring set, **not final population, game placement, runtime animation, export or integration**.

Approval promotion renamed `variants-candidate.blend` to `variants.blend` with identical bytes, without resaving or changing geometry, materials, rigs or poses. All thirteen approval previews are retained unchanged. No further generation or population work was performed.

## Direction and immutable sources

The approved [clean cel-shaded anime concept](../concept-cel-shaded-candidate.webp) and [brief](../brief.md) govern contemporary casual clothes, believable proportions and friendly player-facing attention. Concept provenance/approval: [parent README](../README.md). The later bounded modeling authorization supersedes the brief's original modeling prohibition only for this sample. No new concept images, identities, lore or costumes were generated.

- Accepted [base](../neutral-base/character.blend), SHA-256 `800ef1f869e69489e0ae049b2c952bfcbe227be17614e21843008aa19e5b33f8`; [base construction/limits](../neutral-base/README.md).
- Accepted [rig](../rigged/rig.blend), SHA-256 `6758bb60c96ec14e912d71c06dc78dbfde4b46c57d9d05ccfd6d4c94ff74f1cb`; [rig approval/evidence](../rigged/README.md).
- Both masters and every other file in their packages remained byte-identical. Only these two checksum-locked blends are build inputs; no sibling script, deleted prototype or scratch file is a dependency.

## Approved master and differences

Approved editable authority: [variants.blend](variants.blend), **322,568 bytes**, SHA-256 `854a120872c1152c0c7722e5f49f2d78572da69d485afbc646a5a6bcdba1b397`. Deterministic construction: [build.py](build.py); reusable [validation](validate.py) and [preview](preview.py).

| Collection | Readable variation | Saved review pose |
| --- | --- | --- |
| `A.Original` | Exact accepted mesh coordinates, topology, weights and material values: short dark swept hair, teal tee, charcoal trousers | Accepted Reaching |
| `B.Bob` | Chestnut chin-length bob with parted fringe; coral boxy cropped tee, sleeves 12 mm shorter; dark-blue trousers raised 30 mm at the waist to meet the cropped hem; lighter warm skin palette | Accepted Cheering |
| `C.Gathered` | Dark swept fringe and gathered rear knot; mustard short-sleeve shirt with longer hem, sleeves 22 mm longer, separate turn-down collar/placket; olive trousers and darker shoes/skin palette | Accepted Calm: lowered arms, slight unequal elbow bends, open hands |

The original head/eyes/ears, anatomy, limb lengths, joint landmarks and accepted shoulder crown are unchanged. B/C mouth strips retain their topology with only 4/2.5 mm lateral lifts for restrained closed smiles. No new facial rig or open-mouth anatomy. All six arm/hand instances retain the repaired source exactly. Hair is explicit crown/skirt topology plus swept locks; the rear knot overlaps the hair crown intentionally. No remesh, subdivision, sculpting, UVs or textures.

### Editing and pose assets

Blender **5.2.1 LTS**, meters, Z up, −Y forward. Character roots remain ground-centered locally. X offsets `−1.30, 0, +1.30` m only separate the diagnostic lineup; they are **not approved game placement**. Body proportions are intentionally identical; height differences come only from hair.

Each collection owns a named `A/B/C::CrowdRig`, original mesh-role names prefixed `A/B/C::`, and an independent 20-bone skeleton (19 deforming). Each rig stores JSON `pose_definitions` and `assigned_pose`. Four named single-frame actions per rig, e.g. `B.Pose.Rest`, `B.Pose.Cheering`, `B.Pose.Reaching`, `B.Pose.Calm`, are all authored at frame 1. Select the corresponding action in the Action Editor, or call `build.apply_pose('B', 'Rest')`; `assigned_poses()` restores the lineup. These are static review poses, **not runtime clips or a playback system**. No IK, new controls, finger rig, mocap or retargeting.

Unchanged mesh/vertex-weight data are shared; make mesh data single-user before editing one character's shared anatomy or weights. Changed hair, garments and mouths have separate mesh data. Unchanged eye/lace materials remain shared; per-character color changes use object material overrides. Historical source custom labels and the saved candidate-status scene text are retained to avoid resaving; this README records approval. The unchanged builder deliberately labels newly generated outputs as candidates, not automatically approved replacements.

## Measured counts

| Character | Mesh objects | Vertices | Triangles | Rest height including hair |
| --- | ---: | ---: | ---: | ---: |
| A | 17 | 3,043 | 5,530 | 1.795854 m |
| B | 17 | 3,043 | 5,538 | 1.810800 m |
| C | 18 | 3,171 | 5,772 | 1.850231 m |

**Placed:** 52 mesh objects, 9,257 vertices, 16,840 triangles, 60 bones / 57 deforming, 12 single-frame actions. **Unique mesh data:** 26 meshes, 5,218 vertices, 9,528 triangles. **34 used materials**; meaningful skin/hair/clothing/eye/light-colored regions remain separate. These counts are not draw-call or runtime performance measurements; no approved performance budget exists. Rest X bounds are ±0.837 m per character. Assigned cheering reaches Z=1.949678 m. World-space lineup extent depends on the selected review pose.

## Actual-model evidence and critique

Start with [group front](preview-group-front.webp) and [group three-quarter](preview-group-threequarter.webp). Individual posed views: [A original](preview-A-front.webp), [B bob](preview-B-threequarter.webp), [C gathered](preview-C-threequarter.webp).

Diagnostics: [B head](preview-B-head.webp), [C head](preview-C-head.webp), [B shoulder/hand](preview-B-shoulder.webp), [C shoulder](preview-C-shoulder.webp), [B rest](preview-B-rest.webp), [C rest](preview-C-rest.webp), [B back](preview-B-back.webp), [C back](preview-C-back.webp).

Rendered images were opened and compared with the approved concept and accepted rig evidence. The three hair silhouettes, garment cuts/palettes and high/reaching/lowered gesture mix read distinctly. Eyes/mouths remain visible; the corrected cropped waist is covered, and the modified cuffs enclose the arms without an exposed duplicate shoulder. The calmer hands stay separated from the hips. No lighting or material changes were used to hide contact defects.

**Honest limits:** the shared face/body proportions still read as a related base family rather than three independently designed anatomies. Smiles are restrained, not the concept's exuberant open-mouth expression range. Hair remains broad and faceted, especially the bob's simple rear shell and gathered knot. Clothing is angular, with stiff underarms, open unlined cuffs and the inherited jagged rear neckline; collar/placket are deliberately simple. Accepted pointed chin, projecting facial layers, slab-like ears, simplified hands, trouser contour steps and blocky shoes remain. No full hair-shell self-intersection certification is claimed: locks/knot intentionally enter the crown. Inherited trouser cuff/shoe overlaps are not redesigned. Calm is an open relaxed gesture, not a fully hanging palm-inward rest pose.

Previews are neutral **geometry diagnostics**, not approved game camera/distance/layout or runtime cel-shader parity: Cycles 32 samples, denoising, AgX Medium High Contrast, gray world and three broad area lights. Orthographic group images 1800×1100; full-body individuals 1000×1100; head/shoulder 1000². Shoulder crops omit non-target regions; full-body views show all hands/feet. WebPs use installed `cwebp -q 92`. No city/highway scene, lighting-mode integration, outline effect or final presentation was built.

## Verification

- Reopened scratch and maintained candidates. Checks verify exact A source mesh/material/weight identity; protected B/C anatomy and lower trousers; unchanged joint matrices, parent/connectivity and shoulder crown; full normalized deform weights; ownership, expected actions and no external libraries/images.
- All three characters tested in **Rest, Cheering, Reaching and Calm** (12 combinations), not only their assigned poses. Saved actions match direct pose evaluation; rest-return and post-negative-test restoration are exact. Maximum rest skin error is `1.195e-7` m; rigid face/hair/finger attachment stays below `2e-6` m. Feet retain source ground placement.
- All rest triangles have nonzero area; manifold interiors, winding, finite coordinates/normals and intentional boundaries pass. Final evaluated poses have **zero degenerate triangles, including zero collinear retessellation ears**. No collapsed source triangles or faces are accepted.
- **Zero arm/hand nonadjacent crossings and zero face-interior crossings** in every tested combination; no defect-pair whitelist. Original reverse-palm fold is explicitly rejected. **Zero shirt/arm and shirt self-crossings**; 24-direction clearance samples at three covered-arm stations per side give a minimum **2.427 mm** over all tests.
- New hair has zero triangle intersections with head, eyes, mouth and shirt; front-facing eye/mouth visibility rays remain unobstructed. Collar/placket has zero intersections with head, hair, shirt or arms. Ray samples below each hem confirm trouser/waistband coverage. These are targeted regression checks, not exhaustive whole-body collision certification.
- Five negative tests reject missing hand weights, the old palm fold, chest-weighted unmoving sleeves, hair pushed into the skull, and the cropped waist gap. Thirteen explicit-path/no-overwrite/wrong-source guards pass without generating or rendering anything.
- Independent **8-thread regeneration in a relocated path containing a space**, using only these scripts and two sibling blends, exactly matches the 1-thread candidate's semantic report, all 12 pose transforms/evaluated geometry fingerprints, topology, materials and checks. Blend bytes across save locations are not claimed deterministic. Native fingerprint: `8a613acf2f983909c0de194068e6da7c1e2545acbd5985fc0bec35bb763d5c75`.
- Bounded corrections addressed an initial rear-knot/skull contact, a placket/collar-rim crossing and the rendered cropped-waist gap. A one-degree calmer-wrist adjustment avoided a collinear n-gon retessellation ear without altering source topology. None of the failed scratch revisions were accepted by relaxing a collision test. Build/check bounds: 120 seconds; render batch: 240 seconds. Final commands exited 0; no Blender job remains running.
- Approval promotion: stable `variants.blend` reopened with the unchanged validator; all 12 character/pose checks and five negative tests passed, exit 0. Every semantic report field matches both the prior maintained candidate and independent relocated regeneration (excluding only the saved-file SHA-256). All three scripts are byte-identical to that tested copy; syntax, 24 local README links and 13 safety guards passed. The approved master, both source packages and all thirteen previews retain their bytes and modification times. No rebuild or rerender was needed. Promotion evidence: `/tmp/opencode/crowd-trio-approval-tzzks5t3/` (not a dependency).

Logs, JSON reports, initial trials and intermediate PNGs stay outside this package in `/tmp/opencode/crowd-trio-ecfgv5tz/`, not as dependencies. No existing package cleanup, Git/Beads changes, installs, export or runtime changes were performed in this task.

## Reproduction — new outputs only

Keep this directory with sibling `neutral-base/character.blend` and `rigged/rig.blend`. Set absolute `PACKAGE` to this directory and `WORK` to a new existing scratch directory. The maintained source is `$PACKAGE/variants.blend`; all scripts require explicit paths, with no implicit master-output default. Never use a source path as output; existing outputs are rejected.

Read-only check of the approved master (report must not exist):

```bash
blender --background "$PACKAGE/variants.blend" --threads 1 \
  --python-exit-code 1 --python "$PACKAGE/validate.py" -- \
  --negative-test --report "$WORK/approved-validation.json"
```

Regenerate and inspect a **new candidate**, never overwrite the approved master:

```bash
blender --background --threads 1 --python-exit-code 1 \
  --python "$PACKAGE/build.py" -- --output "$WORK/variants-candidate.blend"
blender --background "$WORK/variants-candidate.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/validate.py" -- \
  --negative-test --report "$WORK/validation.json"
blender --background "$WORK/variants-candidate.blend" --threads 8 \
  --python-exit-code 1 --python "$PACKAGE/preview.py" -- \
  --output-dir "$WORK" --views group-front group-threequarter A-front \
  B-threequarter C-threequarter B-head C-head B-shoulder C-shoulder \
  B-rest C-rest B-back C-back
```

For read-only inspection of the maintained master, open `$PACKAGE/variants.blend`, retaining a new scratch report/output path. Further variants, final population/placement, runtime animation, performance testing and integration require separate direction/approval.
