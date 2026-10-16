# Brightvale ground texture briefs

## City Ground — approved direction

Texture-only treatment for the existing, flat outer City Ground plane. Create a
seamless, clean cel-shaded magical meadow: muted living greens with broad,
low-contrast organic grass/moss variation and restrained sage highlights. The
texture must read as natural green terrain at the large projected scale of the
outer ground, while staying visually quiet beneath the city, crowd, and highway.

## City Ground constraints

- Texture only. Do not add or imply geometry, height, relief, or silhouettes.
- No fine individual blades, high-frequency noise, visible repeated motifs,
  paths, buildings, text, baked shadows, glow, or lighting.
- Keep a stable green identity when runtime Audience/Twilight/Radiant lighting
  and material tinting are applied; integration must avoid tinting green away.
- Retain existing outer ground geometry, elevation, framing, and shadow behavior.

## City Ground delivery

Square seamless tile, requested at 1024×1024 for practical inspection and
world-space repeat tuning. This is a candidate choice, not a project texture or
memory budget; actual generated dimensions and decoded size will be recorded.
No alpha is needed. Color texture, intended for sRGB sampling.

## Direction references

- User-approved direction in task conversation, 2026-10-15: organic green City
  Ground; texture-only; seamless; broad green/moss; preserve green under mode
  tint; existing shadows; no new geometry.
- Existing combined review: `assets/production/brightvale-scene-review/audience.webp`
  and `twilight.webp` (existing flat ground and current scene framing).
- Project direction context: [Brightvale asset direction](../../../docs/asset-direction.md) and
  `assets/authoring/brightvale-scene-review/composition-brief.md`.

Description approval and task-specific generation authorization are recorded
in the user request. Exact artwork approval remains pending.

## Inner Audience Plaza — approved direction

Create a second, distinct texture for the existing flat circular audience
plaza: smooth, quiet blue-violet stone with broad, restrained mineral color
variation in the same clean cel-shaded magical style. It should contrast with
the green outer City Ground while remaining subdued beneath the playfield and
crowd. The user amended the scope to request an audience-plaza texture so it is
not left plain brown; the parent confirmed the smooth blue-violet stone
direction.

Keep it as flat albedo only. No loud grout, checker pattern, fine noise, tiled
radial motif, baked lighting/shadows/glow, text, border, or geometry. Preserve
the existing circle and shadow behavior; runtime must keep city green and plaza
blue-violet legible under Audience, Twilight, and Radiant lighting.

## Inner Plaza delivery choice

Use a square seamless, non-directional tile for planar/world-space mapping over
the existing circle. Avoid center-specific composition and circular/radial
details that would repeat. Requested size is 1024×1024 as a practical square
candidate, not an approved texture or memory budget. Opaque sRGB color texture;
actual output dimensions and size will be recorded. Exact artwork approval is
pending for both textures; runtime integration is not authorized by art approval.
