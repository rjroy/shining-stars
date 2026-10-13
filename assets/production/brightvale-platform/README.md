# Brightvale platform — production transfer

Authorized structural lane of `shining-stars-4f4.31`. **Production candidate;
combined browser review and runtime acceptance remain pending.** User approved
the pilots and authorized remaining production. No game edits or source changes.

[platform.glb](platform.glb) transfers the **original approved platform**, not a
study/reference duplicate. Authority and approval evidence remain in
[authoring](../../authoring/neon-twilight-platform/README.md). Source SHA256
`ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af`.
No original generator is executed. No geometry reduction, bake, compression,
duplicate `.blend`, textures, rigs or animation. The original remains editable.

## Consumer contract

- **970,376 bytes; 53 nodes; 24,446 triangles; 66 material primitives; 27 roles.**
  Counts are artifact measurements, not browser draw calls or GPU bytes.
- Bounds in glTF: `(-6,-.45,-2.7)…(6,.695,2.8)`, dimensions
  `12 × 1.145 × 5.5`. Units are **provisional, not approved meters**.
- Blender `(x,y,z)` → glTF `(x,z,-y)`: X lateral, Y up, front +Z. Internal node
  origins are preserved; do not recenter nodes or axis-convert a loaded GLB.
- Apply the `playfield.gltf` matrix from
  [structure-layout](../brightvale-structure-layout.json) to the **whole loaded
  scene**, exactly as for the highway and existing endcaps. That shared transform
  retains the approved study's **14°** playfield tilt and placement.
- All gold, shield, chassis, panels, inlays, hit/rim emitters and lane seams keep
  their named material regions. Linear base/PBR/emission values are in
  [technical-validation](technical-validation.json). No source studio floor,
  lights, camera, compositor or historical custom properties are exported.
- Four mineral-panel procedural graphs use their **authored constant base color
  and roughness**, not arbitrary gray/white defaults; fine noise is not baked.
  Four pure hit emitters map to black-base Principled emission, preserving RGB ×
  strength. `KHR_materials_emissive_strength` carries intensities above 1.
  Browser shaders must preserve emission as a separate role; AgX/Blender glow
  and reflections are not promised. No mode-specific duplicate assets.

## Reproduce and verify

Blender **5.2.1 LTS**, glTF exporter **5.2.40**, installed RNA inspected; no installs.
Paths resolve from scripts, not working directory. Keep these three structural
production packages and authoritative sibling authoring inputs together.
[structural.py](structural.py) is the deliberately shared implementation;
highway and framing wrappers import it, avoiding three divergent validators.

```bash
P="$PWD/assets/production/brightvale-platform"
W=$(mktemp -d /tmp/opencode/platform-production-XXXXXX)
timeout 240 blender --background --threads 8 --python-exit-code 1 \
  --python "$P/export.py" -- --output "$W/platform.glb" --report "$W/export.json"
timeout 240 blender --background --threads 8 --python-exit-code 1 \
  --python "$P/validate.py" -- --input "$P/platform.glb" \
  --compare "$W/platform.glb" --report "$W/validation.json" --negative-test
# All structural exports, layout, joins, and source/script integrity:
timeout 1200 python "$P/verify.py" --report "$W/relocated.json"
```

All outputs must be new direct package-root files or authorized scratch. Source
packages and nested production directories remain read-only, even when relocated
under scratch. Exports validate before exclusive destination creation; no source
is saved. Failures retain identified scratch; successful reproduction removes it.

## Evidence and limits

[verification.json](verification.json) records **byte-identical independent
relocated reproduction of all five structural GLBs and the layout**, unchanged
original blends/scripts, negative tests, reimport results and assembled joins.
Direct source-to-GLB positions match exactly; maximum normal component error is
`.00006557`. **160 near-zero-area triangles are inherited** from evaluated
platform bevel triangulation; no new ones were introduced. Blender reimport
normal reconstruction has maximum component error `.00236124`; the direct GLB
normal check is separate and strict.

No geometry was simplified, so the current actual
[Audience](../../authoring/brightvale-scene-review/preview-audience.webp),
[Twilight](../../authoring/brightvale-scene-review/preview-twilight.webp) and
[module](../../authoring/brightvale-outer-framing/neutral-modules.webp) evidence
was opened and inspected rather than inventing new before/after renders.
The broad tilted road remains dominant; platform/cap joins and the section/post
silhouette are unchanged. Those images are **Blender evidence**, not proof of
portable appearance. Browser loader/shader/mode lighting/performance, device
targets, responsive crop and integration acceptance belong to the parent lane.
No arbitrary polygon budget or physical-support/collision claim is made.
