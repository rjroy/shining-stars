import './styles.css';
import { createAudioTransport } from './audio';
import { createBrowserAudioContextAdapter } from './browser-audio';
import { createGameController, type GameController } from './controller';
import { createGame } from './game';
import { projectGameplayFrame } from './gameplay-frame';
import { MVP_CHART } from './mvp-chart';
import { createBrightvaleScene, type BrightvaleScene } from './scene';
import { projectSceneState } from './scene-state';
import { createGameUI } from './ui';

const appRoot = document.querySelector<HTMLElement>('#app');
if (appRoot === null)
  throw new Error('Brightvale application root #app is missing.');
const applicationRoot = appRoot;

const trackUrl = new URL(
  '../data/music/The First Shining Star (Remastered).mp3',
  import.meta.url,
).href;
const inputOffset = 0;
const visualOffset = 0;
let controller: GameController | null = null;
let audioContext: AudioContext | null = null;
let scene: BrightvaleScene | null = null;
let animationFrame = 0;
let disposed = false;
let rendererAvailable = false;
let rendererGeneration = 0;
let playbackActionEpoch = 0;
let playbackActionSequence = 0;
let playbackActionPending = false;
let unstartedPresentationResetSequence: number | null = null;
let renderingSceneFrame = false;
let rendererStatusNeedsRender = false;
let busyActionToken = 0;
const reducedMotionQuery = window.matchMedia(
  '(prefers-reduced-motion: reduce)',
);
let reducedMotion = reducedMotionQuery.matches;

const ui = createGameUI(applicationRoot, MVP_CHART, {
  start: () =>
    runPlaybackAction(startOrRetry, 'Loading the selected recording…'),
  pause: () => {
    unstartedPresentationResetSequence = null;
    controller?.pause();
  },
  resume: () =>
    runPlaybackAction(
      () =>
        controller?.snapshot().audio.loaded
          ? controller.resume()
          : startOrRetry(),
      'Preparing to resume…',
    ),
  restart: () =>
    runPlaybackAction(() => controller?.restart(), 'Starting the song again…'),
  onRendererRetry: retryRenderer,
  selectDifficulty: (difficulty) => {
    if (controller?.snapshot().pendingPlaybackRequests) return;
    controller?.selectDifficulty(difficulty);
  },
});

const RENDERER_UNAVAILABLE_MESSAGE =
  'The three-dimensional playfield could not start. Playback is locked.';

function showRendererStatus(message: string): void {
  ui.setRendererStatus(false, message);
  if (renderingSceneFrame) {
    rendererStatusNeedsRender = true;
  } else if (controller !== null) {
    ui.render(controller.snapshot(), audioContext?.currentTime ?? 0);
  }
}

function invalidatePlaybackForRendererFailure(): void {
  const snapshotBeforeCancellation = controller?.snapshot();
  if (
    playbackActionPending &&
    snapshotBeforeCancellation !== undefined &&
    (snapshotBeforeCancellation.audio.status === 'loading' ||
      snapshotBeforeCancellation.audio.status === 'ready') &&
    !snapshotBeforeCancellation.audio.hasActiveSource &&
    snapshotBeforeCancellation.audio.position === 0 &&
    snapshotBeforeCancellation.game.status !== 'results'
  ) {
    unstartedPresentationResetSequence = playbackActionSequence;
  }
  playbackActionEpoch += 1;
  busyActionToken += 1;
  playbackActionPending = false;
  ui.setBusy(null);
  const snapshot = controller?.pauseWithoutPublishing();
  if (snapshot !== undefined) {
    if (renderingSceneFrame) rendererStatusNeedsRender = true;
    else ui.render(snapshot, audioContext?.currentTime ?? 0);
  }
}

function reconcileUnstartedPlaybackPresentation(
  actionSequence: number,
  allowReset: boolean,
): boolean {
  const resetSequence = unstartedPresentationResetSequence;
  if (resetSequence === null) return false;
  if (
    resetSequence !== actionSequence ||
    actionSequence !== playbackActionSequence ||
    playbackActionPending
  ) {
    unstartedPresentationResetSequence = null;
    return false;
  }

  const snapshot = controller?.snapshot();
  if (snapshot === undefined) return false;
  if (snapshot.pendingPlaybackRequests) return false;
  const audioHasNotStarted =
    (snapshot.audio.status === 'loading' ||
      snapshot.audio.status === 'ready' ||
      snapshot.audio.status === 'paused') &&
    !snapshot.audio.hasActiveSource &&
    snapshot.audio.position === 0 &&
    snapshot.game.status !== 'results';
  if (!audioHasNotStarted) {
    unstartedPresentationResetSequence = null;
    return false;
  }
  if (!allowReset) return false;

  unstartedPresentationResetSequence = null;
  ui.resetPlaybackAttempt();
  return true;
}

