import './ui/styles.css';
import { createBrowserAudioContextAdapter } from './audio/browser-audio';
import { parseSongOutputVolume } from './audio/song-volume';
import { getSongChart, SONG_CATALOG } from './catalog/catalog';
import type { ChartConfig } from './game/chart';
import type { Difficulty } from './game/game-balance';
import { projectGameplayFrame } from './rendering/gameplay-frame';
import { createBrightvaleScene, type BrightvaleScene } from './rendering/scene';
import { projectSceneState } from './rendering/scene-state';
import { createObservatoryUI, type ObservatoryUI } from './ui/observatory-ui';
import { createGameUI, type GameUI } from './ui/ui';
import { ensureExperienceShell } from './ui/experience-shell';
import {
  createPerformanceCoordinator,
  type PerformanceCoordinator,
} from './app/performance';

const appRoot = document.querySelector<HTMLElement>('#app');
if (appRoot === null)
  throw new Error('Brightvale application root #app is missing.');
const applicationRoot = appRoot;
const shell = ensureExperienceShell(applicationRoot);
const reducedMotionQuery = window.matchMedia(
  '(prefers-reduced-motion: reduce)',
);
let reducedMotion = reducedMotionQuery.matches;
let scene: BrightvaleScene | null = null;
let observatory: ObservatoryUI;
let gameplay: GameUI | null = null;
let performance: PerformanceCoordinator | null = null;
let activeSongId: string | null = null;
let activeDifficulty: Difficulty | null = null;
let activeChart: ChartConfig | null = null;
let animationFrame = 0;
let disposed = false;
let elapsedSeconds = 0;
let previousFrameTime = 0;
let sceneStatus: 'loading' | 'rendered' | 'suspended' | 'unavailable' =
  'loading';
let returning = false;
const RENDERER_ERROR =
  'The celestial view stopped responding. Playback is paused; restore it, then choose Resume or start over.';

function setSceneStatus(status: typeof sceneStatus): void {
  sceneStatus = status;
  observatory.setRendererStatus(status);
  gameplay?.setRendererStatus(status);
}

function handleRendererUnavailable(): void {
  scene = null;
  setSceneStatus('unavailable');
  if (performance !== null) {
    // Send the failure through the coordinator-owned render boundary. Its
    // callback throws with no scene, so the coordinator pauses and flags recovery.
    performance.pause();
    publishPerformanceState();
  }
}

function createRenderer(): void {
  if (disposed) return;
  setSceneStatus('loading');
  const generationScene = createBrightvaleScene(
    shell.surface,
    handleRendererUnavailable,
  );
  if (generationScene === null) {
    handleRendererUnavailable();
    return;
  }
  scene = generationScene;
}

function retryRenderer(): void {
  if (disposed || sceneStatus !== 'unavailable') return;
  scene?.destroy();
  scene = null;
  createRenderer();
}

function paintObservatory(): void {
  if (disposed) return;
  const viewport = observatory.getViewportSize();
  if (scene === null) {
    if (sceneStatus === 'unavailable') return;
    return;
  }
  const status = scene.updateObservatoryFrame({
    ...viewport,
    elapsedSeconds,
    reducedMotion,
  });
  if (status === 'rendered') {
    if (sceneStatus !== 'rendered') setSceneStatus('rendered');
    observatory.setProjectedAnchors(scene.getObservatoryAnchors());
  } else if (status !== sceneStatus) {
    setSceneStatus(status);
  }
}

function paintGameplay(
  controllerSnapshot: NonNullable<
    ReturnType<PerformanceCoordinator['snapshot']>['controller']
  >,
): void {
  const song = SONG_CATALOG.songs.find((entry) => entry.id === activeSongId);
  const chart = activeChart;
  if (
    song === undefined ||
    chart === null ||
    gameplay === null ||
    scene === null
  ) {
    throw new Error('The selected song or gameplay renderer is unavailable.');
  }
  const audioNow = performance?.snapshot().audioNow ?? 0;
  const status = scene.updateFrame({
    city: projectSceneState(controllerSnapshot, chart, reducedMotion),
    gameplay: projectGameplayFrame(
      controllerSnapshot,
      chart,
      gameplay.getGameplayLayout(),
      reducedMotion,
      audioNow,
    ),
  });
  if (status !== 'rendered') {
    setSceneStatus(status);
    throw new Error(`Gameplay renderer is ${status}.`);
  }
  if (sceneStatus !== 'rendered') setSceneStatus('rendered');
}

async function returnToBrowser(): Promise<void> {
  if (returning || disposed) return;
  returning = true;
  try {
    const previous = performance;
    performance = null;
    if (previous !== null) await previous.returnToBrowser();
    gameplay?.destroy();
    gameplay = null;
    activeSongId = null;
    activeDifficulty = null;
    activeChart = null;
    observatory.setPlayStatus('idle');
    shell.activate('observatory');
    observatory.focusSelectedSong();
  } finally {
    returning = false;
  }
}

function onPlay(request: {
  readonly songId: string;
  readonly difficulty: Difficulty;
}): void {
  const song = SONG_CATALOG.songs.find((entry) => entry.id === request.songId);
  if (song === undefined || song.availability !== 'available') {
    observatory.setPlayStatus('error', 'This song is not available to play.');
    return;
  }
  activeSongId = song.id;
  activeDifficulty = request.difficulty;
  activeChart = getSongChart(song, request.difficulty);
  gameplay = createGameUI(applicationRoot, song, activeChart, {
    start: () => beginSelectedPerformance(),
    resume: () => {
      if (performance === null) return;
      void performance.resume().then(publishPerformanceState);
    },
    restart: () => {
      if (performance === null) return;
      void performance.restart().then(publishPerformanceState);
    },
    returnToBrowser: () => void returnToBrowser(),
    onRendererRetry: retryRenderer,
  });
  gameplay.setRendererStatus(
    sceneStatus,
    sceneStatus === 'unavailable' ? RENDERER_ERROR : undefined,
  );
  observatory.setPlayStatus('preparing', `Preparing ${song.title}…`);
  // This call stays in the trusted Play event stack: AudioContext creation and
  // resume happen synchronously before any promise is awaited.
  beginSelectedPerformance();
}

