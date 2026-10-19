import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameUI, type GameUI } from './ui';
import type { SongCatalogEntry } from '../catalog/catalog';
import type { ChartConfig } from '../game/chart';
import { createGame } from '../game/game';
import type { ControllerSnapshot } from '../game/controller';

// No DOM package is installed. This small DOM double mounts the REAL UI and
// parses its REAL markup. It supplies events/capture bookkeeping, never input
// policy. Browser geometry, native capture and trusted touch remain untested.
class TestElement extends EventTarget {
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: TestElement[] = [];
  parentElement: TestElement | null = null;
  hidden = false;
  disabled = false;
  textContent = '';
  className = '';
  style: Record<string, unknown> & {
    setProperty(propertyName: string, value: string): void;
  } = {
    setProperty: (propertyName, value) => {
      this.style[propertyName] = value;
    },
  };
  captures = new Set<number>();
  handlers = new Map<string, Set<EventListenerOrEventListenerObject>>();
  classList = {
    add: (...names: string[]) => {
      this.className += ` ${names.join(' ')}`;
    },
    remove: (...names: string[]) => {
      this.className = this.className
        .split(' ')
        .filter((n) => !names.includes(n))
        .join(' ');
    },
    toggle: (name: string, force?: boolean) => {
      const add = force ?? !this.className.split(' ').includes(name);
      if (add) this.classList.add(name);
      else this.classList.remove(name);
      return add;
    },
  };
  set innerHTML(value: string) {
    this.children = [];
    for (const match of value.matchAll(/<[a-z][\w-]*\b([^>]*)>/gi)) {
      const element = new TestElement();
      for (const attribute of match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        element.setAttribute(attribute[1], attribute[2] ?? '');
      }
      this.append(element);
    }
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name.startsWith('data-'))
      this.dataset[
        name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
      ] = value;
    if (name === 'class') this.className = value;
    if (name === 'hidden') this.hidden = true;
    if (name === 'disabled') this.disabled = true;
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  matches(selector: string) {
    const attributes = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    if (attributes.length)
      return attributes.every(
        ([, name, value]) =>
          this.attributes.has(name) &&
          (value === undefined || this.attributes.get(name) === value),
      );
    if (selector.startsWith('.'))
      return this.className.split(' ').includes(selector.slice(1));
    return false;
  }
  closest(selector: string): TestElement | null {
    return this.matches(selector)
      ? this
      : (this.parentElement?.closest(selector) ?? null);
  }
  querySelectorAll(selector: string): TestElement[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  append(...elements: TestElement[]) {
    for (const element of elements) {
      element.parentElement = this;
      this.children.push(element);
    }
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter(
        (child) => child !== this,
      );
  }
  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    };
  }
  setPointerCapture(id: number) {
    this.captures.add(id);
  }
  hasPointerCapture(id: number) {
    return this.captures.has(id);
  }
  releasePointerCapture(id: number) {
    this.captures.delete(id);
  }
  override addEventListener(
    type: string,
    handler: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    super.addEventListener(type, handler, options);
    if (handler) {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set());
      this.handlers.get(type)!.add(handler);
    }
  }
  override removeEventListener(
    type: string,
    handler: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    super.removeEventListener(type, handler, options);
    if (handler) this.handlers.get(type)?.delete(handler);
  }
  bubble(event: Event) {
    for (const handler of this.handlers.get(event.type) ?? [])
      typeof handler === 'function'
        ? handler.call(this, event)
        : handler.handleEvent(event);
    if (event.bubbles) this.parentElement?.bubble(event);
  }
  override dispatchEvent(event: Event) {
    const result = super.dispatchEvent(event);
    if (event.bubbles) this.parentElement?.bubble(event);
    return result;
  }
}

const shellMock = vi.hoisted(() => ({
  root: null as unknown as TestElement,
  surface: null as unknown as TestElement,
}));
vi.mock('./experience-shell', () => ({
  ensureExperienceShell: () => ({
    surface: shellMock.surface,
    createScreen: () => shellMock.root,
    activate: vi.fn(),
    removeScreen: vi.fn(),
  }),
}));

