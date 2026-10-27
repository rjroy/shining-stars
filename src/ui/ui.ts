import type { ChartConfig } from '../game/chart';
import {
  createPersonalBestResultSnapshot,
  formatPersonalBestResult,
} from './personal-best-copy';
import type { PersonalBestScoreResult } from '../app/personal-best-scores';
import type { ControllerSnapshot } from '../game/controller';
import type { GameSnapshot } from '../game/game';
import {
  defaultDifficulty,
  getDifficultyProfile,
  type Difficulty,
} from '../game/game-balance';
import { getInitialTwilightStrength } from '../game/chart';
import {
  GOLD_STAR_THRESHOLDS,
  NORMAL_STAR_THRESHOLDS,
} from '../game/star-thresholds';
import { getResourceBars } from './resource-bars';
import {
  createFeedbackAnnouncementTracker,
  createVictoryAnnouncementTracker,
  updateGameplayStatusText,
} from './ui-feedback';
import {
  createBrightvaleViewportLayout,
  type BrightvaleRendererStatus,
  type BrightvaleViewportLayout,
  type BrightvaleViewportRect,
} from '../rendering/brightvale/viewport';
import { ensureExperienceShell } from './experience-shell';
import type { SongCatalogEntry } from '../catalog/catalog';
import { createSongProgress } from './song-progress';
import {
  createMusicVolumeControl,
  type MusicVolumeOptions,
  type MusicVolumeState,
} from './music-volume-control';

export interface UIActions {
  readonly start: () => void;
  readonly resume: () => void;
  readonly restart: () => void;
  readonly returnToBrowser: () => void;
  readonly onRendererRetry?: () => void;
  readonly onLaneDown?: (lane: 0 | 1 | 2 | 3) => void;
  readonly onLaneUp?: (lane: 0 | 1 | 2 | 3) => void;
  readonly onPause?: () => void;
  readonly onOrientationBlocked?: () => void;
}

export interface TouchPresentation {
  readonly eligible: boolean;
  readonly portrait: boolean;
  readonly enabled: boolean;
  readonly showGuard: boolean;
}

export interface GameUI {
  setMusicVolume(state: MusicVolumeState): void;
  setCompletedScore(runId: number, comparison: PersonalBestScoreResult): void;
  setTouchPresentation(presentation: TouchPresentation): void;
  render(snapshot: ControllerSnapshot, audioNow: number): void;
  setBusy(message: string | null): void;
  setRendererStatus(status: BrightvaleRendererStatus, message?: string): void;
  setRecoveryNotice(message: string | null): void;
  getGameplayLayout(): BrightvaleViewportLayout;
  showFatal(message: string | null): void;
  destroy(): void;
}

/** Read the transport's scheduled start, including resumed count-ins. */
export function getStartCountdown(
  audio: Pick<ControllerSnapshot['audio'], 'status' | 'scheduledWhen'>,
  audioNow: number,
): number | null {
  if (audio.status !== 'starting' || audio.scheduledWhen === null) return null;
  const remaining = audio.scheduledWhen - audioNow;
  return remaining > 0 ? Math.ceil(remaining) : null;
}

function profileSummary(
  profile: ReturnType<typeof getDifficultyProfile>,
): string {
  const milliseconds = (seconds: number) => Math.round(seconds * 1000);
  return `Perfect ±${milliseconds(profile.timing.perfectWindowSeconds)} ms · Good ±${milliseconds(profile.timing.goodWindowSeconds)} ms. Audience Renown: Perfect ${profile.audience.perfect}, Good ${profile.audience.good}, Miss ${profile.audience.miss}. Twilight: Miss costs ${profile.twilight.miss.personalCost}; Good costs ${profile.twilight.good.personalCost} and deals ${profile.twilight.good.damage}; Perfect costs ${profile.twilight.perfect.personalCost} and deals ${profile.twilight.perfect.damage}.`;
}

function difficultyLabel(difficulty: Difficulty): string {
  return `${difficulty[0]?.toUpperCase()}${difficulty.slice(1)}`;
}

function accuracyLabel(accuracy: number | null): string {
  return accuracy === null ? 'No notes' : `${Math.round(accuracy)}%`;
}

function phaseStatsLabel(stats: {
  readonly perfect: number;
  readonly good: number;
  readonly miss: number;
}): string {
  return `${stats.perfect} perfect · ${stats.good} good · ${stats.miss} missed`;
}

function setText(root: ParentNode, selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element !== null) setElementText(element, value);
}

function setHidden(root: ParentNode, selector: string, hidden: boolean): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element !== null && element.hidden !== hidden) element.hidden = hidden;
}

function setElementText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

type ScoreFields = Pick<
  GameSnapshot,
  'score' | 'combo' | 'multiplier' | 'normalMaximum'
>;

/** Two continuous progress tracks painted into the same five silhouettes. */
export function getScorePresentation(fields: ScoreFields) {
  const ratio =
    fields.normalMaximum > 0 ? fields.score / fields.normalMaximum : 0;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const normalEdges = [0, ...NORMAL_STAR_THRESHOLDS];
  const goldEdges = [
    NORMAL_STAR_THRESHOLDS[NORMAL_STAR_THRESHOLDS.length - 1]!,
    ...GOLD_STAR_THRESHOLDS,
  ];
  const stars = Array.from({ length: 5 }, (_, index) => ({
    normalFill: clamp(
      (ratio - normalEdges[index]!) /
        (normalEdges[index + 1]! - normalEdges[index]!),
    ),
    goldFill: clamp(
      (ratio - goldEdges[index]!) / (goldEdges[index + 1]! - goldEdges[index]!),
    ),
  }));
  const amount = (track: 'normalFill' | 'goldFill') =>
    Number(stars.reduce((sum, star) => sum + star[track], 0).toFixed(2));
  return {
    scoreText: fields.score.toLocaleString('en-US'),
    comboText: String(fields.combo),
    multiplierText: `×${fields.multiplier}`,
    stars,
    starSummary: `Normal stars: ${amount('normalFill')} of 5; Gold stars: ${amount('goldFill')} of 5.`,
    ariaLive: 'off' as const,
  };
}