function beginSelectedPerformance(): void {
  const song = SONG_CATALOG.songs.find((entry) => entry.id === activeSongId);
  if (song === undefined || activeDifficulty === null) return;
  if (performance === null) {
    performance = createPerformanceCoordinator({
      createAudioContext: () => {
        if (typeof window.AudioContext !== 'function')
          throw new Error('This browser does not provide Web Audio playback.');
        const context = new window.AudioContext();
        return createBrowserAudioContextAdapter(
          context,
          parseSongOutputVolume(import.meta.env.VITE_SONG_VOLUME),
        );
      },
      fetchAudio: async (url, signal) => {
        const response = await fetch(url, { signal });
        if (!response.ok)
          throw new Error(
            `The selected recording could not be fetched (${response.status}).`,
          );
        return response.arrayBuffer();
      },
      render: paintGameplay,
    });
  }
  const active = performance;
  const preparing = active.prepare(song, activeDifficulty);
  shell.activate('gameplay');
  gameplay?.setBusy('Loading the selected recording…');
  void preparing.then(() => {
    if (performance !== active || activeSongId !== song.id || disposed) return;
    publishPerformanceState();
  });
}

function publishPerformanceState(): void {
  if (performance === null || gameplay === null) return;
  const snapshot = performance.snapshot();
  const controller = snapshot.controller;
  if (snapshot.recoveryRequired || controller?.audio.status === 'error') {
    // Renderer failures are recoverable without reloading audio. Keep the
    // paused panel (and its explicit Resume/Restart actions) visible.
    gameplay.showFatal(null);
  } else {
    gameplay.showFatal(snapshot.error);
  }
  if (controller !== null) gameplay.render(controller, snapshot.audioNow ?? 0);
  if (snapshot.recoveryRequired) {
    gameplay.setRendererStatus(
      sceneStatus,
      sceneStatus === 'unavailable' ? RENDERER_ERROR : undefined,
    );
    gameplay.setRecoveryNotice(
      sceneStatus === 'rendered' ? RENDERER_ERROR : null,
    );
    gameplay.setBusy(null);
  } else {
    gameplay.setRecoveryNotice(null);
    gameplay.setBusy(null);
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  );
}

function isGameplayActive(): boolean {
  return (
    shell.screens.querySelector<HTMLElement>(
      '[data-experience-screen="gameplay"]',
    )?.hidden === false
  );
}

function onKeyDown(event: KeyboardEvent): void {
  if (!isGameplayActive()) return;
  if (isEditableTarget(event.target)) return;
  if (event.code === 'Escape') {
    event.preventDefault();
    performance?.pause();
    publishPerformanceState();
    return;
  }
  if (/^Key[DFJK]$/.test(event.code)) {
    event.preventDefault();
    performance?.keyDown(event.code, event.repeat);
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (/^Key[DFJK]$/.test(event.code)) performance?.keyUp(event.code);
}

function onWindowBlur(): void {
  const controller = performance?.snapshot().controller;
  if (
    controller?.audio.status === 'playing' ||
    controller?.audio.status === 'starting'
  ) {
    performance?.pause();
    publishPerformanceState();
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') onWindowBlur();
}

function onReducedMotionChange(event: MediaQueryListEvent): void {
  reducedMotion = event.matches;
}

function frame(now: number): void {
  if (disposed) return;
  const delta =
    previousFrameTime === 0
      ? 0
      : Math.min(0.05, (now - previousFrameTime) / 1000);
  previousFrameTime = now;
  if (!reducedMotion) elapsedSeconds += delta;
  const gameplayActive = isGameplayActive();
  if (!gameplayActive) {
    paintObservatory();
  } else if (performance !== null) {
    const before = performance.snapshot();
    if (before.controller !== null) {
      if (before.recoveryRequired || !before.gameplayReady) {
        try {
          paintGameplay(before.controller);
          if (!before.gameplayReady)
            void performance.markGameplayReady().then(publishPerformanceState);
          publishPerformanceState();
        } catch {
          // Surface the coordinator's failure snapshot while keeping the run
          // paused and the return/retry controls available.
          publishPerformanceState();
        }
      } else {
        performance.update();
        publishPerformanceState();
      }
    }
  }
  animationFrame = requestAnimationFrame(frame);
}

observatory = createObservatoryUI(applicationRoot, SONG_CATALOG, {
  onPlay,
  onRendererRetry: retryRenderer,
});
createRenderer();
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('blur', onWindowBlur);
document.addEventListener('visibilitychange', onVisibilityChange);
reducedMotionQuery.addEventListener('change', onReducedMotionChange);
animationFrame = requestAnimationFrame(frame);

function dispose(): void {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(animationFrame);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onWindowBlur);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  reducedMotionQuery.removeEventListener('change', onReducedMotionChange);
  scene?.destroy();
  scene = null;
  gameplay?.destroy();
  observatory.destroy();
  if (performance !== null) void performance.dispose();
}

if (import.meta.hot) import.meta.hot.dispose(dispose);
