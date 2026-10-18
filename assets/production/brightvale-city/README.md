# Brightvale city runtime delivery

The app loads [`city-meshopt.glb`](city-meshopt.glb): **59,559,056 bytes**,
SHA-256 `db79454415423002bf87eb36d845a427f2c6c3e2dc4a3e63a05e4b2ded1be878`,
2,589,764 triangles, 2,304 mesh nodes and 107 materials. It requires
`EXT_meshopt_compression`; runtime uses Three.js's bundled decoder. The delivery
contract is in [`meshopt-manifest.json`](meshopt-manifest.json); the authored
material identities/roles are in [`material-map.json`](material-map.json).

## Materials and excluded presentation

The user selected imported standard/physical city materials after an actual-app
comparison. Runtime-owned clones preserve authored properties/maps and isolate
dynamic window emission from materials shared with Observatory. The 107 city
materials remain separate (104 standard, 3 physical); other game surfaces remain
Toon. Lights, renderer settings, camera, accepted placement and highway are
unchanged. No baking, lighting retuning, target-device performance claim, or
release approval is implied.

## Editable source and future export

Continue city edits in [`assets/authoring/brightvale-city/production.blend`](../../authoring/brightvale-city/production.blend);
the original high-detail [`city.blend`](../../authoring/brightvale-city/city.blend)
remains unchanged. The shipped GLB is retained as the current runtime authority.
Export a review candidate with `npm run export:brightvale-city`; the default path
is ignored `test-results/brightvale-city/city-candidate.glb`. The command never
overwrites the shipped asset. Review the candidate in-game before deliberately
copying it into this package. It exports current mesh normals and PBR properties
and does not force the saved `delivery_normal` attribute after edits. See the
authoring README for the workflow and limitations; byte-identical regeneration
is not required.

The actual-app smoke remains available:

```bash
CITY_REVIEW_CONTROLLED=1 CITY_REVIEW_INTEGRATED_SMOKE=1 CITY_REVIEW_CURRENT_PBR=1 \
  CITY_REVIEW_VARIANT=meshopt timeout 150 \
  node tests/browser/brightvale/city-production-review.mjs
```

Disposable capture output goes under gitignored `test-results/brightvale-city/`.
