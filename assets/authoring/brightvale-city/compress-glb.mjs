import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('Usage: node compress-glb.mjs input.glb output.glb');

function parseGlb(data) {
  if (data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) throw new Error('Input is not a valid GLB 2.0 file');
  let at = 12, json, bin;
  while (at < data.length) {
    const size = data.readUInt32LE(at), type = data.readUInt32LE(at + 4);
    const chunk = data.subarray(at + 8, at + 8 + size);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').trimEnd());
    if (type === 0x004e4942) bin = chunk;
    at += 8 + size;
  }
  if (!json || !bin || json.buffers?.[0]?.byteLength > bin.length) throw new Error('GLB must contain one JSON and one binary buffer');
  return { json, bin };
}

function makeGlb(json, bin) {
  const jsonChunk = Buffer.from(JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4, ' '));
  const binChunk = Buffer.from(bin);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  out.write('glTF'); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(out, 20);
  const binAt = 20 + jsonChunk.length;
  out.writeUInt32LE(binChunk.length, binAt); out.writeUInt32LE(0x004e4942, binAt + 4); binChunk.copy(out, binAt + 8);
  return out;
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const { json, bin } = parseGlb(await readFile(inputPath));
const refs = json.accessors.map(() => []);
for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
  for (const [semantic, accessor] of Object.entries(primitive.attributes ?? {})) refs[accessor]?.push({ kind: 'attribute', semantic });
  for (const accessor of Object.values(primitive.targets ?? {}).flatMap(target => Object.values(target))) refs[accessor]?.push({ kind: 'attribute' });
  if (primitive.indices !== undefined) refs[primitive.indices]?.push({ kind: 'index', mode: primitive.mode ?? 4 });
}
for (const animation of json.animations ?? []) for (const sampler of animation.samplers ?? []) {
  refs[sampler.input]?.push({ kind: 'attribute' }); refs[sampler.output]?.push({ kind: 'attribute' });
}
const viewAccessors = (json.bufferViews ?? []).map(() => []);
for (const [index, accessor] of json.accessors.entries()) if (accessor.bufferView !== undefined) viewAccessors[accessor.bufferView].push({ accessor, refs: refs[index] });
let compressed = Buffer.alloc(0), count = 0;
const compressedViewIndices = new Set();
for (const [index, view] of (json.bufferViews ?? []).entries()) {
  if (view.buffer !== 0 || view.extensions?.EXT_meshopt_compression) continue;
  const used = viewAccessors[index];
  if (!used.length || used.some(item => item.accessor.sparse || !item.refs.length)) continue;
  const kinds = new Set(used.flatMap(item => item.refs.map(ref => ref.kind)));
  if (kinds.size !== 1) continue;
  const rawAt = (view.byteOffset ?? 0), raw = bin.subarray(rawAt, rawAt + view.byteLength);
  let mode, stride, elements;
  if (kinds.has('index')) {
    const accessors = used.map(item => item.accessor);
    const component = accessors[0].componentType;
    if (accessors.some(a => a.componentType !== component || a.type !== 'SCALAR')) continue;
    stride = component === 5123 ? 2 : component === 5125 ? 4 : 0;
    if (!stride || raw.length % stride) continue;
    elements = raw.length / stride;
    mode = 'INDICES';
  } else {
    stride = view.byteStride ?? (raw.length / used[0].accessor.count);
    if (!Number.isInteger(stride) || stride < 4 || stride > 256 || stride % 4 || raw.length % stride) continue;
    elements = raw.length / stride; mode = 'ATTRIBUTES';
  }
  let encoded;
  try { encoded = Buffer.from(MeshoptEncoder.encodeGltfBuffer(raw, elements, stride, mode)); }
  catch { continue; }
  if (encoded.length >= raw.length) continue;
  const decoded = new Uint8Array(raw.length);
  MeshoptDecoder.decodeGltfBuffer(decoded, elements, stride, encoded, mode, 'NONE');
  if (!Buffer.from(decoded).equals(raw)) throw new Error(`Meshopt round-trip mismatch in buffer view ${index}`);
  while (compressed.length % 4) compressed = Buffer.concat([compressed, Buffer.alloc(1)]);
  const offset = compressed.length;
  compressed = Buffer.concat([compressed, encoded]);
  view.extensions = { ...view.extensions, EXT_meshopt_compression: { buffer: 0, byteOffset: offset, byteLength: encoded.length, byteStride: stride, count: elements, mode, filter: 'NONE' } };
  delete view.byteOffset;
  compressedViewIndices.add(index);
  count++;
}
if (!count) throw new Error('No eligible buffer views compressed; output not written');
let fallback = Buffer.alloc(0);
for (const [index, view] of json.bufferViews.entries()) if (!compressedViewIndices.has(index)) {
  while (fallback.length % 4) fallback = Buffer.concat([fallback, Buffer.alloc(1)]);
  const offset = fallback.length;
  const start = view.byteOffset ?? 0;
  fallback = Buffer.concat([fallback, bin.subarray(start, start + view.byteLength)]);
  view.byteOffset = compressed.length + offset;
}
const payload = Buffer.concat([compressed, fallback]);
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_meshopt_compression'])];
json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_meshopt_compression'])];
json.buffers[0].byteLength = payload.length;
const result = makeGlb(json, payload);
const stagedOutput = join(dirname(outputPath), `.${randomUUID()}.glb.tmp`);
try {
  await writeFile(stagedOutput, result, { flag: 'wx' });
  await rename(stagedOutput, outputPath);
} finally {
  await rm(stagedOutput, { force: true });
}
console.log(`Compressed ${count}/${json.bufferViews.length} buffer views: ${result.length} bytes`);
