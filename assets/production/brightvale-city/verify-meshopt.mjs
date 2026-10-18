#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { sha256, parseGlb } from './meshopt-compress.mjs';

const [sourceArg, candidateArg, expectedSourceHash] = process.argv.slice(2);
if (!sourceArg || !candidateArg || !expectedSourceHash)
  throw new Error(
    'Usage: node verify-meshopt.mjs source.glb candidate.glb expected-source-sha256',
  );
const INPUT = path.resolve(sourceArg);
const CANDIDATE = path.resolve(candidateArg);
const HASH = (value) => createHash('sha256').update(value).digest('hex');

function normalizedSourceJson(sourceJson) {
  const json = structuredClone(sourceJson);
  json.buffers[0].byteLength = 0;
  json.extensionsUsed = (json.extensionsUsed ?? []).filter(
    (name) => name !== 'EXT_meshopt_compression',
  );
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(
    (name) => name !== 'EXT_meshopt_compression',
  );
  if (!json.extensionsUsed.length) delete json.extensionsUsed;
  if (!json.extensionsRequired.length) delete json.extensionsRequired;
  for (const bufferView of json.bufferViews) {
    delete bufferView.extensions?.EXT_meshopt_compression;
    if (!Object.keys(bufferView.extensions ?? {}).length)
      delete bufferView.extensions;
    bufferView.byteOffset = 0;
    bufferView.byteLength = 0;
  }
  return json;
}

function meshoptSourceJson(candidateJson) {
  const json = structuredClone(candidateJson);
  json.buffers[0].byteLength = 0;
  json.extensionsUsed = (json.extensionsUsed ?? []).filter(
    (name) => name !== 'EXT_meshopt_compression',
  );
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(
    (name) => name !== 'EXT_meshopt_compression',
  );
  if (!json.extensionsUsed.length) delete json.extensionsUsed;
  if (!json.extensionsRequired.length) delete json.extensionsRequired;
  for (const bufferView of json.bufferViews) {
    delete bufferView.extensions?.EXT_meshopt_compression;
    if (!Object.keys(bufferView.extensions ?? {}).length)
      delete bufferView.extensions;
    bufferView.byteOffset = 0;
    bufferView.byteLength = 0;
  }
  return json;
}

function load(bytes, decoder) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    if (decoder) loader.setMeshoptDecoder(decoder);
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    loader.parse(copy, '', resolve, reject);
  });
}

function graphSignature(gltf) {
  const objects = [];
  const geometries = new Set();
  const materials = new Set();
  gltf.scene.traverse((object) => {
    const entry = {
      type: object.type,
      name: object.name,
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray(),
      matrix: object.matrix.toArray(),
      userData: object.userData,
    };
    if (object.isMesh) {
      const geometry = object.geometry;
      geometries.add(geometry);
      const attributes = {};
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        const bytes = Buffer.from(
          attribute.array.buffer,
          attribute.array.byteOffset,
          attribute.array.byteLength,
        );
        attributes[name] = {
          count: attribute.count,
          itemSize: attribute.itemSize,
          normalized: attribute.normalized,
          hash: HASH(bytes),
        };
      }
      const index = geometry.index;
      entry.geometry = {
        attributes,
        index: index
          ? {
              count: index.count,
              hash: HASH(
                Buffer.from(
                  index.array.buffer,
                  index.array.byteOffset,
                  index.array.byteLength,
                ),
              ),
            }
          : null,
      };
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.add(material);
        entry.material = [
          ...(entry.material ?? []),
          {
            name: material.name,
            type: material.type,
            userData: material.userData,
            color: material.color?.getHex(),
            emissive: material.emissive?.getHex(),
            emissiveIntensity: material.emissiveIntensity,
            metalness: material.metalness,
            roughness: material.roughness,
            side: material.side,
          },
        ];
      }
    }
    objects.push(entry);
  });
  const meshes = objects.filter((object) => object.geometry);
  const triangles = meshes.reduce(
    (sum, mesh) => sum + (mesh.geometry.index?.count ?? 0) / 3,
    0,
  );
  return {
    objects,
    meshCount: meshes.length,
    triangleCount: triangles,
    geometryCount: geometries.size,
    materialCount: materials.size,
  };
}

function dispose(gltf) {
  const geometries = new Set();
  const materials = new Set();
  gltf.scene.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material)
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

const sourceBytes = await readFile(INPUT);
assert.equal(sha256(sourceBytes), expectedSourceHash, 'source hash changed');
const candidateBytes = await readFile(CANDIDATE);
const sourceJson = parseGlb(sourceBytes).json;
const candidateJson = parseGlb(candidateBytes).json;
assert.deepEqual(
  normalizedSourceJson(sourceJson),
  meshoptSourceJson(candidateJson),
  'all non-compression glTF metadata must be unchanged',
);
assert.ok(candidateJson.extensionsRequired.includes('EXT_meshopt_compression'));
assert.ok(candidateJson.bufferViews.every((view) => view.byteLength === 0));

let sourceGltf = await load(sourceBytes);
const sourceGraph = graphSignature(sourceGltf);
dispose(sourceGltf);
sourceGltf = undefined;
global.gc?.();

let missingDecoderError;
try {
  const noDecoder = await load(candidateBytes);
  dispose(noDecoder);
} catch (error) {
  missingDecoderError = error;
}
assert.match(String(missingDecoderError), /setMeshoptDecoder must be called/);

const candidateGltf = await load(candidateBytes, MeshoptDecoder);
const candidateGraph = graphSignature(candidateGltf);
assert.deepEqual(
  candidateGraph,
  sourceGraph,
  'GLTFLoader graph differs from source',
);
assert.equal(candidateGraph.meshCount, 2304);
assert.equal(candidateGraph.triangleCount, 2_589_764);
assert.equal(candidateGraph.materialCount, 107);
dispose(candidateGltf);

console.log(
  JSON.stringify(
    {
      source: path.basename(INPUT),
      sourceBytes: sourceBytes.byteLength,
      sourceSha256: expectedSourceHash,
      candidate: path.basename(CANDIDATE),
      candidateBytes: candidateBytes.byteLength,
      candidateSha256: sha256(candidateBytes),
      ratio: Number(
        (candidateBytes.byteLength / sourceBytes.byteLength).toFixed(6),
      ),
      loader: 'Three.js GLTFLoader 0.186.1 with bundled MeshoptDecoder',
      requiredDecoderFailure: String(missingDecoderError),
      graph: {
        meshCount: candidateGraph.meshCount,
        triangles: candidateGraph.triangleCount,
        uniqueGeometries: candidateGraph.geometryCount,
        materials: candidateGraph.materialCount,
        sourceEquivalent: true,
      },
    },
    null,
    2,
  ),
);
