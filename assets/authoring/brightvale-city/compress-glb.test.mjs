import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MeshoptDecoder } from 'meshoptimizer';

const script = fileURLToPath(new URL('./compress-glb.mjs', import.meta.url));
function glb(json, bin) {
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const payload = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
  const out = Buffer.alloc(28 + text.length + payload.length);
  out.write('glTF'); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16); text.copy(out, 20);
  const at = 20 + text.length;
  out.writeUInt32LE(payload.length, at); out.writeUInt32LE(0x004e4942, at + 4); payload.copy(out, at + 8);
  return out;
}
function parse(data) {
  let at = 12, json, bin;
  while (at < data.length) {
    const n = data.readUInt32LE(at), type = data.readUInt32LE(at + 4), chunk = data.subarray(at + 8, at + 8 + n);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString());
    if (type === 0x004e4942) bin = chunk;
    at += n + 8;
  }
  return { json, bin };
}

test('compresses shared accessor views and decodes losslessly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'meshopt-glb-test-'));
  try {
    const positions = Buffer.alloc(4000 * 12);
    for (let i = 0; i < 4000; i++) {
      positions.writeFloatLE(i % 20, i * 12);
      positions.writeFloatLE(Math.floor(i / 20) % 20, i * 12 + 4);
      positions.writeFloatLE(0, i * 12 + 8);
    }
    const indices = Buffer.alloc(3996 * 2);
    for (let i = 0; i < 3996; i++) indices.writeUInt16LE(i, i * 2);
    const tail = Buffer.from([11, 22, 33, 44]);
    const sourceBin = Buffer.concat([positions, indices, tail]);
    const input = join(dir, 'in.glb'), output = join(dir, 'out.glb');
    await writeFile(input, glb({ asset: { version: '2.0' }, buffers: [{ byteLength: sourceBin.length }], bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length, byteStride: 12 },
      { buffer: 0, byteOffset: positions.length, byteLength: indices.length },
      { buffer: 0, byteOffset: positions.length + indices.length, byteLength: tail.length },
    ], accessors: [
      { bufferView: 0, componentType: 5126, count: 4000, type: 'VEC3' },
      { bufferView: 0, componentType: 5126, count: 4000, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3996, type: 'SCALAR' },
    ], meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }] }, sourceBin));
    const result = spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const { json, bin } = parse(await readFile(output));
    assert.equal(json.bufferViews[0].extensions.EXT_meshopt_compression.mode, 'ATTRIBUTES');
    assert.equal(json.bufferViews[1].extensions.EXT_meshopt_compression.mode, 'INDICES');
    assert.equal(json.accessors[0].bufferView, json.accessors[1].bufferView, 'shared accessor view remains shared');
    assert.deepEqual(bin.subarray(json.bufferViews[2].byteOffset, json.bufferViews[2].byteOffset + tail.length), tail, 'uncompressed fallback data follows compressed data');
    await MeshoptDecoder.ready;
    for (const [i, expected] of [positions, indices].entries()) {
      const view = json.bufferViews[i], ext = view.extensions.EXT_meshopt_compression;
      const decoded = new Uint8Array(view.byteLength);
      MeshoptDecoder.decodeGltfBuffer(decoded, ext.count, ext.byteStride, bin.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter);
      assert.deepEqual(Buffer.from(decoded), expected);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects invalid GLB and missing arguments without writing output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'meshopt-glb-error-'));
  try {
    const input = join(dir, 'bad.glb'), output = join(dir, 'out.glb');
    await writeFile(input, 'not a glb');
    await writeFile(output, 'keep previous output');
    const result = spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /valid GLB/);
    assert.equal(await readFile(output, 'utf8'), 'keep previous output', 'failed compression does not truncate existing output');
    const missingArgs = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.notEqual(missingArgs.status, 0);
    assert.match(missingArgs.stderr, /Usage:/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
