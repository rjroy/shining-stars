import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BRIGHTVALE_ASSET_NAMES, type BrightvaleAssets } from './assets';
import {
  createBrightvaleSceneShell,
  type BrightvaleSceneShellDependencies,
  type BrightvaleShellComposition,
} from './scene-shell';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function makeAssets(dispose: () => void = vi.fn()): BrightvaleAssets {
  const roots = Object.fromEntries(
    BRIGHTVALE_ASSET_NAMES.map((name) => [name, new THREE.Group()]),
  ) as Record<(typeof BRIGHTVALE_ASSET_NAMES)[number], THREE.Group>;
  return { roots, dispose };
}

function makeComposition(
  root = new THREE.Group(),
  dispose: () => void = vi.fn(),
): BrightvaleShellComposition {
  return { root, dispose };
}

function makeHarness(overrides: Partial<BrightvaleSceneShellDependencies> = {}) {
  const scene = new THREE.Scene();
  const load = deferred<BrightvaleAssets>();
  const composition = makeComposition();
  let receivedSignal: AbortSignal | undefined;
  const dependencies: BrightvaleSceneShellDependencies = {
    scene,
    loadAssets: vi.fn((signal: AbortSignal) => {
      receivedSignal = signal;
      return load.promise;
    }),
    createComposition: vi.fn(() => composition),
    render: vi.fn(),
    onFailure: vi.fn(),
    ...overrides,
  };
  const shell = createBrightvaleSceneShell(dependencies);
  return {
    scene,
    load,
    composition,
    dependencies,
    shell,
    get receivedSignal() {
      return receivedSignal;
    },
  };
}