type ScoreTransitionState = ScoreFields &
  Pick<GameSnapshot, 'transportTime' | 'status'>;
type ScoreEcho =
  | { kind: 'star'; index: number; track: 'normal' | 'gold' }
  | {
      kind: 'multiplier';
      from: number;
      to: number;
      direction: 'grow' | 'shrink';
      text: string;
    };

export function createScoreTransitionTracker() {
  let previous: ScoreTransitionState | null = null;
  let disposed = false;
  return {
    update(
      state: ScoreTransitionState,
      options: { active: boolean; reducedMotion: boolean },
    ): ScoreEcho[] {
      if (disposed) return [];
      const before = previous;
      previous = { ...state };
      if (
        !before ||
        !options.active ||
        options.reducedMotion ||
        state.status === 'results' ||
        state.score < before.score ||
        state.transportTime < before.transportTime ||
        state.normalMaximum !== before.normalMaximum
      )
        return [];
      const echoes: ScoreEcho[] = [];
      if (state.normalMaximum > 0) {
        const oldRatio = before.score / state.normalMaximum;
        const ratio = state.score / state.normalMaximum;
        for (const [track, thresholds] of [
          ['normal', NORMAL_STAR_THRESHOLDS],
          ['gold', GOLD_STAR_THRESHOLDS],
        ] as const) {
          thresholds.forEach((threshold, index) => {
            if (oldRatio < threshold && ratio >= threshold)
              echoes.push({ kind: 'star', index, track });
          });
        }
      }
      if (state.multiplier > before.multiplier) {
        echoes.push({
          kind: 'multiplier',
          from: before.multiplier,
          to: state.multiplier,
          direction: 'grow',
          text: `×${state.multiplier}`,
        });
      } else if (state.multiplier === 1 && before.multiplier > 1) {
        echoes.push({
          kind: 'multiplier',
          from: before.multiplier,
          to: 1,
          direction: 'shrink',
          text: `×${before.multiplier}`,
        });
      }
      return echoes;
    },
    reset() {
      previous = null;
    },
    dispose() {
      disposed = true;
      previous = null;
    },
  };
}

const SCORE_STAR_PATH =
  'M50 5 63 34 95 38 71 60 78 93 50 76 22 93 29 60 5 38 37 34Z';

/** Decorative copies live outside the measured HUD, never inside its flow. */
function createScoreEchoLayer(root: HTMLElement) {
  const layer = document.createElement('div');
  layer.className = 'score-echo-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.dataset.scoreEchoLayer = '';
  root.append(layer);
  const targets = [
    ...root.querySelectorAll<SVGSVGElement>('[data-score-stars] .score-star'),
  ];
  const multiplier = root.querySelector<HTMLElement>('[data-score-multiplier]');
  const cleanups = new Set<() => void>();
  const clear = () => {
    for (const cleanup of cleanups) cleanup();
  };
  return {
    clear,
    play(event: ScoreEcho) {
      const target = event.kind === 'star' ? targets[event.index] : multiplier;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const origin = root.getBoundingClientRect();
      const echo = document.createElement('span');
      echo.className = `score-echo score-echo--${event.kind === 'star' ? event.track : event.direction}`;
      echo.dataset.scoreEcho = event.kind;
      if (event.kind === 'star') {
        echo.dataset.echoTrack = event.track;
        echo.dataset.echoIndex = String(event.index);
        const svg = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'svg',
        );
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('focusable', 'false');
        const path = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'path',
        );
        path.setAttribute('d', SCORE_STAR_PATH);
        svg.append(path);
        echo.append(svg);
      } else {
        echo.textContent = event.text;
        echo.dataset.echoDirection = event.direction;
        const style = getComputedStyle(target);
        echo.style.font = style.font;
        echo.style.letterSpacing = style.letterSpacing;
      }
      echo.style.left = `${rect.left - origin.left}px`;
      echo.style.top = `${rect.top - origin.top}px`;
      echo.style.width = `${rect.width}px`;
      echo.style.height = `${rect.height}px`;
      // Match the CSS hold/fade; the fallback must not cut off a visible echo.
      const duration =
        event.kind === 'star' || event.direction === 'grow' ? 2600 : 2000;
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        echo.removeEventListener('animationend', cleanup);
        echo.removeEventListener('animationcancel', cleanup);
        echo.remove();
        cleanups.delete(cleanup);
      };
      // Bound simultaneous transient nodes, even under unusual snapshot bursts.
      if (cleanups.size >= 24) cleanups.values().next().value?.();
      cleanups.add(cleanup);
      echo.addEventListener('animationend', cleanup);
      echo.addEventListener('animationcancel', cleanup);
      timer = setTimeout(cleanup, duration + 100);
      layer.append(echo);
    },
    destroy() {
      clear();
      layer.remove();
    },
  };
}

function scoreStarsMarkup(prefix: string): string {
  const path = SCORE_STAR_PATH;
  return `<span class="score-stars" data-${prefix}-stars role="img" aria-label="Normal stars: 0 of 5; Gold stars: 0 of 5." aria-live="off">${Array.from(
    { length: 5 },
    (_, index) => {
      const id = `performance-${prefix}-${index}`;
      return `<svg class="score-star" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><defs><clipPath id="${id}-normal"><rect data-normal-fill width="0" height="100" /></clipPath><clipPath id="${id}-gold"><rect data-gold-fill width="0" height="100" /></clipPath></defs><path class="star-empty" d="${path}"/><path class="star-normal" d="${path}" clip-path="url(#${id}-normal)"/><path class="star-gold" d="${path}" clip-path="url(#${id}-gold)"/></svg>`;
    },
  ).join('')}</span>`;
}

