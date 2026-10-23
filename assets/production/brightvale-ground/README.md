# Brightvale ground runtime textures

These user-approved 1254×1254 RGB PNGs are used on the existing flat ground
meshes: `city-ground.png` on outer City Ground, its `city-ground-normal.png`
normal map, and `audience-plaza.png` on the inner Audience Plaza. These
production paths are the canonical maintained runtime files. Source
provenance, historical repeat reviews and correction tooling are in
`assets/authoring/brightvale-ground/`.

| Map             | Approved SHA-256                                                   | PNG bytes | Decoded RGBA8 | Mipmapped RGBA8 estimate |
| --------------- | ------------------------------------------------------------------ | --------: | ------------: | -----------------------: |
| City grass/moss | `d47a99fe8eb8e78465bd68399b5e27f71f184057c2578691e2dcc96315e5d09f` | 2,200,092 |     6,290,016 |                8,386,688 |
| City normal     | `f0009dc49e74439b8d8b735f6605272a9342db7e5029b781c02028d1cae8fe2`  | 3,040,503 |     6,290,016 |                8,386,688 |
| Plaza stone     | `08cad37f87a9a9204d63b7faba174d9d0959cbb4cd7922fac19513a3a3b244ed` |   114,266 |     6,290,016 |                8,386,688 |

The renderer uses sRGB, repeat wrapping, linear magnification, trilinear
mipmaps, and fixed anisotropy 4 (not queried from renderer capabilities). UVs
are rotated, world-space planar XZ. City span is 200 world units with a 36°
rotation and a half-tile center offset; plaza span is 22.5 units with an 18° rotation (about 2.4 repeats over
its ~54-unit diameter). Approved texture values are used directly, without
shader contrast adjustment. City normal uses linear `NoColorSpace`, the same
repeat/filter/anisotropy settings and UV orientation as city diffuse, with
default normal scale `(1, 1)`. City ground has no emissive fill, so it responds
to actual lighting. Plaza keeps its
existing restrained emissive fill across Audience, Twilight, and Radiant
lighting. Both lit toon diffuse terms continue to receive existing shadows. Existing
plane/circle geometry is unchanged. The existing two meshes remain the only
ground draws; the city mesh additionally binds its normal map. Memory estimates are decoded texture storage;
actual GPU driver overhead varies. The three maps total 25,160,064 bytes
(~24.0 MiB) with mip chains.
