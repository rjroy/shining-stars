import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  canvasMatchesMeasuredLayout,
  writeResponsiveReport,
} from './responsive-contract.mjs';

function measurement({
  content,
  layout,
  devicePixelRatio = 1,
  canvas = {
    x: content.x,
    y: content.y,
    width: layout.width,
    height: layout.height,
    bufferWidth: Math.floor(layout.width * Math.min(devicePixelRatio, 1.5)),
    bufferHeight: Math.floor(layout.height * Math.min(devicePixelRatio, 1.5)),
  },
}) {
  return { content, canvas, devicePixelRatio };
}

test('responsive readiness rejects old canvas pixels and accepts the new layout', () => {
  const nextLayout = { width: 598, height: 680 };
  const content = { x: 11, y: 11, width: 598, height: 680 };
  const oldCanvas = {
    x: 45.8,
    y: 19.2,
    width: 1028,
    height: 661,
    bufferWidth: 1028,
    bufferHeight: 661,
  };
  assert.equal(
    canvasMatchesMeasuredLayout(
      measurement({ content, layout: nextLayout, canvas: oldCanvas }),
      nextLayout,
    ),
    false,
  );
  assert.equal(
    canvasMatchesMeasuredLayout(
      measurement({ content, layout: nextLayout }),
      nextLayout,
    ),
    true,
  );
});

test('responsive readiness checks backing dimensions at the capped device pixel ratio', () => {
  const layout = { width: 598, height: 680 };
  const content = { x: 11, y: 11, width: 598, height: 680 };
  const canvas = {
    x: 11,
    y: 11,
    width: 598,
    height: 680,
    bufferWidth: 897,
    bufferHeight: 1020,
  };
  assert.equal(
    canvasMatchesMeasuredLayout(
      measurement({ content, layout, devicePixelRatio: 2, canvas }),
      layout,
    ),
    true,
  );
  assert.equal(
    canvasMatchesMeasuredLayout(
      measurement({
        content,
        layout,
        devicePixelRatio: 2,
        canvas: { ...canvas, bufferWidth: 598 },
      }),
      layout,
    ),
    false,
  );
});

test('atomic report transitions replace timeout failure and later pass', async (context) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'brightvale-responsive-report-'),
  );
  context.after(() => rm(directory, { recursive: true, force: true }));
  const reportPath = path.join(directory, 'responsive-report.json');

  await writeResponsiveReport(reportPath, { status: 'passed' });
  await writeResponsiveReport(reportPath, { status: 'running', viewports: [] });
  await writeResponsiveReport(reportPath, {
    status: 'failed',
    error: 'Timed out waiting for the measured layout and matching canvas',
  });
  assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).status, 'failed');

  await writeResponsiveReport(reportPath, { status: 'running', viewports: [] });
  await writeResponsiveReport(reportPath, { status: 'passed' });
  assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).status, 'passed');
  assert.deepEqual(await readdir(directory), ['responsive-report.json']);
});
