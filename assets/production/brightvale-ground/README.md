# Brightvale ground runtime textures

These exact user-approved 1254×1254 RGB PNGs are used on the existing flat
ground meshes: `city-ground.png` on outer City Ground and `audience-plaza.png`
on the inner Audience Plaza. These production paths are the canonical maintained
texture files (there are no separate authoring candidate copies or copy/build
script). Source provenance, historical repeat reviews and correction tooling
are in `assets/authoring/brightvale-ground/`.

| Map             | Approved SHA-256                                                   | PNG bytes | Decoded RGBA8 | Mipmapped RGBA8 estimate |
| --------------- | ------------------------------------------------------------------ | --------: | ------------: | -----------------------: |
| City grass/moss | `d47a99fe8eb8e78465bd68399b5e27f71f184057c2578691e2dcc96315e5d09f` | 2,200,092 |     6,290,016 |                8,386,688 |
| Plaza stone     | `08cad37f87a9a9204d63b7faba174d9d0959cbb4cd7922fac19513a3a3b244ed` |   114,266 |     6,290,016 |                8,386,688 |

The renderer uses sRGB, repeat wrapping, linear magnification, trilinear
mipmaps, and fixed anisotropy 4 (not queried from renderer capabilities). UVs
are rotated, world-space planar XZ. City span is 100 world units with a 36°
rotation and a half-tile center offset; plaza span is 22.5 units with an 18° rotation (about 2.4 repeats over
its ~54-unit diameter). Approved texture values are used directly, without
shader contrast adjustment. Ground maps contribute a restrained color-matched
emissive fill so their green and blue-violet color survives Audience, Twilight
and Radiant lighting;
the lit toon diffuse term continues to receive existing shadows. Existing
plane/circle geometry is unchanged. No additional draw calls: the two existing
ground meshes each bind maps. Memory estimates are decoded texture storage;
actual GPU driver overhead varies. Both maps total 16,773,376 bytes (~16.0 MiB)
with mip chains.
