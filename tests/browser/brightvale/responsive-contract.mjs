import { randomUUID } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEVICE_PIXEL_RATIO_CAP = 1.5;
const CSS_TOLERANCE = 1;

function withinOnePixel(actual, expected) {
  return (
    Number.isFinite(actual) && Math.abs(actual - expected) <= CSS_TOLERANCE
  );
}

/** Require the canvas to match the newly measured host layout, not old pixels. */
export function canvasMatchesMeasuredLayout(measurement, layout) {
  if (
    measurement === null ||
    layout === null ||
    measurement.content === null ||
    measurement.canvas === null
  )
    return false;

  const { content, canvas } = measurement;
  const ratio = Math.min(
    Math.max(measurement.devicePixelRatio || 1, 1),
    DEVICE_PIXEL_RATIO_CAP,
  );
  return (
    withinOnePixel(layout.width, content.width) &&
    withinOnePixel(layout.height, content.height) &&
    withinOnePixel(canvas.x, content.x) &&
    withinOnePixel(canvas.y, content.y) &&
    withinOnePixel(canvas.width, layout.width) &&
    withinOnePixel(canvas.height, layout.height) &&
    Math.abs(canvas.bufferWidth - Math.floor(layout.width * ratio)) <= 1 &&
    Math.abs(canvas.bufferHeight - Math.floor(layout.height * ratio)) <= 1
  );
}

/** Atomically replace the latest report; same-directory rename avoids partial JSON. */
export async function writeResponsiveReport(reportPath, report) {
  const temporaryPath = path.join(
    path.dirname(reportPath),
    `.${path.basename(reportPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`);
    await rename(temporaryPath, reportPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