describe('isolated Brightvale scene shell lifecycle', () => {
  it('returns synchronously, stays loading until assets arrive, then attaches and renders', async () => {
    const harness = makeHarness();

    expect(harness.shell).toBeDefined();
    expect(harness.shell.updateFrame({ viewportUsable: true })).toBe('loading');
    expect(harness.scene.children).not.toContain(harness.composition.root);
    expect(harness.dependencies.render).not.toHaveBeenCalled();

    const assets = makeAssets();
    harness.load.resolve(assets);
    await flushMicrotasks();

    expect(harness.shell.updateFrame({ viewportUsable: true })).toBe('rendered');
    expect(harness.scene.children).toContain(harness.composition.root);
    expect(harness.dependencies.createComposition).toHaveBeenCalledWith(assets);
    expect(harness.dependencies.render).toHaveBeenCalledTimes(1);
  });

  it('suspends without aborting or disposing the bundle and renders after viewport restoration', async () => {
    const harness = makeHarness();
    const assets = makeAssets();

    expect(harness.shell.updateFrame({ viewportUsable: false })).toBe('suspended');
    expect(harness.receivedSignal?.aborted).toBe(false);
    assets.roots.platform.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    harness.load.resolve(assets);
    await flushMicrotasks();

    expect(harness.shell.updateFrame({ viewportUsable: false })).toBe('suspended');
    expect(harness.scene.children).not.toContain(harness.composition.root);
    expect(harness.dependencies.render).not.toHaveBeenCalled();
    expect(assets.dispose).not.toHaveBeenCalled();

    expect(harness.shell.updateFrame({ viewportUsable: true })).toBe('rendered');
    expect(harness.scene.children).toContain(harness.composition.root);
    expect(harness.dependencies.render).toHaveBeenCalledTimes(1);
  });

  it('suspends and resumes a rendered shell without detaching or recomposing', async () => {
    const harness = makeHarness();
    const assets = makeAssets();
    harness.load.resolve(assets);
    await flushMicrotasks();

    expect(harness.shell.updateFrame({ viewportUsable: true })).toBe('rendered');
    const attachedRoot = harness.scene.children[0];
    expect(attachedRoot).toBe(harness.composition.root);

    expect(harness.shell.updateFrame({ viewportUsable: false })).toBe('suspended');
    expect(harness.scene.children).toEqual([attachedRoot]);
    expect(harness.dependencies.createComposition).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.render).toHaveBeenCalledTimes(1);
    expect(assets.dispose).not.toHaveBeenCalled();

    expect(harness.shell.updateFrame({ viewportUsable: true })).toBe('rendered');
    expect(harness.scene.children).toEqual([attachedRoot]);
    expect(harness.dependencies.createComposition).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.render).toHaveBeenCalledTimes(2);
    expect(assets.dispose).not.toHaveBeenCalled();
  });

  it('reports a rejected loader once without attaching or rendering', async () => {
    const harness = makeHarness();
    const failure = new Error('asset load failed');

    expect(harness.shell.updateFrame({ viewportUsable: true })).toBe('loading');
    harness.load.reject(failure);
    await flushMicrotasks();

    expect(harness.shell.updateFrame({ viewportUsable: true })).toBe('unavailable');
    expect(harness.scene.children).toHaveLength(0);
    expect(harness.dependencies.createComposition).not.toHaveBeenCalled();
    expect(harness.dependencies.render).not.toHaveBeenCalled();
    expect(harness.dependencies.onFailure).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.onFailure).toHaveBeenCalledWith(failure);
    harness.shell.destroy();
    expect(harness.dependencies.onFailure).toHaveBeenCalledTimes(1);
  });

  it('disposes a loaded bundle and reports composition construction failure once', async () => {
    const events: string[] = [];
    const bundleDispose = vi.fn(() => {
      events.push('bundle-dispose');
    });
    const assets = makeAssets(bundleDispose);
    const failure = new Error('composition failed');
    const onFailure = vi.fn(() => events.push('failure-notified'));
    const createComposition = vi.fn((): BrightvaleShellComposition => {
      throw failure;
    });
    const harness = makeHarness({ createComposition, onFailure });

    harness.load.resolve(assets);
    await flushMicrotasks();

    expect(harness.shell.updateFrame({ viewportUsable: true })).toBe('unavailable');
    expect(harness.scene.children).toHaveLength(0);
    expect(assets.dispose).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(events).toEqual(['bundle-dispose', 'failure-notified']);
    harness.shell.destroy();
    expect(assets.dispose).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('cleans up a failed render before notifying once and stays unavailable', async () => {
    const events: string[] = [];
    const assets = makeAssets(
      vi.fn(() => {
        events.push('bundle-dispose');
      }),
    );
    const composition = makeComposition(
      new THREE.Group(),
      vi.fn(() => {
        events.push('composition-dispose');
      }),
    );
    const scene = new THREE.Scene();
    const load = deferred<BrightvaleAssets>();
    const remove = scene.remove.bind(scene);
    vi.spyOn(scene, 'remove').mockImplementation((...objects) => {
      events.push('scene-detach');
      remove(...objects);
      return scene;
    });
    const failure = new Error('render failed');
    const render = vi.fn(() => {
      events.push('render');
      throw failure;
    });
    const onFailure = vi.fn(() => events.push('failure-notified'));
    const shell = createBrightvaleSceneShell({
      scene,
      loadAssets: vi.fn(() => load.promise),
      createComposition: vi.fn(() => composition),
      render,
      onFailure,
    });

    load.resolve(assets);
    await flushMicrotasks();

    expect(shell.updateFrame({ viewportUsable: true })).toBe('unavailable');
    expect(scene.children).not.toContain(composition.root);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(events).toEqual([
      'render',
      'scene-detach',
      'composition-dispose',
      'bundle-dispose',
      'failure-notified',
    ]);
    expect(shell.updateFrame({ viewportUsable: true })).toBe('unavailable');
    shell.destroy();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('destroys before readiness, aborts loading, and disposes a late bundle without attaching it', async () => {
    const harness = makeHarness();
    const lateAssets = makeAssets();

    harness.shell.destroy();
    harness.shell.destroy();
    expect(harness.receivedSignal?.aborted).toBe(true);
    expect(harness.shell.updateFrame({ viewportUsable: true })).toBe('unavailable');

    harness.load.resolve(lateAssets);
    await flushMicrotasks();

    expect(harness.scene.children).not.toContain(harness.composition.root);
    expect(harness.dependencies.createComposition).not.toHaveBeenCalled();
    expect(harness.dependencies.render).not.toHaveBeenCalled();
    expect(lateAssets.dispose).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.onFailure).not.toHaveBeenCalled();
  });

  it('detaches composition before disposing it and the borrowed bundle, exactly once', async () => {
    const events: string[] = [];
    const assets = makeAssets(
      vi.fn(() => {
        events.push('bundle-dispose');
      }),
    );
    const composition = makeComposition(
      new THREE.Group(),
      vi.fn(() => {
        events.push('composition-dispose');
      }),
    );
    const scene = new THREE.Scene();
    const load = deferred<BrightvaleAssets>();
    const remove = scene.remove.bind(scene);
    vi.spyOn(scene, 'remove').mockImplementation((...objects) => {
      events.push('scene-detach');
      remove(...objects);
      return scene;
    });
    const shell = createBrightvaleSceneShell({
      scene,
      loadAssets: vi.fn(() => load.promise),
      createComposition: vi.fn(() => composition),
      render: vi.fn(),
      onFailure: vi.fn(),
    });

    load.resolve(assets);
    await flushMicrotasks();
    expect(shell.updateFrame({ viewportUsable: true })).toBe('rendered');
    shell.destroy();
    shell.destroy();

    expect(scene.children).not.toContain(composition.root);
    expect(events).toEqual(['scene-detach', 'composition-dispose', 'bundle-dispose']);
    expect(shell.updateFrame({ viewportUsable: true })).toBe('unavailable');
  });
});
