# Brightvale production pipeline reference

Concrete examples of a proven asset-to-browser workflow, pinned to commit
`0a38b74` (`shining-stars-4f4.31`). Treat its scripts and package structure as
examples of the implementation at that revision, not as guaranteed APIs,
exporter recipes, budgets, or approval of future work. Read the maintained
package README and source/provenance records before reusing any step.

## Existing examples

- [Endcaps production README](../../../../assets/production/brightvale-platform-endcaps/README.md): a completed GLB transfer/material pilot, with immutable authoring source and reproducible export/validation. It established a path; it is not a required pilot for every later asset.
- [City production README](../../../../assets/production/brightvale-distant-city/README.md): documented reduction and export, retained material roles/emission, the study transform, and the distinction between unique primitives and placed primitives.
- [Crowd production README](../../../../assets/production/brightvale-crowd/README.md): a reduced nine-pose static bank, placement/orientation contract, role/material preservation, and explicit limits on visibility and instancing. Static motion remains a scoped review choice; required animation is unresolved.
- [Combined browser review README](../../../../assets/production/brightvale-scene-review/README.md), [harness](../../../../assets/production/brightvale-scene-review/main.js), and [validator](../../../../assets/production/brightvale-scene-review/validate.sh): assemble the production GLBs with the authoritative layout and compare paired Audience/Twilight browser captures.

The authoring `.blend` files and their original scripts remain the authority and
are immutable inputs. Blender derivatives, export scripts, and validation
evidence are already recorded in their maintained packages; do not make
duplicate derivatives just to repeat the established pipeline. The structure
layout JSON is the assembly authority. Preserve each asset's documented axes,
units, origins, role/emissive semantics, and matrices. Apply whole-scene and
instance transforms once; glTF loading must not be followed by an extra axis
conversion or eye-estimated placement.

## Transfer, appearance, and counts

A valid GLB and successful loader/material transfer establish structural
compatibility, not accepted browser appearance. Appearance review uses the same
scene geometry, study camera, and material-role mapping in Audience and Twilight,
with scene-pixel comparison. Blender reflection environments and light scales
do not map numerically to the browser. The review's deliberate toon mapping
does not reproduce PBR metallic/roughness response; that is a disclosed material
tradeoff, not an exporter failure.

Keep metrics separate: unique geometry/resources, assembled placements, actual
instanced multiplicity (`InstancedMesh.count`), frame-rendered triangles after
visibility/culling, and renderer draw calls answer different questions. The
historical combined review reported 401,581 assembled-scene triangles versus
401,177 rendered-frame triangles and 485 draw calls under local SwiftShader.
These are examples from that capture only, not budgets or device claims. A
triangle-accounting regression fixture should include both a normal mesh and
an instanced mesh with more than one instance. Linked/reused GLB meshes and
scene clones are not by themselves GPU instancing; batching must preserve
materials and each instance's full matrix.

Frustum intersection is not evidence that an audience member is unobstructed.
Use image, raycast, or ID-buffer review when visibility/occlusion needs evidence,
and label what the check actually establishes. Partial occlusion is acceptable;
complete hiding is not. The example's 25 people are not an approved final count.
