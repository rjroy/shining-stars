import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const assetTypes = new Map([
  ['glb', 'model'],
  ['gltf', 'model'],
  ['png', 'texture'],
  ['jpg', 'texture'],
  ['jpeg', 'texture'],
  ['webp', 'texture'],
  ['mp3', 'audio'],
  ['ogg', 'audio'],
  ['wav', 'audio'],
]);

function decodeEscape(source, index) {
  const first = source[index];
  if (first === undefined) return { value: '', next: index };

  if (first === 'u' && source[index + 1] === '{') {
    const end = source.indexOf('}', index + 2);
    const codePoint = end === -1 ? NaN : Number.parseInt(source.slice(index + 2, end), 16);
    if (Number.isInteger(codePoint) && codePoint <= 0x10ffff)
      return { value: String.fromCodePoint(codePoint), next: end + 1 };
  }
  if (first === 'u' || first === 'x') {
    const length = first === 'u' ? 4 : 2;
    const hex = source.slice(index + 1, index + 1 + length);
    if (new RegExp(`^[0-9a-f]{${length}}$`, 'i').test(hex))
      return { value: String.fromCharCode(Number.parseInt(hex, 16)), next: index + 1 + length };
  }

  // CSS permits up to six hex digits after a backslash; JS's shorter escapes
  // are handled by the same rule. A non-hex escape quotes the next character.
  const hex = source.slice(index).match(/^[0-9a-f]{1,6}/i)?.[0];
  if (hex) {
    const codePoint = Number.parseInt(hex, 16);
    let next = index + hex.length;
    if (/\s/.test(source[next] ?? '')) next += 1;
    return {
      value: codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '\uFFFD',
      next,
    };
  }
  if (first === '\n' || first === '\r')
    return { value: '', next: index + (first === '\r' && source[index + 1] === '\n' ? 2 : 1) };
  return { value: first, next: index + 1 };
}

function* quotedStrings(source) {
  for (const match of source.matchAll(/(['"`])\//g)) {
    const quote = match[1];
    let value = '/';
    let cursor = match.index + 2;
    let interpolated = false;
    while (cursor < source.length && source[cursor] !== quote) {
      if (quote === '`' && source[cursor] === '$' && source[cursor + 1] === '{') {
        interpolated = true;
        break;
      }
      if (source[cursor] === '\\') {
        const escaped = decodeEscape(source, cursor + 1);
        value += escaped.value;
        cursor = escaped.next;
      } else {
        value += source[cursor];
        cursor += 1;
      }
    }
    if (!interpolated && cursor < source.length) yield value;
  }
}

function assetType(reference) {
  const pathname = reference.split(/[?#]/, 1)[0];
  const extension = pathname.match(/\.([^.\/]+)$/)?.[1]?.toLowerCase();
  return extension ? assetTypes.get(extension) : undefined;
}

function emittedPathFromReference(reference, basePath) {
  const pathname = reference.slice(basePath.length).split(/[?#]/, 1)[0];
  return `/${decodeURIComponent(pathname)}`;
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(file) : [file];
    }),
  );
  return nested.flat();
}

function fail(message) {
  throw new Error(`Production subpath validation failed: ${message}`);
}

export async function validateProductionBuild(
  outputDirectory,
  basePath = '/shining-stars/',
  { requiredAssetTypes = [] } = {},
) {
  if (!basePath.startsWith('/') || !basePath.endsWith('/'))
    fail(`base path must start and end with '/': ${basePath}`);

  const indexPath = path.join(outputDirectory, 'index.html');
  const index = await readFile(indexPath, 'utf8');
  const emittedFiles = await filesUnder(outputDirectory);
  const emittedPaths = new Set(
    emittedFiles.map((file) =>
      `/${path.relative(outputDirectory, file).split(path.sep).join('/')}`,
    ),
  );
  const entryFiles = [...index.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((url) => /\.(?:m?js|css)(?:[?#]|$)/i.test(url));

  if (entryFiles.length === 0) fail('index.html has no emitted JS or CSS entry references');

  for (const reference of entryFiles) {
    if (!reference.startsWith(basePath))
      fail(`index.html reference is outside ${basePath}: ${reference}`);
    const emittedPath = emittedPathFromReference(reference, basePath);
    if (!emittedPaths.has(emittedPath))
      fail(`index.html references missing emitted file: ${reference}`);
  }

  const bundleFiles = emittedFiles.filter((file) => /\.(?:m?js|css)$/i.test(file));
  const assetReferences = { model: 0, texture: 0, audio: 0 };
  for (const bundle of bundleFiles) {
    const source = await readFile(bundle, 'utf8');
    for (const reference of quotedStrings(source)) {
      const type = assetType(reference);
      if (!type || !reference.startsWith('/')) continue;
      if (!reference.startsWith(basePath))
        fail(`${path.relative(outputDirectory, bundle)} has root/out-of-prefix asset reference: ${reference}`);
      const emittedPath = emittedPathFromReference(reference, basePath);
      if (!emittedPaths.has(emittedPath))
        fail(`${path.relative(outputDirectory, bundle)} references missing asset: ${reference}`);
      assetReferences[type] += 1;
    }
  }

  for (const type of requiredAssetTypes) {
    if (!assetReferences[type]) fail(`no ${type} asset references were found in emitted bundles`);
  }

  return {
    entryReferences: entryFiles.length,
    bundlesScanned: bundleFiles.length,
    assetReferences,
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const outputDirectory = process.argv[2] ?? 'dist';
  try {
    const result = await validateProductionBuild(outputDirectory, '/shining-stars/', {
      requiredAssetTypes: ['model', 'texture', 'audio'],
    });
    console.log(
      `Validated ${result.entryReferences} index entry reference(s) and ${result.bundlesScanned} emitted JS/CSS bundle(s) under /shining-stars/; media references: ${JSON.stringify(result.assetReferences)}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
