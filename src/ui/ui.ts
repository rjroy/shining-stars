import type { ChartConfig } from '../game/chart';
import type { ControllerSnapshot } from '../game/controller';
import type { GameSnapshot } from '../game/game';
import { getDifficultyProfile, type Difficulty } from '../game/game-balance';
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

export interface UIActions {
  readonly start: () => void;
  readonly resume: () => void;
  readonly restart: () => void;
  readonly onRendererRetry?: () => void;
}

export interface GameUI {
  render(snapshot: ControllerSnapshot, audioNow: number): void;
  setBusy(message: string | null): void;
  setRendererStatus(status: BrightvaleRendererStatus, message?: string): void;
  getGameplayLayout(): BrightvaleViewportLayout;
  showFatal(message: string): void;
  destroy(): void;
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

export function createGameUI(
  applicationRoot: HTMLElement,
  chart: ChartConfig,
  actions: UIActions,
): GameUI {
  const shell = ensureExperienceShell(applicationRoot);
  const root = shell.createScreen('gameplay', 'Rhythm performance');
  root.innerHTML = `
      <div class="gameplay-screen-content" aria-describedby="lane-instructions">
        <div class="play-heading">
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
            <p class="mode-label" data-mode-label>Audience performance</p>
            <h1 data-title>Sing with Brightvale</h1>
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
          <p class="timing-window-legend" data-timing-legend aria-hidden="true"></p>
          <div class="countdown-row" aria-hidden="true"><span data-countdown></span></div>
          <span class="sr-only" id="lane-instructions">Use the D, F, J, and K keys shown on the four lane fronts to hit notes at the line. Escape pauses the performance.</span>
        </div>

        <section class="dialog-panel ready-panel" data-panel="ready" aria-labelledby="ready-title">
          <p class="dialog-overline">The First Shining Star · provisional excerpt</p>
          <h2 id="ready-title">Your voice leads. Brightvale answers.</h2>
          <p>Follow the notes to the line. At Twilight, your Renown becomes Personal Strength; the enemy begins with ${chart.twilightStrength} Twilight Strength. A missed note is not surrender. Notes follow aubio-detected onsets. Detector timing and the excerpt still need play-testing.</p>
          <p class="chart-notice">Aubio onset chart · density configured per song</p>
        <button class="primary-button" type="button" data-action="start" disabled>Begin performance <span aria-hidden="true">↗</span></button>
          <p class="loading-message" data-busy hidden></p>
          <p class="error-message" data-error role="alert" hidden></p>
        </section>

        <section class="dialog-panel pause-panel" data-panel="pause" aria-labelledby="pause-title" hidden>
          <p class="dialog-overline">The song is held</p>
          <h2 id="pause-title">Take your time.</h2>
          <p>Your place in the song is saved. The chart will wait through a short count-in.</p>
          <div class="dialog-actions"><button class="primary-button" type="button" data-action="resume" disabled>Resume <span aria-hidden="true">↗</span></button><button class="secondary-button" type="button" data-action="restart" disabled>Start over</button></div>
        </section>

        <section class="dialog-panel result-panel" data-panel="results" aria-labelledby="result-title" hidden>
          <p class="dialog-overline">The song has settled</p>
          <h2 id="result-title" data-result-title>Brightvale heard you.</h2>
          <p class="result-boundary">A missed note is not surrender.</p>
          <div class="result-grid" data-result-grid></div>
          <button class="primary-button" type="button" data-action="restart" disabled>Sing again <span aria-hidden="true">↗</span></button>
        </section>

        <section class="dialog-panel error-panel" data-panel="error" aria-labelledby="error-title" hidden>
          <p class="dialog-overline">Audio could not begin</p>
          <h2 id="error-title">The song is not ready.</h2>
          <p data-audio-error role="alert">Check the selected track and try again.</p>
          <button class="primary-button" type="button" data-action="start" disabled>Retry loading <span aria-hidden="true">↗</span></button>
        </section>
        <span class="sr-only" data-gameplay-status role="status" aria-live="polite" aria-atomic="true"></span>
      </div>`;

  shell.activate('gameplay');
  const playSurface = shell.surface;
  const playHeading = root.querySelector<HTMLElement>('.play-heading');
  const stageHeader = root.querySelector<HTMLElement>('.stage-topline');
  const timingLegend = root.querySelector<HTMLElement>('[data-timing-legend]');
  const timeSlot = root.querySelector<HTMLElement>('[data-time]');
  const countdownSlot = root.querySelector<HTMLElement>('[data-countdown]');
  const panels = [...root.querySelectorAll<HTMLElement>('[data-panel]')];
  const actionButtons = [
    ...root.querySelectorAll<HTMLButtonElement>('[data-action]'),
  ];
  let busyMessage: string | null = null;
  let fatalMessage: string | null = null;
  let rendererStatus: BrightvaleRendererStatus = 'loading';
  let rendererMessage = 'Loading Brightvale…';
  let pendingPlaybackRequests = false;
  let resultsRendered = false;
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
          rect: readRect(element),
        }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0),
      labels: {
        time: readRect(timeSlot),
        countdown: readRect(countdownSlot),
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
    countdownSlot,
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
      pendingPlaybackRequests &&
      ['start', 'resume', 'restart'].includes(action ?? '')
    )
      return;
    if (action === 'start') actions.start();
    else if (action === 'resume') actions.resume();
    else if (action === 'restart') actions.restart();
    else if (action === 'renderer-retry') actions.onRendererRetry?.();
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
    const isReady =
      !isPaused && !isPlaying && !isStarting && !isError && !isResults;
    playSurface?.setAttribute('aria-busy', String(pendingPlaybackRequests));
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
        action === 'renderer-retry'
          ? rendererStatus !== 'unavailable' ||
            actions.onRendererRetry === undefined
          : pendingPlaybackRequests ||
            rendererStatus !== 'rendered' ||
            busyMessage !== null;
      if (actionButton.disabled !== disabled) actionButton.disabled = disabled;
    }
    const rendererStatusNode = root.querySelector<HTMLElement>(
      '[data-renderer-status]',
    );
    if (rendererStatusNode !== null) {
      const activePanel = panels.find((panel) => !panel.hidden);
      const statusContainer =
        rendererStatus !== 'rendered' && activePanel !== undefined
          ? activePanel
          : playSurface;
      if (
        statusContainer != null &&
        rendererStatusNode.parentElement !== statusContainer
      )
        statusContainer.append(rendererStatusNode);
    }
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

    const countdown = root.querySelector<HTMLElement>('[data-countdown]');
    if (countdown !== null) {
      const remaining =
        audio.scheduledWhen === null ? 2 : audio.scheduledWhen - audioNow;
      setElementText(
        countdown,
        isStarting ? `Starting in ${Math.max(1, Math.ceil(remaining))}` : '',
      );
      const ariaHidden = String(!isStarting);
      if (countdown.getAttribute('aria-hidden') !== ariaHidden)
        countdown.setAttribute('aria-hidden', ariaHidden);
    }
    const timingLegend = root.querySelector<HTMLElement>(
      '[data-timing-legend]',
    );
    if (timingLegend !== null) {
      const profile = getDifficultyProfile(game.difficulty);
      const toMilliseconds = (seconds: number) => Math.round(seconds * 1000);
      setElementText(
        timingLegend,
        `Good ±${toMilliseconds(profile.timing.goodWindowSeconds)} ms · ` +
          `Perfect ±${toMilliseconds(profile.timing.perfectWindowSeconds)} ms` +
          ' — centered on the hit line; unresolved notes continue past it.',
      );
    }
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

    if (isResults) {
      if (!resultsRendered) renderResults(game);
      resultsRendered = true;
    } else {
      resultsRendered = false;
    }
    measureGameplayLayout();
  }

  return {
    render,
    setBusy(message) {
      busyMessage = message;
    },
    setRendererStatus(status, message) {
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
    getGameplayLayout() {
      return gameplayLayout;
    },
    showFatal(message) {
      fatalMessage = message;
      setText(root, '[data-audio-error]', message);
      showPanel('error');
    },
    destroy() {
      root.removeEventListener('click', onClick);
      layoutResizeObserver?.disconnect();
      if (layoutResizeObserver === null && typeof window !== 'undefined')
        window.removeEventListener('resize', measureGameplayLayout);
      shell.removeScreen('gameplay');
    },
  };
}
