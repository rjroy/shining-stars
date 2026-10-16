import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { FavoriteStorage } from '../catalog/favorites';

// UI flow contract, not a substitute for native-dialog/focus/browser coverage.
// The production dialog consumes this controller; core import policy is tested
// separately in src/app/save-data-import.test.ts.
type Mode = 'merge' | 'replace';
type Preview = {
  mode: Mode;
  hasChanges: boolean;
  changes: {
    favorites: { added: number; removed: number };
    ratings: { added: number; improved: number; removed: number; downgraded: number };
  };
};
type Status = 'applied' | 'session-only' | 'conflict' | 'stale-preview' | 'invalid-preview' | 'failed';
type State = {
  phase: 'closed' | 'choose' | 'reading' | 'preview' | 'confirm-replace' | 'confirm-session' | 'result' | 'error';
  mode: Mode;
  canImport: boolean;
  notice: string | null;
};
type Options = {
  previewImport(text: string, mode: Mode): Preview;
  applyImport(preview: Preview, target: 'local' | 'session'): { status: Status; notice: string | null };
  onImported(): void;
};
type Controller = {
  snapshot(): State;
  open(): void;
  close(): void;
  readFile(file: { name: string; text(): Promise<string> }): Promise<void>;
  setMode(mode: Mode): void;
  requestImport(): void;
  confirmReplace(): void;
  requestSessionImport(): void;
  confirmSessionImport(): void;
  destroy(): void;
};
const moduleUrl = new URL('./save-data-dialog.ts', import.meta.url);
const saveModuleUrl = new URL('../app/save-data.ts', import.meta.url);

async function setup(hasChanges = true) {
  expect(existsSync(moduleUrl), 'Missing production save-data-dialog.ts: contract RED, not a behavior failure').toBe(true);
  const module = await import(/* @vite-ignore */ moduleUrl.href);
  const factory = Reflect.get(module, 'createSaveDataController');
  expect(factory, 'Production dialog must use createSaveDataController(options)').toBeTypeOf('function');
  const previewImport = vi.fn((_text: string, mode: Mode): Preview => ({
    mode, hasChanges,
    changes: {
      favorites: { added: hasChanges ? 1 : 0, removed: 0 },
      ratings: { added: 0, improved: 0, removed: 0, downgraded: 0 },
    },
  }));
  const applyImport = vi.fn<Options['applyImport']>(() => ({ status: 'applied', notice: null }));
  const onImported = vi.fn();
  const controller = (factory as (options: Options) => Controller)({ previewImport, applyImport, onImported });
  controller.open();
  return { controller, previewImport, applyImport, onImported };
}

const file = { name: 'backup.json', text: async () => 'backup contents' };

