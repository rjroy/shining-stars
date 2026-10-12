import type * as THREE from 'three';
import type { BrightvaleAssets } from './assets';

export type BrightvaleFrameStatus =
  | 'loading'
  | 'rendered'
  | 'suspended'
  | 'unavailable';

export interface BrightvaleShellComposition {
  readonly root: THREE.Object3D;
  /** Releases generated composition resources, not borrowed bundle resources. */
  dispose(): void;
}

export interface BrightvaleSceneShellDependencies {
  readonly scene: THREE.Scene;
  readonly loadAssets: (signal: AbortSignal) => Promise<BrightvaleAssets>;
  readonly createComposition: (assets: BrightvaleAssets) => BrightvaleShellComposition;
  /** A normal return represents a successful complete scene render. */
  readonly render: () => void;
  readonly onFailure: (error: unknown) => void;
}

export interface BrightvaleSceneShell {
  updateFrame(frame: { readonly viewportUsable: boolean }): BrightvaleFrameStatus;
  destroy(): void;
}

/** Owns one scene generation's loading, attachment, frame status, and teardown. */
export function createBrightvaleSceneShell(
  dependencies: BrightvaleSceneShellDependencies,
): BrightvaleSceneShell {
  const loadController = new AbortController();
  const disposedBundles = new WeakSet<BrightvaleAssets>();
  let assets: BrightvaleAssets | null = null;
  let composition: BrightvaleShellComposition | null = null;
  let terminal: 'active' | 'unavailable' | 'destroyed' = 'active';
  let failureNotified = false;
  let hasRendered = false;
  let lastFrameStatus: BrightvaleFrameStatus | null = null;

  const logFrameStatus = (
    status: BrightvaleFrameStatus,
    trigger: string,
  ): void => {
    if (lastFrameStatus === status) return;
    console.info('[Brightvale] scene shell frame state changed', {
      from: lastFrameStatus ?? 'created',
      to: status,
      trigger,
    });
    lastFrameStatus = status;
  };

  const disposeBundle = (bundle: BrightvaleAssets): void => {
    if (disposedBundles.has(bundle)) return;
    disposedBundles.add(bundle);
    try {
      bundle.dispose();
    } catch (error) {
      console.error('[Brightvale] scene shell bundle disposal failed', { error });
    }
  };

  const cleanup = (): void => {
    const previousComposition = composition;
    composition = null;
    if (previousComposition !== null) {
      if (previousComposition.root.parent === dependencies.scene) {
        try {
          dependencies.scene.remove(previousComposition.root);
        } catch (error) {
          console.error('[Brightvale] scene shell composition detach failed', { error });
        }
      }
      try {
        previousComposition.dispose();
      } catch (error) {
        console.error('[Brightvale] scene shell composition disposal failed', { error });
      }
    }

    const previousAssets = assets;
    assets = null;
    if (previousAssets !== null) disposeBundle(previousAssets);
  };

  const fail = (error: unknown): void => {
    if (terminal !== 'active') return;
    terminal = 'unavailable';
    loadController.abort();
    cleanup();
    console.error('[Brightvale] scene shell became unavailable', { error });
    logFrameStatus('unavailable', 'failure');
    if (failureNotified) return;
    failureNotified = true;
    try {
      dependencies.onFailure(error);
    } catch (callbackError) {
      console.error('[Brightvale] scene shell failure callback threw', {
        error: callbackError,
      });
    }
  };

  console.info('[Brightvale] scene shell asset load attempt');
  let loadPromise: Promise<BrightvaleAssets>;
  try {
    loadPromise = dependencies.loadAssets(loadController.signal);
  } catch (error) {
    loadPromise = Promise.reject(error);
  }

  void loadPromise.then(
    (loadedAssets) => {
      if (terminal !== 'active') {
        disposeBundle(loadedAssets);
        console.info('[Brightvale] late scene shell bundle disposed', {
          terminal,
        });
        return;
      }
      assets = loadedAssets;
      console.info('[Brightvale] scene shell asset load succeeded');
    },
    (error: unknown) => {
      if (terminal === 'active') fail(error);
    },
  );

  return {
    updateFrame(frame): BrightvaleFrameStatus {
      if (terminal !== 'active') {
        logFrameStatus('unavailable', terminal);
        return 'unavailable';
      }
      if (!frame.viewportUsable) {
        logFrameStatus('suspended', assets === null ? 'viewport-unusable-loading' : 'viewport-unusable');
        return 'suspended';
      }
      if (assets === null) {
        logFrameStatus('loading', 'assets-pending');
        return 'loading';
      }

      try {
        if (composition === null) {
          console.info('[Brightvale] scene shell composition attempt');
          const created = dependencies.createComposition(assets);
          composition = created;
          dependencies.scene.add(created.root);
          console.info('[Brightvale] scene shell composition attached');
        }
        dependencies.render();
        if (!hasRendered) {
          hasRendered = true;
          console.info('[Brightvale] scene shell first render succeeded');
        }
        logFrameStatus('rendered', hasRendered ? 'render-succeeded' : 'render-attempt');
        return 'rendered';
      } catch (error) {
        fail(error);
        return 'unavailable';
      }
    },

    destroy(): void {
      if (terminal === 'destroyed') return;
      terminal = 'destroyed';
      loadController.abort();
      cleanup();
      console.info('[Brightvale] scene shell destroyed');
      logFrameStatus('unavailable', 'destroyed');
    },
  };
}