function handleRendererUnavailable(generation: number): void {
  if (disposed || generation !== rendererGeneration) return;
  // A scene may report the same failure from both creation and its first frame.
  rendererGeneration += 1;
  rendererAvailable = false;
  scene = null;
  invalidatePlaybackForRendererFailure();
  showRendererStatus(RENDERER_UNAVAILABLE_MESSAGE);
}

function createRenderer(): void {
  if (disposed) return;
  const generation = ++rendererGeneration;
  rendererAvailable = false;
  ui.setRendererStatus(false, RENDERER_UNAVAILABLE_MESSAGE);
  const host = applicationRoot.querySelector<HTMLElement>('.play-surface');
  if (host === null) {
    handleRendererUnavailable(generation);
    return;
  }

  let failedDuringCreation = false;
  const nextScene = createBrightvaleScene(host, () => {
    if (generation !== rendererGeneration) return;
    failedDuringCreation = true;
    handleRendererUnavailable(generation);
  });
  if (failedDuringCreation || generation !== rendererGeneration) {
    nextScene?.destroy();
    return;
  }
  if (nextScene === null) {
    handleRendererUnavailable(generation);
    return;
  }
  scene = nextScene;
}

function retryRenderer(): void {
  if (disposed || rendererAvailable) return;
  createRenderer();
  if (scene !== null) renderCurrent();
}

function renderSnapshot(
  snapshot: ReturnType<GameController['snapshot']>,
): void {
  ui.render(snapshot, audioContext?.currentTime ?? 0);
  const currentScene = scene;
  if (currentScene === null) return;
  const generation = rendererGeneration;
  renderingSceneFrame = true;
  try {
    currentScene.updateFrame({
      city: projectSceneState(snapshot, MVP_CHART, reducedMotion),
      gameplay: projectGameplayFrame(
        snapshot,
        MVP_CHART,
        ui.getGameplayLayout(),
        reducedMotion,
        audioContext?.currentTime ?? 0,
      ),
    });
  } finally {
    renderingSceneFrame = false;
  }
  if (rendererStatusNeedsRender) {
    rendererStatusNeedsRender = false;
    ui.render(snapshot, audioContext?.currentTime ?? 0);
  }
  if (
    generation === rendererGeneration &&
    scene === currentScene &&
    !rendererAvailable
  ) {
    rendererAvailable = true;
    ui.setRendererStatus(true);
    reconcileUnstartedPlaybackPresentation(playbackActionSequence, true);
    ui.render(snapshot, audioContext?.currentTime ?? 0);
  }
}

function renderCurrent(): void {
  if (controller !== null) {
    renderSnapshot(controller.snapshot());
  }
}

function onReducedMotionChange(event: MediaQueryListEvent): void {
  reducedMotion = event.matches;
  renderCurrent();
}

async function runAction(
  action: () => Promise<unknown> | undefined,
  message = 'Preparing the song…',
): Promise<void> {
  if (controller === null || disposed || !rendererAvailable) return;
  if (playbackActionPending) return;
  if (controller.snapshot().pendingPlaybackRequests) return;
  const actionSequence = ++playbackActionSequence;
  const epoch = playbackActionEpoch;
  const token = ++busyActionToken;
  playbackActionPending = true;
  ui.setBusy(message);
  renderCurrent();
  if (epoch !== playbackActionEpoch || !rendererAvailable || disposed) {
    if (
      reconcileUnstartedPlaybackPresentation(actionSequence, rendererAvailable)
    ) {
      renderCurrent();
    }
    return;
  }
  try {
    const pendingAction = action();
    renderCurrent();
    await pendingAction;
  } catch {
    // The transport owns the recoverable error state and its user-facing message.
  } finally {
    if (epoch === playbackActionEpoch && token === busyActionToken) {
      playbackActionPending = false;
      ui.setBusy(null);
      renderCurrent();
    } else if (
      !disposed &&
      actionSequence === playbackActionSequence &&
      !playbackActionPending
    ) {
      // A canceled action may finish after renderer recovery. Reconcile only
      // its own unstarted state; never clear a newer action's busy state.
      reconcileUnstartedPlaybackPresentation(actionSequence, rendererAvailable);
      renderCurrent();
    }
  }
}

