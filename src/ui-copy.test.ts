import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('chart notice copy', () => {
  it('describes aubio onsets without prescribing configurable note density', () => {
    const uiSource = readFileSync(resolve(process.cwd(), 'src/ui.ts'), 'utf8');

    expect(uiSource).toMatch(/Notes follow aubio-detected onsets\./i);
    expect(uiSource).toMatch(/Aubio onset chart/i);
    expect(uiSource).not.toMatch(/one note per\b/i);
    expect(uiSource).not.toMatch(/detected beats/i);
  });
});
