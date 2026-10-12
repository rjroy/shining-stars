# Placement brief and observations

Approved scope: keep the accepted ground composition; relocate existing crowd only so none is completely hidden. **Partial occlusion is allowed and complete hiding is forbidden as standing rules**, not temporary concessions for a study. Preserve partial silhouette overlap, stay on the circular plaza and outside the playing area, keep feet at existing Z=8.25, face the player. No demand for fully visible bodies or mechanically perfect head-center rays.

Density clarification: **“80%” describes crowd density, not overall scene quality.** The present ten-person sample is unchanged in population; whether it supplies the intended density remains unresolved and separate from this placement/visibility pass. Parent will reconcile the density follow-up. Do not add people within this task.

One deterministic pass retained; no subsequent polish iteration. Coordinates are authoring units, not approved meters.

| Instance | Old XY | New XY | Visible 2-pixel-grid samples | Upper-body samples |
|---|---|---|---:|---:|
| L01 | −8, 1.3 | unchanged | 488 | 487 |
| L02 | −9.3, 5 | unchanged | 343 | 314 |
| L03 | −7.5, 8.6 | −11, 8.6 | 241 | 221 |
| L04 | −9.2, 9.4 | −13, 12.5 | 251 | 203 |
| L05 | −7.8, 16.6 | −15, 18 | 223 | 145 |
| R01 | 8, .8 | unchanged | 605 | 576 |
| R02 | 9.2, 3.7 | unchanged | 455 | 390 |
| R03 | 7.8, 10.4 | 11, 9 | 367 | 245 |
| R04 | 9.3, 11.7 | 13.3, 13 | 336 | 231 |
| R05 | 7.5, 18 | 15, 19 | 212 | 134 |

Evidence uses the actual saved gameplay projection. Rays cover each evaluated screen rectangle on a **2×2-pixel grid**, counting only the **first-hit owning instance**, including occlusion by people, endcaps and other scenery. These are sampled visible pixels, not full-resolution mask counts or inferred visibility from boxes. Upper-body samples hit above ground +.9 authoring units. Validation also measures actual evaluated foot/plan bounds, plaza margin, in-frame placement, facing and all 820 lane rays. Mode geometry/camera is identical, so geometric sample ownership applies to both renders; actual inspection additionally checks the darker mode's read.

Visual inspection: each side now reads as five staggered, small spectators. Left yellow L03 and orange L04 have recognizable heads/upper silhouettes between the front pair and rear teal L05; right orange R03, yellow R04 and rear teal R05 likewise read independently. Caps still hide parts of the front bodies and nearby people overlap some arms/legs. This is intentional acceptable partial obscuration, not anatomy loss or burial. Twilight reduces facial and clothing detail, but the heads, colored upper bodies and gestures remain readable against the ground.

Limitations: loose side clusters are a composition sample, not a finished crowd layout. Rear figures remain small, partly overlapping, and dimmer in Twilight. No lighting compensation or form change was made. Existing skyline crop, suspended plane-only plaza construction and runtime-camera/material uncertainty are inherited unchanged. Parent must inspect the linked actual images before user presentation.