describe('Save data dialog production flow contract', () => {
  it('defaults to merge and validates a chosen file without applying it', async () => {
    const { controller, previewImport, applyImport } = await setup();
    expect(controller.snapshot()).toMatchObject({ phase: 'choose', mode: 'merge', canImport: false });
    await controller.readFile(file);
    expect(previewImport).toHaveBeenCalledWith('backup contents', 'merge');
    expect(controller.snapshot()).toMatchObject({ phase: 'preview', canImport: true });
    expect(applyImport).not.toHaveBeenCalled();
  });

  it('keeps invalid files non-actionable and never applies them', async () => {
    const { controller, previewImport, applyImport } = await setup();
    previewImport.mockImplementation(() => { throw new Error('Unsupported backup version 9'); });
    await controller.readFile(file);
    expect(controller.snapshot()).toMatchObject({ phase: 'error', canImport: false });
    expect(controller.snapshot().notice).toMatch(/version 9/i);
    controller.requestImport();
    expect(applyImport).not.toHaveBeenCalled();
  });

  it('allows deliberate application of an unchanged preview without auto-applying it', async () => {
    const { controller, applyImport, onImported } = await setup(false);
    await controller.readFile(file);
    expect(controller.snapshot()).toMatchObject({ phase: 'preview', canImport: true });
    expect(applyImport).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    controller.requestImport();
    expect(applyImport).toHaveBeenCalledWith(expect.objectContaining({ hasChanges: false }), 'local');
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('persists a matching session backup locally after storage recovers', async () => {
    expect(existsSync(saveModuleUrl), 'Missing production save-data.ts').toBe(true);
    const saveModule = await import(/* @vite-ignore */ saveModuleUrl.href);
    const createSaveStore = Reflect.get(saveModule, 'createSaveStore');
    expect(createSaveStore).toBeTypeOf('function');

    const key = 'shining-stars.save';
    const values = new Map<string, string>([[key, JSON.stringify({
      format: 'shining-stars-save', schemaVersion: 1, favorites: [], ratings: {},
    })]]);
    let denyWrites = false;
    const storage: FavoriteStorage = {
      getItem(storageKey: string) { return values.get(storageKey) ?? null; },
      setItem(storageKey: string, value: string) {
        if (denyWrites) throw new Error('quota');
        values.set(storageKey, value);
      },
    };
    const store = (createSaveStore as (storage: FavoriteStorage) => {
      favorites: { toggle(id: string): unknown; snapshot(): { persistence: string } };
      songRatings: { recordCompletedResult(id: string, result: { score: number; normalMaximum: number; outcome: 'victory'; difficulty: 'normal' }): unknown };
      exportJson(): string;
      previewImport(text: string, mode: Mode): Preview;
      applyImport(preview: Preview, target: 'local' | 'session'): { status: Status; notice: string | null };
    })(storage);

    denyWrites = true;
    store.favorites.toggle('session-favorite');
    store.songRatings.recordCompletedResult('session-played', {
      score: 0, normalMaximum: 10_000, outcome: 'victory', difficulty: 'normal',
    });
    expect(store.favorites.snapshot().persistence).toBe('session');
    const backup = store.exportJson();
    const controllerModule = await import(/* @vite-ignore */ moduleUrl.href);
    const controllerFactory = Reflect.get(controllerModule, 'createSaveDataController');
    expect(controllerFactory).toBeTypeOf('function');
    const applyImport = vi.fn((preview: Preview, target: 'local' | 'session') => store.applyImport(preview, target));
    const imported = vi.fn();
    const controller = (controllerFactory as (options: Options) => Controller)({
      previewImport: (text, mode) => store.previewImport(text, mode),
      applyImport,
      onImported: imported,
    });
    controller.open();
    await controller.readFile({ name: 'session-backup.json', text: async () => backup });
    expect(controller.snapshot()).toMatchObject({ phase: 'preview', canImport: true });
    expect(controller.snapshot().notice).toMatch(/no changes/i);
    denyWrites = false;
    controller.requestImport();

    expect(applyImport).toHaveBeenCalledWith(expect.objectContaining({ hasChanges: false }), 'local');
    expect(controller.snapshot().phase).toBe('result');
    expect(imported).toHaveBeenCalledTimes(1);
    expect(JSON.parse(values.get(key) ?? 'null')).toEqual(JSON.parse(backup));
    expect(store.favorites.snapshot().persistence).toBe('local');
    controller.destroy();
  });

  it('re-previews replace mode and requires a separate destructive confirmation', async () => {
    const { controller, previewImport, applyImport, onImported } = await setup();
    await controller.readFile(file);
    controller.setMode('replace');
    expect(previewImport).toHaveBeenLastCalledWith('backup contents', 'replace');
    controller.requestImport();
    expect(controller.snapshot().phase).toBe('confirm-replace');
    expect(applyImport).not.toHaveBeenCalled();
    controller.confirmReplace();
    expect(applyImport).toHaveBeenCalledWith(expect.objectContaining({ mode: 'replace' }), 'local');
    expect(onImported).toHaveBeenCalledTimes(1);
    controller.confirmReplace();
    expect(applyImport).toHaveBeenCalledTimes(1);
  });

  it.each(['failed', 'conflict'] as const)('does not silently import into the session after %s', async (status) => {
    const { controller, applyImport, onImported } = await setup();
    applyImport.mockReturnValueOnce({ status, notice: 'Local save was not changed.' });
    await controller.readFile(file);
    controller.requestImport();
    expect(applyImport).toHaveBeenCalledTimes(1);
    expect(onImported).not.toHaveBeenCalled();
    expect(controller.snapshot().notice).toMatch(/not changed/i);
    controller.requestSessionImport();
    expect(controller.snapshot().phase).toBe('confirm-session');
    expect(applyImport).toHaveBeenCalledTimes(1);
    applyImport.mockReturnValueOnce({ status: 'session-only', notice: 'Imported for this session only.' });
    controller.confirmSessionImport();
    expect(applyImport).toHaveBeenLastCalledWith(expect.anything(), 'session');
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().notice).toMatch(/session only/i);
  });

  it('rejects stale previews without refreshing the Observatory as if import succeeded', async () => {
    const { controller, applyImport, onImported } = await setup();
    applyImport.mockReturnValue({ status: 'stale-preview', notice: 'Data changed. Choose the backup again.' });
    await controller.readFile(file);
    controller.requestImport();
    expect(controller.snapshot().canImport).toBe(false);
    expect(onImported).not.toHaveBeenCalled();
    controller.requestImport();
    expect(applyImport).toHaveBeenCalledTimes(1);
  });

  it.each(['close', 'destroy'] as const)('ignores a pending file read after %s and never applies it', async (action) => {
    const { controller, previewImport, applyImport, onImported } = await setup();
    let finish!: (text: string) => void;
    const reading = controller.readFile({ name: 'slow.json', text: () => new Promise<string>((resolve) => { finish = resolve; }) });
    controller[action]();
    finish('late contents');
    await reading;
    expect(controller.snapshot().phase).toBe('closed');
    expect(previewImport).not.toHaveBeenCalled();
    expect(applyImport).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });
});