type Presentation = {
  eligible: boolean;
  portrait: boolean;
  enabled: boolean;
  showGuard: boolean;
};
type TouchUI = GameUI & { setTouchPresentation(value: Presentation): void };
const active: Presentation = {
  eligible: true,
  portrait: true,
  enabled: true,
  showGuard: false,
};
const chart: ChartConfig = {
  sourceStart: 0,
  duration: 60,
  twilightAt: 30,
  allowedDifficulties: ['normal'],
  notes: [],
};
const song: SongCatalogEntry = {
  id: 'touch-fixture',
  title: 'Touch Fixture',
  sortOrder: 0,
  audioUrl: '/fixture.mp3',
  source: 'fixture.mp3',
  charts: { normal: chart },
  scoring: {
    version: 1,
    normalMaximum: 0,
    fiveGoldTarget: 0,
    chartFingerprint: 'fixture',
  },
  segmentKind: 'full',
  availability: 'available',
  chartStatus: 'candidate',
  collections: [],
};
let ui: TouchUI;
let actions: ReturnType<typeof makeActions>;
function makeActions() {
  return {
    start: vi.fn(),
    resume: vi.fn(),
    restart: vi.fn(),
    returnToBrowser: vi.fn(),
    onLaneDown: vi.fn(),
    onLaneUp: vi.fn(),
    onPause: vi.fn(),
    onOrientationBlocked: vi.fn(),
  };
}
function presentation(value: Presentation = active) {
  expect(
    ui.setTouchPresentation,
    'real GameUI accepts touch presentation',
  ).toBeTypeOf('function');
  ui.setTouchPresentation(value);
}
function pad(lane: number) {
  const target = shellMock.root.querySelector(`[data-touch-lane="${lane}"]`);
  expect(target, `production markup provides lane ${lane}`).not.toBeNull();
  return target!;
}
function pointer(
  target: TestElement,
  type: string,
  pointerId: number,
  extras: Record<string, unknown> = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId,
    pointerType: 'touch',
    button: 0,
    isPrimary: pointerId === 1,
    clientX: 0,
    clientY: 0,
    ...extras,
  });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  shellMock.root = new TestElement();
  shellMock.surface = new TestElement();
  const windowDouble = Object.assign(new EventTarget(), {
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
  });
  vi.stubGlobal('window', windowDouble);
  vi.stubGlobal('Element', TestElement);
  vi.stubGlobal('HTMLElement', TestElement);
  vi.stubGlobal('getComputedStyle', () => ({
    borderLeftWidth: '0',
    borderRightWidth: '0',
    borderTopWidth: '0',
    borderBottomWidth: '0',
    paddingLeft: '0',
    paddingRight: '0',
    paddingTop: '0',
    paddingBottom: '0',
  }));
  vi.stubGlobal('document', {
    createElement: () => new TestElement(),
    createElementNS: () => new TestElement(),
  });
  actions = makeActions();
  ui = createGameUI(
    new TestElement() as unknown as HTMLElement,
    song,
    chart,
    actions,
  ) as TouchUI;
});
afterEach(() => {
  ui?.destroy();
  vi.unstubAllGlobals();
});

