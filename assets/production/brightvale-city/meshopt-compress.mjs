#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUTPUT = path.join(HERE, 'city-meshopt-candidate.glb');
export const MAX_CANDIDATE_BYTES = 90 * 1024 * 1024;

const GLB_MAGIC = 'glTF';
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function parseGlb(input) {
  if (input.byteLength < 20) throw new Error('GLB is truncated');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67)
    throw new Error('Invalid GLB magic');
  if (view.getUint32(4, true) !== 2) throw new Error('Expected GLB version 2');
  if (view.getUint32(8, true) !== input.byteLength)
    throw new Error('GLB declared length does not match file length');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK)
    throw new Error('GLB JSON chunk must be first');
  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonLength;
  if (jsonEnd + 8 > input.byteLength)
    throw new Error('GLB JSON chunk is truncated');
  const json = JSON.parse(
    new TextDecoder().decode(input.subarray(jsonStart, jsonEnd)).trim(),
  );
  const binLength = view.getUint32(jsonEnd, true);
  if (view.getUint32(jsonEnd + 4, true) !== BIN_CHUNK)
    throw new Error('Expected one GLB BIN chunk');
  const binStart = jsonEnd + 8;
  if (binStart + binLength !== input.byteLength)
    throw new Error('Expected exactly one terminal GLB BIN chunk');
  const declaredBufferLength = json.buffers?.[0]?.byteLength;
  if (
    !Number.isInteger(declaredBufferLength) ||
    declaredBufferLength > binLength
  )
    throw new Error('Invalid embedded buffer length');
  return {
    json,
    jsonStart,
    jsonLength,
    binStart,
    binLength,
    bin: input.subarray(binStart, binStart + declaredBufferLength),
  };
}

function usesForViews(json) {
  const byView = new Map();
  const add = (accessorIndex, mode, primitiveMode) => {
    const accessor = json.accessors?.[accessorIndex];
    if (!accessor || !Number.isInteger(accessor.bufferView))
      throw new Error(`Unsupported or missing accessor ${accessorIndex}`);
    const old = byView.get(accessor.bufferView);
    if (old) throw new Error(`Buffer view ${accessor.bufferView} is shared`);
    byView.set(accessor.bufferView, {
      accessorIndex,
      accessor,
      mode,
      primitiveMode,
    });
  };
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const primitiveMode = primitive.mode ?? 4;
      for (const accessorIndex of Object.values(primitive.attributes ?? {}))
        add(accessorIndex, 'ATTRIBUTES', primitiveMode);
      if (primitive.indices !== undefined)
        add(primitive.indices, 'INDICES', primitiveMode);
    }
  }
  for (const [index, accessor] of (json.accessors ?? []).entries()) {
    if (accessor.sparse !== undefined)
      throw new Error(`Sparse accessor ${index} is not supported`);
    if (accessor.bufferView === undefined)
      throw new Error(`Accessor ${index} has no buffer view`);
  }
  if (byView.size !== (json.bufferViews ?? []).length)
    throw new Error(
      'Every buffer view must be used by exactly one mesh accessor',
    );
  return byView;
}

function componentByteSize(componentType) {
  const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const size = sizes[componentType];
  if (!size) throw new Error(`Unsupported glTF componentType ${componentType}`);
  return size;
}

