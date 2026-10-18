import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { encodeGlb, parseGlb, sha256 } from './meshopt-compress.mjs';

function makeGlb() {
  const position = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) =>
    position.writeFloatLE(value, index * 4),
  );
  const indices = Buffer.from([0, 0, 1, 0, 2, 0]);
  const binary = Buffer.concat([position, indices]);
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ byteLength: binary.length }],
      bufferViews: [
        {
          buffer: 0,
          byteOffset: 0,
          byteLength: position.length,
          target: 34962,
        },
        {
          buffer: 0,
          byteOffset: position.length,
          byteLength: indices.length,
          target: 34963,
        },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    }),
  );
  const jsonPadded = Buffer.concat([
    json,
    Buffer.alloc((4 - (json.length % 4)) % 4, 0x20),
  ]);
  const binaryPadded = Buffer.concat([
    binary,
    Buffer.alloc((4 - (binary.length % 4)) % 4),
  ]);
  const total = 12 + 8 + jsonPadded.length + 8 + binaryPadded.length;
  const glb = Buffer.alloc(total);
  glb.write('glTF', 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(total, 8);
  glb.writeUInt32LE(jsonPadded.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  jsonPadded.copy(glb, 20);
  const binHeader = 20 + jsonPadded.length;
  glb.writeUInt32LE(binaryPadded.length, binHeader);
  glb.writeUInt32LE(0x004e4942, binHeader + 4);
  binaryPadded.copy(glb, binHeader + 8);
  return glb;
}

test('compresses packed attributes and indices with byte-identical decoding', async () => {
  const source = makeGlb();
  const sourceHash = sha256(source);
  const result = await encodeGlb(source, { expectedSourceHash: sourceHash });
  assert.ok(result.glb);
  assert.equal(result.attributeViews, 1);
  assert.equal(result.indexViews, 1);
  assert.ok(result.outputBytes > 0);
  const output = parseGlb(result.glb);
  assert.deepEqual(output.json.extensionsRequired, ['EXT_meshopt_compression']);
  const original = parseGlb(source);
  for (const [index, view] of output.json.bufferViews.entries()) {
    const ext = view.extensions.EXT_meshopt_compression;
    assert.equal(view.byteLength, 0, 'no uncompressed fallback retained');
    const encoded = output.bin.subarray(
      ext.byteOffset,
      ext.byteOffset + ext.byteLength,
    );
    const decoded = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(
      decoded,
      ext.count,
      ext.byteStride,
      encoded,
      ext.mode,
    );
    const sourceView = original.json.bufferViews[index];
    const sourceAccessor = original.json.accessors[index];
    const raw = original.bin.subarray(
      sourceView.byteOffset ?? 0,
      (sourceView.byteOffset ?? 0) + sourceView.byteLength,
    );
    assert.deepEqual(Buffer.from(decoded), raw);
    assert.equal(sourceAccessor.count, ext.count);
  }
});

test('rejects missing decoder and unsupported interleaved layouts', async () => {
  const source = makeGlb();
  await assert.rejects(
    encodeGlb(source, { expectedSourceHash: sha256(source), decoder: null }),
    /MeshoptDecoder is required/,
  );
  const parsed = parseGlb(source);
  parsed.json.bufferViews[0].byteStride = 16;
  // Build the malformed source directly by replacing only its JSON chunk.
  const json = Buffer.from(JSON.stringify(parsed.json));
  const padded = Buffer.concat([
    json,
    Buffer.alloc((4 - (json.length % 4)) % 4, 0x20),
  ]);
  const binary = source.subarray(parsed.binStart - 8, source.length);
  const total = 12 + 8 + padded.length + binary.length;
  const bad = Buffer.alloc(total);
  bad.write('glTF', 0);
  bad.writeUInt32LE(2, 4);
  bad.writeUInt32LE(total, 8);
  bad.writeUInt32LE(padded.length, 12);
  bad.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(bad, 20);
  binary.copy(bad, 20 + padded.length);
  await assert.rejects(
    encodeGlb(bad, { expectedSourceHash: sha256(bad) }),
    /Interleaved buffer view/,
  );
});

test('rejects a corrupt or unexpected GLB header', () => {
  const bytes = makeGlb();
  bytes.writeUInt32LE(1, 4);
  assert.throws(() => parseGlb(bytes), /version 2/);
});