function createScoreReadout(root: HTMLElement, prefix: string) {
  const score = root.querySelector<HTMLElement>(`[data-${prefix}]`);
  const combo = root.querySelector<HTMLElement>(`[data-${prefix}-combo]`);
  const multiplier = root.querySelector<HTMLElement>(
    `[data-${prefix}-multiplier]`,
  );
  const stars = root.querySelector<HTMLElement>(`[data-${prefix}-stars]`);
  const normal = [
    ...(stars?.querySelectorAll<SVGRectElement>('[data-normal-fill]') ?? []),
  ];
  const gold = [
    ...(stars?.querySelectorAll<SVGRectElement>('[data-gold-fill]') ?? []),
  ];
  return (fields: ScoreFields) => {
    const value = getScorePresentation(fields);
    if (score) setElementText(score, value.scoreText);
    if (combo) setElementText(combo, value.comboText);
    if (multiplier) setElementText(multiplier, value.multiplierText);
    if (stars?.getAttribute('aria-label') !== value.starSummary)
      stars?.setAttribute('aria-label', value.starSummary);
    value.stars.forEach((star, index) => {
      for (const [rect, fill] of [
        [normal[index], star.normalFill],
        [gold[index], star.goldFill],
      ] as const) {
        const width = String(fill * 100);
        if (rect?.getAttribute('width') !== width)
          rect?.setAttribute('width', width);
      }
    });
  };
}

