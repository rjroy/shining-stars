import type { ChartConfig } from './chart';
import type { ControllerSnapshot } from './controller';
import type { GameSnapshot } from './game';
import { projectNotes, projectTimingWindowGeometry } from './note-projection';
import {
  defaultDifficulty,
  getDifficultyProfile,
  type Difficulty,
} from './game-balance';

export interface UIActions {
  readonly start: () => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly restart: () => void;
  readonly selectDifficulty: (difficulty: Difficulty) => void;
}

export interface GameUI {
  render(snapshot: ControllerSnapshot, audioNow: number): void;
  setBusy(message: string | null): void;
  setSceneFallback(message: string | null): void;
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

const VISIBLE_NOTE_SECONDS = 2.4;

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
  if (element !== null) element.textContent = value;
}

export function createGameUI(
  root: HTMLElement,
  chart: ChartConfig,
  actions: UIActions,
): GameUI {
  const initialDifficulty = defaultDifficulty(chart.allowedDifficulties);
  root.innerHTML = `
    <main class="experience" aria-label="Brightvale rhythm performance">
      <header class="masthead">
        <span class="wordmark">BRIGHTVALE</span>
        <span class="masthead-note">A song for the city</span>
      </header>
      <section class="play-surface" aria-label="Rhythm performance">
        <div class="scene-light" aria-hidden="true"></div>
        <div class="scene-linework" aria-hidden="true">
          <svg viewBox="0 0 1200 150" preserveAspectRatio="none">
            <path d="M0 22 Q210 78 390 28 T780 35 T1200 18" />
            <path d="M0 42 Q210 98 390 48 T780 55 T1200 38" />
          </svg>
        </div>
        <div class="play-heading">
          <div>
            <p class="mode-label" data-mode-label>Audience performance</p>
            <h1 data-title>Sing with Brightvale</h1>
          </div>
          <div class="resource-readout" aria-live="polite" aria-atomic="true">
            <span class="resource-name" data-resource-name>Renown</span>
            <strong data-resource-value>0</strong>
            <div class="twilight-resources" data-twilight-resources hidden>
              <span><span class="resource-name">Personal Strength</span> <strong data-personal-strength>0</strong></span>
              <span><span class="resource-name">Twilight Strength</span> <strong data-twilight-strength>0</strong></span>
            </div>
          </div>
          <div class="difficulty-control">
            <label class="resource-name" for="difficulty">Next run difficulty</label>
            <select id="difficulty" data-difficulty-select aria-describedby="difficulty-help">
              ${chart.allowedDifficulties
                .map(
                  (difficulty) =>
                    `<option value="${difficulty}"${difficulty === initialDifficulty ? ' selected' : ''}>${difficultyLabel(difficulty)}</option>`,
                )
                .join('')}
            </select>
            <span class="difficulty-help" id="difficulty-help">Applies to the next run.</span>
            <details class="difficulty-details">
              <summary>Difficulty rules</summary>
              <p data-difficulty-rules id="difficulty-rules"></p>
            </details>
          </div>
        </div>
        <p class="scene-fallback" data-scene-fallback role="status" hidden></p>

        <div class="stage-frame">
          <div class="stage-topline">
            <span data-track-state>Onset-derived chart · play-test timing</span>
            <span class="stage-time" data-time>00:00</span>
          </div>
          <div class="lane-board" aria-label="Four rhythm lanes">
            <div class="lane" data-lane="0" aria-label="D lane"><span class="lane-key">D</span><div class="note-track"></div><span class="hit-pad"></span></div>
            <div class="lane" data-lane="1" aria-label="F lane"><span class="lane-key">F</span><div class="note-track"></div><span class="hit-pad"></span></div>
            <div class="lane" data-lane="2" aria-label="J lane"><span class="lane-key">J</span><div class="note-track"></div><span class="hit-pad"></span></div>
            <div class="lane" data-lane="3" aria-label="K lane"><span class="lane-key">K</span><div class="note-track"></div><span class="hit-pad"></span></div>
            <div class="hit-line" aria-hidden="true"><span>HIT</span></div>
          </div>
          <p class="timing-window-legend" data-timing-legend hidden></p>
          <div class="feedback-row" aria-live="polite">
            <span data-feedback>Notes meet the line here</span>
            <span data-countdown aria-hidden="true"></span>
          </div>
          <div class="performance-controls">
            <p>Press <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd> as notes reach the line</p>
            <button class="text-button pause-button" type="button" data-action="pause" hidden>Pause <kbd>Esc</kbd></button>
          </div>
        </div>

        <div class="cityline" aria-hidden="true">
          <span class="city-wire"></span><span class="city-buildings"></span><span class="city-wind"></span>
        </div>

        <section class="dialog-panel ready-panel" data-panel="ready" aria-labelledby="ready-title">
          <p class="dialog-overline">The First Shining Star · provisional excerpt</p>
          <h2 id="ready-title">Your voice leads. Brightvale answers.</h2>
          <p>Hit <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd> when notes reach the line. At Twilight, your Renown becomes Personal Strength; the enemy begins with ${chart.twilightStrength} Twilight Strength. A missed note is not surrender. Notes follow aubio-detected onsets. Detector timing and the excerpt still need play-testing.</p>
          <p class="chart-notice">Aubio onset chart · density configured per song</p>
          <button class="primary-button" type="button" data-action="start">Begin performance <span aria-hidden="true">↗</span></button>
          <p class="loading-message" data-busy hidden></p>
          <p class="error-message" data-error role="alert" hidden></p>
        </section>

        <section class="dialog-panel pause-panel" data-panel="pause" aria-labelledby="pause-title" hidden>
          <p class="dialog-overline">The song is held</p>
          <h2 id="pause-title">Take your time.</h2>
          <p>Your place in the song is saved. The chart will wait through a short count-in.</p>
          <div class="dialog-actions"><button class="primary-button" type="button" data-action="resume">Resume <span aria-hidden="true">↗</span></button><button class="secondary-button" type="button" data-action="restart">Start over</button></div>
        </section>

        <section class="dialog-panel result-panel" data-panel="results" aria-labelledby="result-title" hidden>
          <p class="dialog-overline">The song has settled</p>
          <h2 id="result-title" data-result-title>Brightvale heard you.</h2>
          <p class="result-boundary">A missed note is not surrender.</p>
          <div class="result-grid" data-result-grid></div>
          <button class="primary-button" type="button" data-action="restart">Sing again <span aria-hidden="true">↗</span></button>
        </section>

        <section class="dialog-panel error-panel" data-panel="error" aria-labelledby="error-title" hidden>
          <p class="dialog-overline">Audio could not begin</p>
          <h2 id="error-title">The song is not ready.</h2>
          <p data-audio-error role="alert">Check the selected track and try again.</p>
          <button class="primary-button" type="button" data-action="start">Retry loading <span aria-hidden="true">↗</span></button>
        </section>
      </section>
      <footer class="experience-footer"><span>One lead performer. A city that joins in.</span><span>Original mixed recording · visual accompaniment only</span></footer>
    </main>`;

  const laneTracks = [...root.querySelectorAll<HTMLElement>('.note-track')];
  const laneBoard = root.querySelector<HTMLElement>('.lane-board');
  const panels = [...root.querySelectorAll<HTMLElement>('[data-panel]')];
  let busyMessage: string | null = null;
  let fatalMessage: string | null = null;
  let hasAttemptedStart = false;
  let lastFeedbackId = '';
  let feedbackTime: number | null = null;
  let runwayTravelPx = (laneBoard?.clientHeight ?? 0) * 0.64;
  const measureRunway = () => {
    runwayTravelPx = (laneBoard?.clientHeight ?? 0) * 0.64;
  };
  const runwayResizeObserver =
    laneBoard !== null && typeof ResizeObserver === 'function'
      ? new ResizeObserver(measureRunway)
      : null;
  if (laneBoard !== null) {
    if (runwayResizeObserver !== null) runwayResizeObserver.observe(laneBoard);
    else window.addEventListener('resize', measureRunway);
  }

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('[data-action]');
    if (button === null || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'start') actions.start();
    else if (action === 'pause') actions.pause();
    else if (action === 'resume') actions.resume();
    else if (action === 'restart') actions.restart();
  }

  function onChange(event: Event): void {
    const target = event.target;
    if (
      !(target instanceof HTMLSelectElement) ||
      !target.matches('[data-difficulty-select]')
    )
      return;
    if (target.disabled) return;
    actions.selectDifficulty(target.value as Difficulty);
  }

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);

  function showPanel(name: string | null): void {
    for (const panel of panels) {
      panel.hidden = panel.dataset.panel !== name;
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
    const isError = audio.status === 'error' || fatalMessage !== null;
    const isResults = game.status === 'results';
    const isPaused =
      audio.status === 'paused' && hasAttemptedStart && !isError && !isResults;
    const isReady =
      (!hasAttemptedStart || busyMessage !== null) && !isError && !isResults;
    const isStarting = audio.status === 'starting';
    const isPlaying = audio.status === 'playing' && game.status === 'playing';
    const difficultySelect = root.querySelector<HTMLSelectElement>(
      '[data-difficulty-select]',
    );
    const nextDifficulty = snapshot.selectedDifficulty;
    const activeDifficulty =
      isPlaying || isStarting || isResults ? game.difficulty : nextDifficulty;
    if (difficultySelect !== null) {
      difficultySelect.value = nextDifficulty;
      difficultySelect.disabled =
        busyMessage !== null ||
        isStarting ||
        isPlaying ||
        isPaused ||
        (audio.status === 'loading' && hasAttemptedStart) ||
        audio.status === 'error';
    }
    setText(
      root,
      '[data-difficulty-rules]',
      profileSummary(getDifficultyProfile(activeDifficulty)),
    );

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
    for (const actionButton of root.querySelectorAll<HTMLButtonElement>(
      '[data-action]',
    )) {
      actionButton.disabled = busyMessage !== null;
    }
    const busy = root.querySelector<HTMLElement>('[data-busy]');
    if (busy !== null) {
      busy.hidden = busyMessage === null;
      busy.textContent = busyMessage ?? '';
    }
    const error = root.querySelector<HTMLElement>('[data-error]');
    if (error !== null) {
      error.hidden = fatalMessage === null;
      error.textContent = fatalMessage ?? '';
    }
    setText(
      root,
      '[data-audio-error]',
      busyMessage ??
        fatalMessage ??
        audio.error ??
        'Check the selected track and try again.',
    );

    root
      .querySelector('.play-surface')
      ?.classList.toggle('is-twilight', game.phase === 'twilight');
    setText(
      root,
      '[data-mode-label]',
      game.phase === 'audience'
        ? 'Audience performance'
        : 'Twilight · the city answers',
    );
    setText(
      root,
      '[data-title]',
      game.phase === 'audience'
        ? 'Sing with Brightvale'
        : 'The city sings with you',
    );
    setText(
      root,
      '[data-resource-name]',
      game.phase === 'audience' ? 'Renown' : 'Twilight combat',
    );
    setText(root, '[data-resource-value]', String(game.renown));
    const twilightResources = root.querySelector<HTMLElement>(
      '[data-twilight-resources]',
    );
    if (twilightResources !== null)
      twilightResources.hidden = game.phase !== 'twilight';
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

    const feedback = root.querySelector<HTMLElement>('[data-feedback]');
    if (feedback !== null) {
      if (
        snapshot.feedback !== null &&
        snapshot.feedback.noteId !== lastFeedbackId
      ) {
        lastFeedbackId = snapshot.feedback.noteId;
        feedbackTime = game.transportTime;
        feedback.textContent =
          snapshot.feedback.quality === 'perfect' ? 'Perfect' : 'Good';
        feedback.dataset.quality = snapshot.feedback.quality;
      } else if (
        (snapshot.feedback === null ||
          (feedbackTime !== null &&
            game.transportTime > feedbackTime + 0.65)) &&
        isPlaying
      ) {
        feedback.textContent = 'Notes meet the line here';
        delete feedback.dataset.quality;
      }
    }

    const countdown = root.querySelector<HTMLElement>('[data-countdown]');
    if (countdown !== null) {
      const remaining =
        audio.scheduledWhen === null ? 2 : audio.scheduledWhen - audioNow;
      countdown.textContent = isStarting
        ? `Starting in ${Math.max(1, Math.ceil(remaining))}`
        : '';
      countdown.setAttribute('aria-hidden', String(!isStarting));
    }
    const pauseButton = root.querySelector<HTMLElement>(
      '[data-action="pause"]',
    );
    if (pauseButton !== null) pauseButton.hidden = !isPlaying && !isStarting;

    const showTimingWindows = isPlaying || isStarting;
    const timingLegend = root.querySelector<HTMLElement>(
      '[data-timing-legend]',
    );
    if (timingLegend !== null) {
      timingLegend.hidden = !showTimingWindows;
      const profile = getDifficultyProfile(game.difficulty);
      const toMilliseconds = (seconds: number) => Math.round(seconds * 1000);
      timingLegend.textContent =
        `Good ±${toMilliseconds(profile.timing.goodWindowSeconds)} ms · ` +
        `Perfect ±${toMilliseconds(profile.timing.perfectWindowSeconds)} ms` +
        ' — centered on the hit line; notes stop there.';
    }
    const timingWindows = projectTimingWindowGeometry(
      game.difficulty,
      runwayTravelPx,
      VISIBLE_NOTE_SECONDS,
    );
    const projected = showTimingWindows
      ? projectNotes(
          game.notes,
          chart.notes,
          game.transportTime,
          VISIBLE_NOTE_SECONDS,
          { difficulty: game.difficulty, runwayTravelPx },
        )
      : [];
    const byLane = [0, 1, 2, 3].map((lane) =>
      projected.filter((note) => note.lane === lane),
    );
    laneTracks.forEach((track, lane) => {
      track.innerHTML = `${
        showTimingWindows
          ? `<span class="timing-target" aria-hidden="true"><span class="timing-target-good" data-timing-target style="--good-half-height:${timingWindows.goodHalfHeightPx.toFixed(2)}px;--good-band-height:${timingWindows.goodEnvelopeHeightPx.toFixed(2)}px"><span class="timing-target-perfect" style="--perfect-half-height:${timingWindows.perfectHalfHeightPx.toFixed(2)}px;--perfect-band-height:${timingWindows.perfectEnvelopeHeightPx.toFixed(2)}px"></span></span></span>`
          : ''
      }${
        byLane[lane]
          ?.map(
            (note) =>
              `<span class="note-envelope" data-timing-envelope data-note-id="${note.id}" style="--note-bottom:${note.bottomPercent.toFixed(2)}%;--good-envelope-height:${note.timingWindows?.goodEnvelopeHeightPx.toFixed(2) ?? '0'}px;--perfect-envelope-height:${note.timingWindows?.perfectEnvelopeHeightPx.toFixed(2) ?? '0'}px"><span class="note-envelope-perfect"></span></span><span class="note" data-note-id="${note.id}" style="--note-bottom:${note.bottomPercent.toFixed(2)}%"></span>`,
          )
          .join('') ?? ''
      }`;
    });

    if (isResults) renderResults(game);
  }

  return {
    render,
    setBusy(message) {
      hasAttemptedStart = message !== null || hasAttemptedStart;
      busyMessage = message;
    },
    setSceneFallback(message) {
      const status = root.querySelector<HTMLElement>('[data-scene-fallback]');
      if (status === null) return;
      status.textContent = message ?? '';
      status.hidden = message === null;
    },
    showFatal(message) {
      fatalMessage = message;
      setText(root, '[data-audio-error]', message);
      showPanel('error');
    },
    destroy() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      runwayResizeObserver?.disconnect();
      if (runwayResizeObserver === null)
        window.removeEventListener('resize', measureRunway);
      root.replaceChildren();
    },
  };
}