describe('real gameplay UI thumb controls', () => {
  it('binds the core Radiant timestamp, attained state, null and run reset to the marker', () => {
    const initial = createGame(chart, 0, 'normal').snapshot();
    const renderTarget = (
      target: number | null,
      now: number,
      victory = false,
      runId = 1,
      transportTime = 40,
    ) => {
      ui.render(
        {
          runId,
          audio: {
            status: 'playing',
            position: transportTime,
            duration: 60,
            scheduledWhen: null,
            hasActiveSource: true,
            loaded: true,
            disposed: false,
            error: null,
          },
          game: {
            ...initial,
            phase: 'twilight',
            transportTime,
            radiantTarget: target,
            victory,
          },
          inputOffset: 0,
          visualOffset: 0,
          selectedDifficulty: 'normal',
          feedback: [],
          pendingPlaybackRequests: false,
        },
        now,
      );
    };
    const marker = shellMock.root.querySelector('[data-radiant-marker]');
    expect(marker).not.toBeNull();
    renderTarget(45, 0);
    expect(marker?.hidden).toBe(false);
    expect(marker?.style.left).toBe('75%');
    expect(marker?.getAttribute('aria-label')).toContain(
      'Radiant target with Perfect remaining notes',
    );
    renderTarget(54, 1);
    expect(marker?.style.left).toBe('75%');
    renderTarget(54, 1.25);
    expect(marker?.style.left).toBe('82.5%');
    renderTarget(42, 1.5, true);
    renderTarget(42, 2, true);
    expect(marker?.style.left).toBe('70%');
    expect(marker?.className).toContain('is-attained');
    expect(marker?.getAttribute('aria-label')).toContain(
      'Radiant reached: 42.00',
    );
    renderTarget(null, 3);
    expect(marker?.hidden).toBe(true);
    renderTarget(45, 4);
    expect(marker?.style.left).toBe('75%');
    renderTarget(30, 4.1, false, 2);
    expect(marker?.style.left).toBe('50%');
    // An unresolved nominal target can be behind progress. Only a changed
    // authoritative target or actual victory may change this presentation.
    renderTarget(30, 5, false, 2, 50);
    expect(marker?.style.left).toBe('50%');
    expect(marker?.className).not.toContain('is-attained');
    expect(shellMock.root.querySelector('[data-song-progress]')).toHaveProperty(
      'value',
      50,
    );
  });

  it('binds the progress palette to actual phase and victory, not elapsed time', () => {
    const initial = createGame(chart, 0, 'normal').snapshot();
    const renderPhase = (phase: typeof initial.phase, victory: boolean) => {
      ui.render(
        {
          audio: {
            status: 'playing',
            position: 45,
            duration: 60,
            scheduledWhen: null,
            hasActiveSource: true,
            loaded: true,
            disposed: false,
            error: null,
          },
          game: { ...initial, transportTime: 45, phase, victory },
          inputOffset: 0,
          visualOffset: 0,
          selectedDifficulty: 'normal',
          feedback: [],
          pendingPlaybackRequests: false,
        },
        45,
      );
    };
    for (const [phase, victory] of [
      ['audience', false],
      ['twilight', false],
      ['twilight', true],
      ['audience', false],
    ] as const) {
      renderPhase(phase, victory);
      const classes = shellMock.surface.className.split(' ');
      expect(classes.includes('is-twilight')).toBe(phase === 'twilight');
      expect(classes.includes('is-victory')).toBe(victory);
      expect(
        shellMock.root.querySelector('[data-song-progress]'),
      ).toHaveProperty('value', 45);
      expect(
        shellMock.root.querySelector('[data-song-progress-fill]')?.style
          .transform,
      ).toBe('scaleX(0.75)');
    }
  });

  it('binds the actual result summary to the frozen best combo, not final combo', () => {
    const summaryChart: ChartConfig = {
      sourceStart: 0,
      duration: 60,
      twilightAt: 59,
      allowedDifficulties: ['normal'],
      notes: [
        { id: 'hit-one', time: 1, lane: 0 },
        { id: 'hit-two', time: 2, lane: 0 },
        { id: 'hit-three', time: 3, lane: 0 },
        { id: 'late-miss', time: 50, lane: 0 },
      ],
    };
    const run = createGame(summaryChart, 0);
    run.press(0, 1);
    run.press(0, 2);
    run.press(0, 3);
    run.advanceTo(50.126);
    const completed = run.advanceTo(60);
    expect(completed).toMatchObject({
      combo: 0,
      bestCombo: 3,
      status: 'results',
    });

    ui.render(
      {
        audio: {
          status: 'results',
          position: 60,
          duration: 60,
          scheduledWhen: null,
          hasActiveSource: false,
          loaded: true,
          disposed: false,
          error: null,
        },
        game: completed,
        inputOffset: 0,
        visualOffset: 0,
        selectedDifficulty: 'normal',
        feedback: [],
        pendingPlaybackRequests: false,
      } as ControllerSnapshot,
      0,
    );

    expect(
      shellMock.root.querySelector('[data-result-score-combo]')?.textContent,
    ).toBe('3');
  });

  it('provides four ordered, labeled targets without changing keyboard actions', () => {
    const targets = shellMock.root.querySelectorAll('[data-touch-lane]');
    expect(targets.map((target) => target.dataset.touchLane)).toEqual([
      '0',
      '1',
      '2',
      '3',
    ]);
    targets.forEach((target, lane) =>
      expect(target.getAttribute('aria-label')).toMatch(
        new RegExp(`lane ${lane + 1}`, 'i'),
      ),
    );
    expect(actions.start).not.toHaveBeenCalled();
  });

  it('binds a pointer to its original lane, captures it, and never hits on move/click', () => {
    presentation();
    pointer(pad(0), 'pointerdown', 1);
    expect(pad(0).hasPointerCapture(1)).toBe(true);
    pointer(pad(3), 'pointermove', 1, { clientX: 390 });
    pad(0).dispatchEvent(new Event('click', { bubbles: true }));
    expect(actions.onLaneDown.mock.calls).toEqual([[0]]);
    pointer(pad(3), 'pointerup', 1);
    expect(actions.onLaneUp.mock.calls).toEqual([[0]]);
  });

  it('accepts simultaneous secondary touches on different lanes', () => {
    presentation();
    pointer(pad(0), 'pointerdown', 1);
    pointer(pad(2), 'pointerdown', 2, { isPrimary: false });
    expect(actions.onLaneDown.mock.calls).toEqual([[0], [2]]);
    pointer(pad(0), 'pointerup', 1);
    expect(actions.onLaneUp.mock.calls).toEqual([[0]]);
    pointer(pad(2), 'pointerup', 2);
    expect(actions.onLaneUp.mock.calls).toEqual([[0], [2]]);
  });

  it('reference-counts two pointers sharing a lane', () => {
    presentation();
    pointer(pad(1), 'pointerdown', 1);
    pointer(pad(1), 'pointerdown', 2);
    expect(actions.onLaneDown.mock.calls).toEqual([[1]]);
    pointer(pad(1), 'pointerup', 1);
    expect(actions.onLaneUp).not.toHaveBeenCalled();
    pointer(pad(1), 'pointerup', 2);
    expect(actions.onLaneUp.mock.calls).toEqual([[1]]);
  });

  it.each(['pointercancel', 'lostpointercapture'])(
    'releases once after %s, ignoring later up',
    (type) => {
      presentation();
      pointer(pad(2), 'pointerdown', 1);
      pointer(pad(2), type, 1);
      pointer(pad(2), 'pointerup', 1);
      expect(actions.onLaneUp.mock.calls).toEqual([[2]]);
    },
  );

  it('ignores non-primary mouse buttons without rejecting secondary touch', () => {
    presentation();
    pointer(pad(0), 'pointerdown', 1, { pointerType: 'mouse', button: 2 });
    pointer(pad(1), 'pointerdown', 2, { isPrimary: false });
    expect(actions.onLaneDown.mock.calls).toEqual([[1]]);
  });

  it('releases held lanes before requesting pause', () => {
    presentation();
    pointer(pad(0), 'pointerdown', 1);
    const pause = shellMock.root.querySelector('[data-action="pause"]');
    expect(pause, 'touch player has a visible Pause control').not.toBeNull();
    pause!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(actions.onLaneUp.mock.calls).toEqual([[0]]);
    expect(actions.onPause).toHaveBeenCalledOnce();
    expect(actions.onLaneUp.mock.invocationCallOrder[0]).toBeLessThan(
      actions.onPause.mock.invocationCallOrder[0],
    );
  });

  it('disables targets and releases held lanes when presentation is disabled', () => {
    presentation();
    pointer(pad(0), 'pointerdown', 1);
    pointer(pad(3), 'pointerdown', 2);
    presentation({ ...active, enabled: false });
    expect(actions.onLaneUp.mock.calls).toEqual([[0], [3]]);
    for (let lane = 0; lane < 4; lane++) expect(pad(lane).disabled).toBe(true);
    pointer(pad(1), 'pointerdown', 3);
    expect(actions.onLaneDown).toHaveBeenCalledTimes(2);
  });

  it('shows rotate guard, releases input once, and never resumes on portrait return', () => {
    presentation();
    pointer(pad(1), 'pointerdown', 1);
    const blocked = {
      eligible: true,
      portrait: false,
      enabled: false,
      showGuard: true,
    };
    presentation(blocked);
    presentation(blocked);
    const guard = shellMock.root.querySelector('[data-touch-guard]');
    expect(guard).not.toBeNull();
    expect(guard!.hidden).toBe(false);
    expect(actions.onLaneUp.mock.calls).toEqual([[1]]);
    expect(actions.onOrientationBlocked).toHaveBeenCalledOnce();
    presentation({ ...active, enabled: false });
    expect(guard!.hidden).toBe(true);
    expect(actions.resume).not.toHaveBeenCalled();
    pointer(pad(0), 'pointerdown', 2);
    expect(actions.onLaneDown.mock.calls).toEqual([[1]]);
  });

  it('disposal releases every held lane and removes pointer handlers', () => {
    presentation();
    pointer(pad(0), 'pointerdown', 1);
    pointer(pad(2), 'pointerdown', 2);
    ui.destroy();
    expect(actions.onLaneUp.mock.calls).toEqual([[0], [2]]);
    pointer(pad(3), 'pointerdown', 3);
    expect(actions.onLaneDown.mock.calls).toEqual([[0], [2]]);
  });
});