export function createGameUI(
  applicationRoot: HTMLElement,
  song: SongCatalogEntry,
  chart: ChartConfig,
  actions: UIActions,
  options: MusicVolumeOptions = {},
): GameUI {
  const shell = ensureExperienceShell(applicationRoot);
  const root = shell.createScreen('gameplay', 'Rhythm performance');
  root.innerHTML = `
      <div class="song-progress" data-song-progress-rail>
        <progress class="song-progress-meter" data-song-progress aria-label="Song progress" max="1" value="0"></progress>
        <span class="song-progress-fill" data-song-progress-fill aria-hidden="true"></span>
        <span class="song-progress-twilight-marker" aria-hidden="true"></span>
        <span class="song-progress-twilight-label" aria-hidden="true">Twilight</span>
        <span class="song-progress-radiant" data-radiant-marker role="img" aria-label="Radiant target with Perfect remaining notes" hidden></span>
      </div>
      <div class="gameplay-screen-content" aria-describedby="lane-instructions">
        <div class="play-heading">
          <div class="score-readout" aria-live="off">
            <span class="score-label">Score</span>
            <strong class="score-value" data-score>0</strong>
            ${scoreStarsMarkup('score')}
          </div>
          <div class="combo-readout" aria-live="off">
            <span class="score-label">Combo</span>
            <div class="combo-numbers"><strong class="combo-value" data-score-combo>0</strong><span class="combo-multiplier" data-score-multiplier>×1</span></div>
          </div>
          <div class="resource-readout player-resource" aria-live="polite" aria-atomic="true">
            <span class="resource-name" data-audience-resource>Renown</span>
            <div class="resource-meter audience-meter" data-audience-meter>
              <progress data-audience-bar max="1" value="0" aria-label="Renown"></progress>
              <span class="resource-amount"><span data-resource-value>0</span> / <span data-audience-maximum>132</span></span>
            </div>
            <span class="resource-name twilight-player-label" data-personal-label hidden>Personal Strength</span>
            <div class="resource-meter personal-meter" data-personal-meter hidden>
              <progress data-personal-bar max="1" value="0" aria-label="Personal Strength"></progress>
              <span class="resource-amount"><span data-personal-strength>0</span> / <span data-personal-maximum>0</span></span>
            </div>
          </div>
          <div class="heading-identity">
            <div class="heading-identity-copy">
            <p class="mode-label" data-mode-label>Audience performance</p>
            <h1 data-title>Sing with Brightvale</h1>
            </div>
          </div>
          <div class="resource-readout opponent-resource" aria-live="polite" aria-atomic="true" data-opponent-resource hidden>
            <span class="resource-name">Twilight Strength</span>
            <div class="resource-meter twilight-meter">
              <progress data-twilight-bar max="1" value="1" aria-label="Twilight Strength"></progress>
              <span class="resource-amount"><span data-twilight-strength>0</span> / <span data-twilight-maximum>100</span></span>
            </div>
          </div>
        </div>
        <div class="renderer-status" data-renderer-status role="status">
          <span data-renderer-message>3D playfield is not ready for this test build. Playback is locked.</span>
          <button class="text-button" type="button" data-action="renderer-retry" disabled>Retry 3D view</button>
        </div>
        <p class="renderer-status pending-playback-status" data-pending-status role="status" aria-live="polite" hidden>Finishing audio load…</p>

        <div class="stage-frame">
          <div class="stage-topline" aria-hidden="true">
            <span data-track-state>Onset-derived chart · play-test timing</span>
            <span class="stage-time" data-time>00:00</span>
          </div>
          <!-- Keep this empty spacer so the playfield layout does not shift. -->
          <p class="timing-window-legend" data-timing-legend aria-hidden="true"></p>
          <div class="countdown-row" aria-hidden="true"></div>
          <span class="sr-only" id="lane-instructions">Use the D, F, J, and K keys shown on the four lane fronts to hit notes at the line. Escape pauses the performance.</span>
        </div>

        <div class="start-countdown" data-countdown role="status" aria-live="polite" aria-atomic="true" hidden>
          <span class="start-countdown-label">Starting in</span>
          <strong class="start-countdown-number" data-countdown-number></strong>
          <span class="sr-only" data-countdown-unit></span>
        </div>

        <section class="dialog-panel ready-panel" data-panel="ready" aria-labelledby="ready-title">
          <p class="dialog-overline" data-song-label></p>
          <h2 id="ready-title">Your voice leads. Brightvale answers.</h2>
          <p data-song-description></p>
          <p class="chart-notice" data-chart-notice></p>
          <p class="loading-message" data-busy hidden></p>
          <p class="error-message" data-error role="alert" hidden></p>
          <button class="primary-button" type="button" data-action="start" disabled>Start performance</button>
          <button class="secondary-button return-to-songs" type="button" data-action="return">Return to songs</button>
        </section>

        <section class="dialog-panel pause-panel" data-panel="pause" aria-labelledby="pause-title" hidden>
          <p class="dialog-overline">The song is held</p>
          <h2 id="pause-title" tabindex="-1">Take your time.</h2>
          <p>Your place in the song is saved. The chart will wait through a short count-in.</p>
          <p class="error-message recovery-notice" data-recovery-notice role="status" hidden></p>
          <div class="pause-music-controls" data-music-control></div>
          <div class="dialog-actions"><button class="primary-button" type="button" data-action="resume" disabled>Resume <span aria-hidden="true">↗</span></button><button class="secondary-button" type="button" data-action="restart" disabled>Start over</button></div>
          <button class="secondary-button return-to-songs" type="button" data-action="return">Return to songs</button>
        </section>

        <section class="dialog-panel result-panel" data-panel="results" aria-labelledby="result-title" hidden>
          <p class="dialog-overline">The song has settled</p>
          <h2 id="result-title" data-result-title>Brightvale heard you.</h2>
          <p class="result-boundary">A missed note is not surrender.</p>
          <div class="result-score" aria-live="off">
            <span class="score-label">Score</span>
            <strong class="score-value" data-result-score>0</strong>
            ${scoreStarsMarkup('result-score')}
            <p class="result-combo">Best combo <strong data-result-score-combo>0</strong> <span data-result-score-multiplier>×1</span></p>
          </div>
          <p class="result-personal-best" data-result-personal-best role="status" hidden></p>
          <div class="result-grid" data-result-grid></div>
          <button class="primary-button" type="button" data-action="restart" disabled>Sing again <span aria-hidden="true">↗</span></button>
          <button class="secondary-button return-to-songs" type="button" data-action="return">Return to songs</button>
        </section>

        <section class="dialog-panel error-panel" data-panel="error" aria-labelledby="error-title" hidden>
          <p class="dialog-overline">Audio could not begin</p>
          <h2 id="error-title">The song is not ready.</h2>
          <p data-audio-error role="alert">Check the selected track and try again.</p>
          <button class="primary-button" type="button" data-action="start" disabled>Retry loading <span aria-hidden="true">↗</span></button>
          <button class="secondary-button return-to-songs" type="button" data-action="return">Return to songs</button>
        </section>
        <span class="sr-only" data-gameplay-status role="status" aria-live="polite" aria-atomic="true"></span>
        <div class="touch-controls" data-touch-controls hidden aria-label="Touch lanes">
          <button class="touch-pause" type="button" data-action="pause" aria-label="Pause performance">Pause</button>
          <div class="touch-lanes">
            <button class="touch-lane" type="button" data-touch-lane="0" aria-label="Lane 1, D" disabled><span>D</span></button>
            <button class="touch-lane" type="button" data-touch-lane="1" aria-label="Lane 2, F" disabled><span>F</span></button>
            <button class="touch-lane" type="button" data-touch-lane="2" aria-label="Lane 3, J" disabled><span>J</span></button>
            <button class="touch-lane" type="button" data-touch-lane="3" aria-label="Lane 4, K" disabled><span>K</span></button>
          </div>
        </div>
        <section class="touch-rotate-guard" data-touch-guard role="region" aria-label="Portrait gameplay required" hidden>
          <h2>Turn your phone upright</h2>
          <p>The song will wait. When you're ready, choose Resume.</p>
          <button class="secondary-button" type="button" data-action="return">Return to songs</button>
        </section>
      </div>`;

  shell.activate('gameplay');
  const musicControl = createMusicVolumeControl(
    root.querySelector<HTMLElement>('[data-music-control]')!,
    options,
  );
  const pausePanel = root.querySelector<HTMLElement>('[data-panel="pause"]')!;
  const songProgress = createSongProgress(root, chart);
  setText(
    root,
    '[data-song-label]',
    `${song.title} · ${song.segmentKind === 'excerpt' ? 'Demo excerpt' : 'Full track'}`,
  );
  setText(
    root,
    '[data-song-description]',
    song.segmentKind === 'excerpt'
      ? 'This is a short demo excerpt. Follow the notes to the line; the song carries you through Audience and Twilight.'
      : `Follow the notes to the line. At Twilight, your Renown becomes Personal Strength; the enemy begins with ${getInitialTwilightStrength(chart, defaultDifficulty(chart.allowedDifficulties))} Twilight Strength. A missed note is not surrender.`,
  );
  setText(
    root,
    '[data-chart-notice]',
    song.chartStatus === 'candidate'
      ? 'Play-test chart · still being refined'
      : 'Verified chart',
  );
  setText(root, '[data-title]', song.title);
  setText(
    root,
    '[data-track-state]',
    `${song.segmentKind === 'excerpt' ? 'Demo excerpt' : 'Full track'} · ${song.chartStatus === 'candidate' ? 'play-test chart' : 'verified chart'}`,
  );
  const playSurface = shell.surface;
  const playHeading = root.querySelector<HTMLElement>('.play-heading');
  const stageHeader = root.querySelector<HTMLElement>('.stage-topline');
  const timingLegend = root.querySelector<HTMLElement>('[data-timing-legend]');
  const timeSlot = root.querySelector<HTMLElement>('[data-time]');
  const countdown = root.querySelector<HTMLElement>('[data-countdown]');
  const countdownNumber = root.querySelector<HTMLElement>(
    '[data-countdown-number]',
  );
  const countdownUnit = root.querySelector<HTMLElement>(
    '[data-countdown-unit]',
  );
  const panels = [...root.querySelectorAll<HTMLElement>('[data-panel]')];
  const actionButtons = [
    ...root.querySelectorAll<HTMLButtonElement>('[data-action]'),
  ];
  const touchControls = root.querySelector<HTMLElement>(
    '[data-touch-controls]',
  );
  const touchGuard = root.querySelector<HTMLElement>('[data-touch-guard]');
  const touchPads = [
    ...root.querySelectorAll<HTMLButtonElement>('[data-touch-lane]'),
  ];
  const touchPause = root.querySelector<HTMLButtonElement>(
    '[data-action="pause"]',
  );
  let touch: TouchPresentation = {
    eligible: false,
    portrait: true,
    enabled: false,
    showGuard: false,
  };
  let touchDisposed = false;
  let lastReady = true;
  const pointers = new Map<
    number,
    { lane: 0 | 1 | 2 | 3; target: HTMLButtonElement }
  >();
  const laneReferences = [0, 0, 0, 0];
  function releasePointer(pointerId: number): void {
    const owned = pointers.get(pointerId);
    if (!owned) return;
    pointers.delete(pointerId);
    laneReferences[owned.lane]!--;
    if (laneReferences[owned.lane] === 0) {
      owned.target.classList.remove('is-pressed');
      actions.onLaneUp?.(owned.lane);
    }
    if (owned.target.hasPointerCapture(pointerId))
      owned.target.releasePointerCapture(pointerId);
  }
  function resetTouch(): void {
    for (const pointerId of [...pointers.keys()]) releasePointer(pointerId);
  }
  function setTouchPresentation(next: TouchPresentation): void {
    if (touchDisposed) return;
    const becameBlocked = next.showGuard && !touch.showGuard;
    touch = next;
    const enabled =
      next.eligible && next.portrait && next.enabled && !next.showGuard;
    if (!enabled) resetTouch();
    if (touchControls) touchControls.hidden = !enabled;
    if (touchGuard) touchGuard.hidden = !next.showGuard;
    for (const pad of touchPads) pad.disabled = !enabled;
    if (touchPause) touchPause.disabled = !enabled;
    if (lastReady) {
      for (const button of actionButtons) {
        if (button.dataset.action === 'start')
          button.disabled =
            next.showGuard ||
            pendingPlaybackRequests ||
            busyMessage !== null ||
            rendererStatus !== 'rendered';
      }
    }
    setText(
      root,
      '#lane-instructions',
      next.eligible
        ? 'Tap the four targets with your thumbs to hit notes at the line. D, F, J, and K also work. Use Pause to hold the song.'
        : 'Use the D, F, J, and K keys shown on the four lane fronts to hit notes at the line. Escape pauses the performance.',
    );
    if (becameBlocked) actions.onOrientationBlocked?.();
  }
  function onTouchDown(event: PointerEvent): void {
    if (
      touchDisposed ||
      !touch.enabled ||
      !touch.eligible ||
      !touch.portrait ||
      touch.showGuard ||
      pointers.has(event.pointerId)
    )
      return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-touch-lane]')
        : null;
    if (!target || target.disabled) return;
    const lane = Number(target.dataset.touchLane);
    if (lane !== 0 && lane !== 1 && lane !== 2 && lane !== 3) return;
    event.preventDefault();
    target.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { lane, target });
    laneReferences[lane] = (laneReferences[lane] ?? 0) + 1;
    target.classList.add('is-pressed');
    if (laneReferences[lane] === 1) actions.onLaneDown?.(lane);
  }
  function onTouchEnd(event: PointerEvent): void {
    releasePointer(event.pointerId);
  }
  function onTouchInterruption(): void {
    setTouchPresentation({ ...touch, enabled: false });
  }
  function onTouchVisibility(): void {
    if (document.visibilityState === 'hidden') onTouchInterruption();
  }
  root.addEventListener('pointerdown', onTouchDown);
  root.addEventListener('pointerup', onTouchEnd);
  root.addEventListener('pointercancel', onTouchEnd);
  root.addEventListener('lostpointercapture', onTouchEnd);
  window.addEventListener('blur', onTouchInterruption);
  window.addEventListener('visibilitychange', onTouchVisibility);
  let busyMessage: string | null = null;
  let fatalMessage: string | null = null;
  let rendererStatus: BrightvaleRendererStatus = 'loading';
  let rendererMessage = 'Loading Brightvale…';
  let pendingPlaybackRequests = false;
  let resultsRendered = false;
  const completedScore = createPersonalBestResultSnapshot();
  const updateScore = createScoreReadout(root, 'score');
  const updateResultScore = createScoreReadout(root, 'result-score');
  const scoreTransitions = createScoreTransitionTracker();
  const scoreEchoes = createScoreEchoLayer(root);
  const motionPreference =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  const onMotionPreferenceChange = () => scoreEchoes.clear();
  motionPreference?.addEventListener('change', onMotionPreferenceChange);
  window.addEventListener('resize', scoreEchoes.clear);
  let previousScoreFrame: ScoreTransitionState | null = null;
  const feedbackAnnouncements = createFeedbackAnnouncementTracker();
  const victoryAnnouncements = createVictoryAnnouncementTracker();
  const emptyRect: BrightvaleViewportRect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  let gameplayLayout: BrightvaleViewportLayout = {
    width: 0,
    height: 0,
    persistentHudExclusions: [],
    labels: {
      time: emptyRect,
      countdown: emptyRect,
      legend: emptyRect,
      feedback: emptyRect,
    },
  };
  const measureGameplayLayout = () => {
    if (playSurface === null) return;
    const hostRect = playSurface.getBoundingClientRect();
    const style = getComputedStyle(playSurface);
    const cssPx = (value: string): number => Number.parseFloat(value) || 0;
    const borderLeft = cssPx(style.borderLeftWidth);
    const borderRight = cssPx(style.borderRightWidth);
    const borderTop = cssPx(style.borderTopWidth);
    const borderBottom = cssPx(style.borderBottomWidth);
    const paddingLeft = cssPx(style.paddingLeft);
    const paddingRight = cssPx(style.paddingRight);
    const paddingTop = cssPx(style.paddingTop);
    const paddingBottom = cssPx(style.paddingBottom);
    const contentLeft = hostRect.left + borderLeft + paddingLeft;
    const contentTop = hostRect.top + borderTop + paddingTop;
    const readRect = (element: HTMLElement | null): BrightvaleViewportRect => {
      if (element === null)
        return { x: contentLeft, y: contentTop, width: 0, height: 0 };
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };
    };
    const nextLayout = createBrightvaleViewportLayout({
      host: {
        left: contentLeft,
        top: contentTop,
        width: Math.max(
          0,
          hostRect.width -
            borderLeft -
            borderRight -
            paddingLeft -
            paddingRight,
        ),
        height: Math.max(
          0,
          hostRect.height -
            borderTop -
            borderBottom -
            paddingTop -
            paddingBottom,
        ),
      },
      hud: [...[...(playHeading?.children ?? [])]]
        .filter(
          (element): element is HTMLElement => element instanceof HTMLElement,
        )
        .map((element) => ({
          kind: 'persistent' as const,
          // The narrow-screen identity is visually repositioned inside its
          // original flow slot. Exclude its actual painted bounds, not that slot.
          rect: readRect(
            element.querySelector<HTMLElement>('.heading-identity-copy') ??
              element,
          ),
        }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0),
      labels: {
        time: readRect(timeSlot),
        // The DOM overlay owns the countdown; do not also paint it in 3D.
        countdown: readRect(null),
        legend: readRect(timingLegend),
        feedback: readRect(null),
      },
    });
    if (JSON.stringify(nextLayout) !== JSON.stringify(gameplayLayout)) {
      gameplayLayout = nextLayout;
      playSurface.dispatchEvent(
        new CustomEvent('brightvale-layout-measured', {
          detail: gameplayLayout,
        }),
      );
    }
  };
  const layoutResizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(measureGameplayLayout)
      : null;
  const layoutElements = [
    playSurface,
    playHeading,
    stageHeader,
    ...[...(playHeading?.children ?? [])],
    timeSlot,
    timingLegend,
  ];
  layoutElements.forEach((element) => {
    if (element !== null) layoutResizeObserver?.observe(element);
  });
  measureGameplayLayout();
  if (layoutResizeObserver === null && typeof window !== 'undefined')
    window.addEventListener('resize', measureGameplayLayout);

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('[data-action]');
    if (button === null || button.disabled) return;
    const action = button.dataset.action;
    if (
      touch.showGuard &&
      ['start', 'resume', 'restart'].includes(action ?? '')
    )
      return;
    if (
      pendingPlaybackRequests &&
      ['start', 'resume', 'restart'].includes(action ?? '')
    )
      return;
    if (action === 'start' || action === 'restart') {
      scoreEchoes.clear();
      scoreTransitions.reset();
      previousScoreFrame = null;
      if (action === 'start') actions.start();
      else actions.restart();
    } else if (action === 'resume') {
      if (!touch.showGuard) actions.resume();
    } else if (action === 'pause') {
      onTouchInterruption();
      actions.onPause?.();
    } else if (action === 'return') {
      scoreEchoes.clear();
      actions.returnToBrowser();
    } else if (action === 'renderer-retry') actions.onRendererRetry?.();
  }

  root.addEventListener('click', onClick);

  function showPanel(name: string | null): void {
    for (const panel of panels) {
      const hidden = panel.dataset.panel !== name;
      if (panel.hidden !== hidden) panel.hidden = hidden;
    }
  }

  function renderResults(game: GameSnapshot): void {
    const result = game.result;
    const grid = root.querySelector<HTMLElement>('[data-result-grid]');
    if (result === null || grid === null) return;
    updateResultScore({
      ...result,
      combo: result.bestCombo,
      multiplier: result.bestComboMultiplier,
    });
    const outcomeLabels = {
      victory: 'Victory',
      defeat: 'Defeat',
      survived: 'Survived',
    } as const;
    setText(root, '[data-result-title]', outcomeLabels[result.outcome]);
    const enemySummary =
      result.outcome === 'survived'
        ? 'The enemy remains undefeated.'
        : result.outcome === 'victory'
          ? 'The enemy has been defeated.'
          : 'Your strength ran out before the enemy fell.';
    grid.innerHTML = `
      <p class="result-outcome-copy">Difficulty: ${difficultyLabel(result.difficulty)}</p>
      <p class="result-outcome-copy">${enemySummary}</p>
      <div class="result-line"><span>Renown earned</span><strong>${result.renown}</strong><small>${profileSummary(getDifficultyProfile(result.difficulty))}</small></div>
      <div class="result-line"><span>Personal Strength remaining</span><strong>${result.personalStrength}</strong><small>${result.outcome === 'defeat' ? 'Exhausted' : 'You stood your ground'}</small></div>
      <div class="result-line"><span>Twilight Strength remaining</span><strong>${result.twilightStrength}</strong><small>${enemySummary}</small></div>
      <div class="result-line"><span>Audience · accuracy</span><strong>${accuracyLabel(result.audience.accuracy)}</strong><small>${phaseStatsLabel(result.audience)}</small></div>
      <div class="result-line"><span>Twilight · accuracy</span><strong>${accuracyLabel(result.twilight.accuracy)}</strong><small>${phaseStatsLabel(result.twilight)}</small></div>
      <div class="result-line result-total"><span>Whole performance</span><strong>${accuracyLabel(result.overall.accuracy)}</strong><small>${phaseStatsLabel(result.overall)}</small></div>`;
  }

  function render(snapshot: ControllerSnapshot, audioNow: number): void {
    const { audio, game } = snapshot;
    songProgress.render(game.transportTime, {
      target: game.radiantTarget,
      achieved: game.victory,
      clockTime: audioNow,
      paused:
        audio.status === 'starting' ||
        (audio.status === 'paused' && game.status !== 'results') ||
        snapshot.pendingPlaybackRequests,
      reducedMotion: motionPreference?.matches ?? false,
      runId: snapshot.runId,
    });
    updateScore(game);
    pendingPlaybackRequests = snapshot.pendingPlaybackRequests;
    const isError = audio.status === 'error' || fatalMessage !== null;
    const isResults = game.status === 'results';
    const isPaused =
      audio.status === 'paused' &&
      audio.loaded &&
      !pendingPlaybackRequests &&
      !isError &&
      !isResults;
    const isStarting = audio.status === 'starting';
    const isPlaying = audio.status === 'playing' && game.status === 'playing';
    if (!isPlaying || pendingPlaybackRequests || isError) onTouchInterruption();
    const isReady =
      !isPaused && !isPlaying && !isStarting && !isError && !isResults;
    lastReady = isReady;
    const echoesActive =
      isPlaying &&
      !isError &&
      !pendingPlaybackRequests &&
      rendererStatus === 'rendered';
    if (
      !echoesActive ||
      motionPreference?.matches ||
      (previousScoreFrame !== null &&
        (game.score < previousScoreFrame.score ||
          game.transportTime < previousScoreFrame.transportTime ||
          game.normalMaximum !== previousScoreFrame.normalMaximum))
    )
      scoreEchoes.clear();
    const echoes = scoreTransitions.update(game, {
      active: echoesActive,
      reducedMotion: motionPreference?.matches ?? false,
    });
    previousScoreFrame = { ...game };
    for (const echo of echoes) scoreEchoes.play(echo);
    playSurface?.setAttribute('aria-busy', String(pendingPlaybackRequests));
    const focusPause = isPaused && pausePanel.hidden;
    showPanel(
      isResults
        ? 'results'
        : isPaused
          ? 'pause'
          : isError
            ? 'error'
            : isReady
              ? 'ready'
              : null,
    );
    for (const actionButton of actionButtons) {
      const action = actionButton.dataset.action;
      const disabled =
        action === 'start'
          ? (!isError && !isReady) ||
            pendingPlaybackRequests ||
            rendererStatus !== 'rendered' ||
            busyMessage !== null ||
            touch.showGuard
          : action === 'renderer-retry'
            ? rendererStatus !== 'unavailable' ||
              actions.onRendererRetry === undefined
            : action === 'return'
              ? false
              : pendingPlaybackRequests ||
                rendererStatus !== 'rendered' ||
                busyMessage !== null;
      if (actionButton.disabled !== disabled) actionButton.disabled = disabled;
    }
    if (focusPause && !touch.showGuard) {
      const resume = pausePanel.querySelector<HTMLButtonElement>(
        '[data-action="resume"]',
      );
      (resume !== null && !resume.disabled
        ? resume
        : pausePanel.querySelector<HTMLElement>('#pause-title')
      )?.focus();
    }
    const rendererStatusNode = root.querySelector<HTMLElement>(
      '[data-renderer-status]',
    );
    const statusHidden = rendererStatus === 'rendered';
    if (
      rendererStatusNode !== null &&
      rendererStatusNode.hidden !== statusHidden
    )
      rendererStatusNode.hidden = statusHidden;
    const pendingStatus = root.querySelector<HTMLElement>(
      '[data-pending-status]',
    );
    if (pendingStatus !== null) {
      const hidden = !pendingPlaybackRequests;
      if (pendingStatus.hidden !== hidden) pendingStatus.hidden = hidden;
    }
    setText(root, '[data-renderer-message]', rendererMessage);
    const busy = root.querySelector<HTMLElement>('[data-busy]');
    if (busy !== null) {
      const hidden = busyMessage === null || pendingPlaybackRequests;
      if (busy.hidden !== hidden) busy.hidden = hidden;
      setElementText(busy, busyMessage ?? '');
    }
    const error = root.querySelector<HTMLElement>('[data-error]');
    if (error !== null) {
      if (error.hidden !== (fatalMessage === null))
        error.hidden = fatalMessage === null;
      setElementText(error, fatalMessage ?? '');
    }
    setText(
      root,
      '[data-audio-error]',
      fatalMessage ??
        audio.error ??
        busyMessage ??
        'Check the selected track and try again.',
    );

    playSurface?.classList.toggle('is-twilight', game.phase === 'twilight');
    playSurface?.classList.toggle('is-victory', game.victory);
    const victoryAnnouncement = victoryAnnouncements.update(game.victory);
    setText(
      root,
      '[data-mode-label]',
      game.victory
        ? 'Radiant victory · the song continues'
        : game.phase === 'audience'
          ? 'Audience performance'
          : 'Twilight · the city answers',
    );
    setText(
      root,
      '[data-title]',
      game.victory
        ? 'Brightvale shines on'
        : game.phase === 'audience'
          ? 'Sing with Brightvale'
          : 'The city sings with you',
    );
    setText(root, '[data-resource-value]', String(game.renown));
    const bars = getResourceBars(chart, game);
    const setBar = (
      selector: string,
      value: number,
      maximum: number,
      fraction: number,
    ) => {
      const progress = root.querySelector<HTMLProgressElement>(selector);
      if (progress !== null) {
        progress.max = 1;
        progress.value = fraction;
        progress.setAttribute('aria-valuetext', `${value} of ${maximum}`);
      }
    };
    setBar(
      '[data-audience-bar]',
      bars.audience.value,
      bars.audience.maximum,
      bars.audience.fraction,
    );
    setText(root, '[data-audience-maximum]', String(bars.audience.maximum));
    setBar(
      '[data-personal-bar]',
      bars.personal.value,
      bars.personal.maximum,
      bars.personal.fraction,
    );
    setText(root, '[data-personal-maximum]', String(bars.personal.maximum));
    setBar(
      '[data-twilight-bar]',
      bars.twilight.value,
      bars.twilight.maximum,
      bars.twilight.fraction,
    );
    setText(root, '[data-twilight-maximum]', String(bars.twilight.maximum));
    const isTwilight = game.phase === 'twilight';
    setHidden(root, '[data-audience-resource]', isTwilight);
    setHidden(root, '[data-resource-value]', isTwilight);
    setHidden(root, '[data-personal-label]', !isTwilight);
    setHidden(root, '[data-personal-strength]', !isTwilight);
    setHidden(root, '[data-audience-meter]', isTwilight);
    setHidden(root, '[data-personal-meter]', !isTwilight);
    setHidden(root, '[data-opponent-resource]', !isTwilight);
    setText(root, '[data-personal-strength]', String(game.personalStrength));
    setText(root, '[data-twilight-strength]', String(game.twilightStrength));
    setText(
      root,
      '[data-time]',
      `${Math.floor(game.transportTime / 60)
        .toString()
        .padStart(2, '0')}:${Math.floor(game.transportTime % 60)
        .toString()
        .padStart(2, '0')}`,
    );

    const startCountdown = getStartCountdown(audio, audioNow);
    const showCountdown =
      startCountdown !== null &&
      !isError &&
      !isResults &&
      !pendingPlaybackRequests &&
      !touch.showGuard;
    if (countdown !== null && countdown.hidden === showCountdown)
      countdown.hidden = !showCountdown;
    if (countdownNumber !== null)
      setElementText(
        countdownNumber,
        showCountdown ? String(startCountdown) : '',
      );
    if (countdownUnit !== null)
      setElementText(
        countdownUnit,
        showCountdown ? (startCountdown === 1 ? 'second' : 'seconds') : '',
      );
    const feedbackAnnouncement = feedbackAnnouncements.update(
      snapshot.feedback,
    );
    const gameplayStatus = root.querySelector<HTMLElement>(
      '[data-gameplay-status]',
    );
    if (gameplayStatus !== null)
      updateGameplayStatusText(
        gameplayStatus,
        victoryAnnouncement,
        feedbackAnnouncement,
      );

    const comparison = completedScore.read(snapshot.runId ?? 1, isResults);
    if (isResults) {
      setHidden(root, '[data-result-personal-best]', comparison === null);
      setText(
        root,
        '[data-result-personal-best]',
        comparison === null ? '' : formatPersonalBestResult(comparison),
      );
      if (!resultsRendered) renderResults(game);
      resultsRendered = true;
    } else {
      resultsRendered = false;
    }
    measureGameplayLayout();
  }

  return {
    setMusicVolume: musicControl.setState,
    setTouchPresentation,
    setCompletedScore(runId, comparison) {
      completedScore.record(runId, comparison);
      resultsRendered = false;
    },
    render,
    setBusy(message) {
      busyMessage = message;
    },
    setRendererStatus(status, message) {
      if (status !== 'rendered') scoreEchoes.clear();
      rendererStatus = status;
      rendererMessage =
        message ??
        {
          loading: 'Loading Brightvale…',
          rendered: '',
          suspended: 'Resize the window to continue playing.',
          unavailable:
            'The three-dimensional playfield could not start. Playback is locked.',
        }[status];
    },
    setRecoveryNotice(message) {
      const notice = root.querySelector<HTMLElement>('[data-recovery-notice]');
      if (notice !== null) {
        notice.textContent = message ?? '';
        notice.hidden = message === null;
      }
    },
    getGameplayLayout() {
      return gameplayLayout;
    },
    showFatal(message) {
      if (message !== null) scoreEchoes.clear();
      fatalMessage = message;
      if (message !== null) setText(root, '[data-audio-error]', message);
      if (message !== null) showPanel('error');
    },
    destroy() {
      musicControl.destroy();
      songProgress.destroy();
      if (!touchDisposed) resetTouch();
      touchDisposed = true;
      root.removeEventListener('pointerdown', onTouchDown);
      root.removeEventListener('pointerup', onTouchEnd);
      root.removeEventListener('pointercancel', onTouchEnd);
      root.removeEventListener('lostpointercapture', onTouchEnd);
      window.removeEventListener('blur', onTouchInterruption);
      window.removeEventListener('visibilitychange', onTouchVisibility);
      scoreTransitions.dispose();
      scoreEchoes.destroy();
      motionPreference?.removeEventListener('change', onMotionPreferenceChange);
      window.removeEventListener('resize', scoreEchoes.clear);
      root.removeEventListener('click', onClick);
      layoutResizeObserver?.disconnect();
      if (layoutResizeObserver === null && typeof window !== 'undefined')
        window.removeEventListener('resize', measureGameplayLayout);
      shell.removeScreen('gameplay');
    },
  };
}
