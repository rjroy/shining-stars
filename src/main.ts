import './styles.css';
import { createAudioTransport } from './audio';
import { createBrowserAudioContextAdapter } from './browser-audio';
import { createGameController, type GameController } from './controller';
import { createGame } from './game';
import { MVP_CHART } from './mvp-chart';
import { createBrightvaleScene, type BrightvaleScene } from './scene';
import { projectSceneState } from './scene-state';
import { createGameUI } from './ui';

const appRoot = document.querySelector<HTMLElement>('#app');
if (appRoot === null)
  throw new Error('Brightvale application root #app is missing.');

const trackUrl = new URL(
  '../data/music/The First Shining Star (Remastered).mp3',
  import.meta.url,
).href;
const inputOffset = 0;
const visualOffset = 0;
const ui = createGameUI(appRoot, MVP_CHART, {
  start: () =>
    runPlaybackAction(startOrRetry, 'Loading the selected recording…'),
  pause: () => {
    controller?.pause();
  },
  resume: () =>
    runPlaybackAction(() => controller?.resume(), 'Preparing to resume…'),
  restart: () =>
    runPlaybackAction(() => controller?.restart(), 'Starting the song again…'),
});

let controller: GameController | null = null;
let audioContext: AudioContext | null = null;
let scene: BrightvaleScene | null = null;
let animationFrame = 0;
let disposed = false;
let playbackActionPending = false;
let playbackActionCancelled = false;
const reducedMotionQuery = window.matchMedia(
  '(prefers-reduced-motion: reduce)',
);
let reducedMotion = reducedMotionQuery.matches;

function renderSnapshot(
  snapshot: ReturnType<GameController['snapshot']>,
): void {
  ui.render(snapshot, audioContext?.currentTime ?? 0);
  scene?.update(
    projectSceneState(snapshot, MVP_CHART.twilightAt, reducedMotion),
    snapshot.game.transportTime,
  );
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
  if (controller === null || disposed) return;
  ui.setBusy(message);
  renderCurrent();
  try {
    await action();
  } catch {
    // The transport owns the recoverable error state and its user-facing message.
  } finally {
    ui.setBusy(null);
    renderCurrent();
  }
}

function runPlaybackAction(
  action: () => Promise<unknown> | undefined,
  message: string,
): Promise<void> {
  return runAction(async () => {
    playbackActionCancelled = false;
    playbackActionPending = true;
    try {
      await action();
    } finally {
      if (
        playbackActionCancelled &&
        !disposed &&
        controller?.snapshot().audio.status === 'ready'
      ) {
        controller.pause();
      }
      playbackActionPending = false;
      playbackActionCancelled = false;
    }
  }, message);
}

function startOrRetry(): Promise<unknown> | undefined {
  if (controller === null) return undefined;
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
    const status = controller.snapshot().audio.status;
    if (status === 'paused') {
      void runAction(() => controller?.resume(), 'Preparing to resume…');
    } else if (status === 'results') {
      void runAction(() => controller?.restart(), 'Starting the song again…');
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
    const status = controller.snapshot().audio.status;
    if (status === 'playing' || status === 'starting') {
      event.preventDefault();
      controller.pause();
    }
    return;
  }
  if (/^Key[DFJK]$/.test(event.code)) {
    event.preventDefault();
    controller.keyDown(event.code, event.repeat);
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (/^Key[DFJK]$/.test(event.code)) controller?.keyUp(event.code);
}

function pauseWhenHidden(): void {
  if (controller === null) return;
  const status = controller.snapshot().audio.status;
  if (status === 'loading' && playbackActionPending) {
    playbackActionCancelled = true;
  }
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
  const sceneHost = appRoot.querySelector<HTMLElement>('.play-surface');
  if (sceneHost !== null) {
    scene = createBrightvaleScene(sceneHost, () => {
      ui.setSceneFallback(
        'The city view is unavailable here, but the song and rhythm lanes still work.',
      );
      scene = null;
    });
  }
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
    createGame: (offset) => createGame(MVP_CHART, offset),
    inputOffset,
    visualOffset,
    render: renderSnapshot,
  });

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