export async function encodeGlb(
  input,
  {
    retainEncoded = true,
    expectedSourceHash,
    encoder = MeshoptEncoder,
    decoder = MeshoptDecoder,
  } = {},
) {
  if (!decoder?.supported || typeof decoder.decodeGltfBuffer !== 'function')
    throw new Error(
      'A supported MeshoptDecoder is required for lossless verification',
    );
  if (!encoder?.ready || typeof encoder.encodeGltfBuffer !== 'function')
    throw new Error('A compatible MeshoptEncoder is required');
  await Promise.all([encoder.ready, decoder.ready]);
  const parsed = parseGlb(input);
  const { json, bin } = parsed;
  if (expectedSourceHash && sha256(input) !== expectedSourceHash)
    throw new Error('Input GLB checksum does not match expected source hash');
  if (json.buffers.length !== 1 || json.buffers[0].uri !== undefined)
    throw new Error('Only one embedded GLB buffer is supported');

  const uses = usesForViews(json);
  const compressedParts = [];
  let compressedLength = 0;
  let inputViewBytes = 0;
  let attributeViews = 0;
  let indexViews = 0;
  for (const [viewIndex, bufferView] of json.bufferViews.entries()) {
    if (
      bufferView.buffer !== 0 ||
      bufferView.extensions ||
      bufferView.target === 0
    )
      throw new Error(`Unsupported buffer view layout at ${viewIndex}`);
    if (bufferView.byteStride !== undefined)
      throw new Error(`Interleaved buffer view ${viewIndex} is unsupported`);
    const use = uses.get(viewIndex);
    const accessor = use.accessor;
    if ((accessor.byteOffset ?? 0) !== 0)
      throw new Error(
        `Accessor ${use.accessorIndex} has an unsupported byte offset`,
      );
    if (accessor.count < 1 || !Number.isInteger(accessor.count))
      throw new Error(`Invalid accessor count at ${use.accessorIndex}`);
    const stride = bufferView.byteLength / accessor.count;
    if (!Number.isInteger(stride) || stride < 1)
      throw new Error(`Invalid accessor stride at ${use.accessorIndex}`);
    const expectedStride =
      componentByteSize(accessor.componentType) *
      ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }[
        accessor.type
      ] ?? 0);
    if (stride !== expectedStride)
      throw new Error(
        `Unexpected packed accessor layout at ${use.accessorIndex}`,
      );
    const start = bufferView.byteOffset ?? 0;
    const end = start + bufferView.byteLength;
    if (start % 4 !== 0 || end > bin.byteLength)
      throw new Error(`Misaligned or out-of-bounds buffer view ${viewIndex}`);
    if (use.mode === 'ATTRIBUTES' && stride % 4 !== 0)
      throw new Error(
        `Attribute stride ${stride} cannot use lossless ATTRIBUTES mode`,
      );
    if (use.mode === 'INDICES' && stride !== 2 && stride !== 4)
      throw new Error(`Index stride ${stride} must be 2 or 4 bytes`);
    if (use.mode === 'INDICES' && use.primitiveMode !== 4)
      throw new Error('Non-triangle index primitives are unsupported');
    const original = bin.subarray(start, end);
    const encoded = encoder.encodeGltfBuffer(
      original,
      accessor.count,
      stride,
      use.mode,
      0,
    );
    const decoded = new Uint8Array(original.byteLength);
    decoder.decodeGltfBuffer(
      decoded,
      accessor.count,
      stride,
      encoded,
      use.mode,
    );
    if (!Buffer.from(decoded).equals(Buffer.from(original)))
      throw new Error(`Lossless decode mismatch in buffer view ${viewIndex}`);
    const alignedOffset = (compressedLength + 3) & ~3;
    compressedLength = alignedOffset + encoded.byteLength;
    inputViewBytes += original.byteLength;
    if (use.mode === 'ATTRIBUTES') attributeViews += 1;
    else indexViews += 1;
    if (retainEncoded) compressedParts.push({ offset: alignedOffset, encoded });
    bufferView.extensions = {
      EXT_meshopt_compression: {
        buffer: 0,
        byteOffset: alignedOffset,
        byteLength: encoded.byteLength,
        byteStride: stride,
        count: accessor.count,
        mode: use.mode,
      },
    };
    // EXT_meshopt_compression is required, so the uncompressed fallback is absent.
    bufferView.byteOffset = 0;
    bufferView.byteLength = 0;
  }

  json.buffers[0].byteLength = compressedLength;
  json.extensionsUsed = [
    ...new Set([...(json.extensionsUsed ?? []), 'EXT_meshopt_compression']),
  ];
  json.extensionsRequired = [
    ...new Set([...(json.extensionsRequired ?? []), 'EXT_meshopt_compression']),
  ];
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPaddedLength = (jsonBytes.byteLength + 3) & ~3;
  const binPaddedLength = (compressedLength + 3) & ~3;
  const totalLength = 12 + 8 + jsonPaddedLength + 8 + binPaddedLength;
  const glb = retainEncoded ? Buffer.alloc(totalLength) : undefined;
  if (glb) {
    glb.write('glTF', 0);
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(totalLength, 8);
    glb.writeUInt32LE(jsonPaddedLength, 12);
    glb.writeUInt32LE(JSON_CHUNK, 16);
    glb.fill(0x20, 20, 20 + jsonPaddedLength);
    jsonBytes.copy(glb, 20);
    const binHeader = 20 + jsonPaddedLength;
    glb.writeUInt32LE(binPaddedLength, binHeader);
    glb.writeUInt32LE(BIN_CHUNK, binHeader + 4);
    const binOutStart = binHeader + 8;
    for (const part of compressedParts)
      Buffer.from(part.encoded).copy(glb, binOutStart + part.offset);
  }
  return {
    glb,
    sourceBytes: input.byteLength,
    sourceHash: sha256(input),
    outputBytes: totalLength,
    outputHash: glb ? sha256(glb) : undefined,
    inputViewBytes,
    compressedBytes: compressedLength,
    attributeViews,
    indexViews,
  };
}

async function main() {
  const options = new Map();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--write') options.set('write', true);
    else if (arg.startsWith('--')) {
      const value = args[index + 1];
      if (!value || value.startsWith('--'))
        throw new Error(`Missing value for ${arg}`);
      options.set(arg, value);
      index += 1;
    } else throw new Error(`Unexpected argument: ${arg}`);
  }
  const inputArg = options.get('--input');
  if (!inputArg)
    throw new Error(
      '--input is required; use reproduce-city.mjs for the full chain',
    );
  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(options.get('--output') ?? OUTPUT);
  const expectedSourceHash = options.get('--expected-source-sha256');
  const source = await readFile(inputPath);
  const report = await encodeGlb(source, {
    retainEncoded: options.has('write'),
    expectedSourceHash,
  });
  const output = options.has('write') ? outputPath : undefined;
  if (output) {
    if (report.outputBytes > MAX_CANDIDATE_BYTES)
      throw new Error(
        `Candidate exceeds 90 MiB test gate: ${report.outputBytes} bytes`,
      );
    await writeFile(output, report.glb, { flag: 'wx' });
  }
  console.log(
    JSON.stringify(
      {
        source: inputPath,
        sourceBytes: report.sourceBytes,
        sourceSha256: report.sourceHash,
        candidate: output ?? '(in-memory only)',
        candidateBytes: report.outputBytes,
        candidateSha256: report.outputHash ?? '(not written)',
        ratio: Number((report.outputBytes / report.sourceBytes).toFixed(6)),
        compressedBufferViewBytes: report.compressedBytes,
        originalBufferViewBytes: report.inputViewBytes,
        attributeViews: report.attributeViews,
        indexViews: report.indexViews,
        sizeGateBytes: MAX_CANDIDATE_BYTES,
        meshoptimizerVersion: '1.1.1',
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