function runPlaybackAction(
  action: () => Promise<unknown> | undefined,
  message: string,
): Promise<void> {
  if (!rendererAvailable) return Promise.resolve();
  return runAction(action, message);
}

function startOrRetry(): Promise<unknown> | undefined {
  if (controller === null || !rendererAvailable) return undefined;
  return controller.snapshot().audio.status === 'error'
    ? controller.restart()
    : controller.start();
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches('input, textarea, select');
}

function onKeyDown(event: KeyboardEvent): void {
  if (controller === null || isEditableTarget(event.target)) return;
  if (event.code === 'Enter') {
    if (
      event.target instanceof HTMLElement &&
      event.target.matches('button, a[href]')
    )
      return;
    event.preventDefault();
    if (!rendererAvailable) return;
    const snapshot = controller.snapshot();
    if (snapshot.pendingPlaybackRequests) return;
    const status = snapshot.audio.status;
    if (snapshot.game.status === 'results') {
      void runPlaybackAction(
        () => controller?.restart(),
        'Starting the song again…',
      );
    } else if (status === 'paused') {
      void runPlaybackAction(
        () => (snapshot.audio.loaded ? controller?.resume() : startOrRetry()),
        'Preparing to resume…',
      );
    } else if (
      status === 'loading' ||
      status === 'ready' ||
      status === 'error'
    ) {
      void runPlaybackAction(startOrRetry, 'Loading the selected recording…');
    }
    return;
  }
  if (event.code === 'Escape') {
    unstartedPresentationResetSequence = null;
    const status = controller.snapshot().audio.status;
    if (status === 'playing' || status === 'starting') {
      event.preventDefault();
      controller.pause();
    }
    return;
  }
  if (/^Key[DFJK]$/.test(event.code)) {
    event.preventDefault();
    if (!rendererAvailable) return;
    controller.keyDown(event.code, event.repeat);
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (rendererAvailable && /^Key[DFJK]$/.test(event.code))
    controller?.keyUp(event.code);
}

function pauseWhenHidden(): void {
  if (controller === null) return;
  const status = controller.snapshot().audio.status;
  if (
    status === 'playing' ||
    status === 'starting' ||
    (status === 'loading' && playbackActionPending)
  ) {
    controller.blur();
  }
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(animationFrame);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', pauseWhenHidden);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  reducedMotionQuery.removeEventListener('change', onReducedMotionChange);
  rendererGeneration += 1;
  rendererAvailable = false;
  scene?.destroy();
  scene = null;
  ui.destroy();
  if (controller !== null) void controller.dispose();
  else if (audioContext !== null) void audioContext.close();
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') pauseWhenHidden();
}

try {
  if (typeof window.AudioContext !== 'function') {
    throw new Error(
      'This browser does not provide Web Audio playback. Try a current desktop browser.',
    );
  }
  audioContext = new window.AudioContext();
  const adaptedContext = createBrowserAudioContextAdapter(audioContext);
  const audio = createAudioTransport(
    {
      sourceUrl: trackUrl,
      sourceStart: MVP_CHART.sourceStart,
      duration: MVP_CHART.duration,
    },
    {
      context: adaptedContext,
      fetchAudio: async (sourceUrl) => {
        const response = await fetch(sourceUrl);
        if (!response.ok) {
          throw new Error(
            `The selected recording could not be fetched (${response.status}).`,
          );
        }
        return response.arrayBuffer();
      },
      log: (entry) => console.info('brightvale.audio', entry),
    },
  );
  controller = createGameController({
    audio,
    createGame: (offset, difficulty) =>
      createGame(MVP_CHART, offset, difficulty),
    inputOffset,
    visualOffset,
    render: renderSnapshot,
  });

  createRenderer();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', pauseWhenHidden);
  document.addEventListener('visibilitychange', onVisibilityChange);
  reducedMotionQuery.addEventListener('change', onReducedMotionChange);

  const frame = (): void => {
    if (disposed || controller === null) return;
    controller.update();
    animationFrame = requestAnimationFrame(frame);
  };
  animationFrame = requestAnimationFrame(frame);
  renderCurrent();
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Audio could not be initialized.';
  ui.showFatal(message);
}

if (import.meta.hot) import.meta.hot.dispose(dispose);
