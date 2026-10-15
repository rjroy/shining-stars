export type ExperienceScreen = 'observatory' | 'gameplay';

export interface ExperienceShell {
  readonly surface: HTMLElement;
  readonly screens: HTMLElement;
  createScreen(name: ExperienceScreen, label: string): HTMLElement;
  activate(name: ExperienceScreen): void;
  removeScreen(name: ExperienceScreen): void;
}

const shells = new WeakMap<HTMLElement, ExperienceShell>();

/**
 * Create the long-lived scene host once. Individual UI screens can then be
 * replaced without detaching the canvas or invalidating projected CSS anchors.
 */
export function ensureExperienceShell(root: HTMLElement): ExperienceShell {
  const existing = shells.get(root);
  if (existing !== undefined) return existing;

  let experience = root.querySelector<HTMLElement>(':scope > .experience');
  if (experience === null) {
    experience = document.createElement('main');
    experience.className = 'experience';
    experience.setAttribute('aria-label', 'Brightvale Observatory');
    root.replaceChildren(experience);
  }

  let surface = experience.querySelector<HTMLElement>(
    ':scope > .play-surface[data-experience-surface]',
  );
  if (surface === null) {
    surface = document.createElement('section');
    surface.className = 'play-surface';
    surface.dataset.experienceSurface = 'true';
    surface.setAttribute('aria-label', 'Brightvale experience');
    experience.replaceChildren(surface);
  }

  if (!surface.querySelector(':scope > .scene-light')) {
    const light = document.createElement('div');
    light.className = 'scene-light';
    light.setAttribute('aria-hidden', 'true');
    surface.append(light);
  }

  if (!surface.querySelector(':scope > .scene-linework')) {
    const linework = document.createElement('div');
    linework.className = 'scene-linework';
    linework.setAttribute('aria-hidden', 'true');
    linework.innerHTML = `
      <svg viewBox="0 0 1200 150" preserveAspectRatio="none">
        <path d="M0 22 Q210 78 390 28 T780 35 T1200 18" />
        <path d="M0 42 Q210 98 390 48 T780 55 T1200 38" />
      </svg>`;

    surface.append(linework);
  }

  let screens = surface.querySelector<HTMLElement>(
    ':scope > .experience-screen-stack',
  );
  if (screens === null) {
    screens = document.createElement('div');
    screens.className = 'experience-screen-stack';
    surface.append(screens);
  }

  const shell: ExperienceShell = {
    surface,
    screens,
    createScreen(name, label) {
      let screen = screens.querySelector<HTMLElement>(
        `[data-experience-screen="${name}"]`,
      );
      if (screen === null) {
        screen = document.createElement('section');
        screen.className = `experience-screen ${name}-screen`;
        screen.dataset.experienceScreen = name;
        screen.hidden = true;
        screens.append(screen);
      }
      screen.setAttribute('aria-label', label);
      return screen;
    },
    activate(name) {
      for (const screen of screens.querySelectorAll<HTMLElement>(
        '[data-experience-screen]',
      )) {
        screen.hidden = screen.dataset.experienceScreen !== name;
      }
    },
    removeScreen(name) {
      screens
        .querySelector<HTMLElement>(`[data-experience-screen="${name}"]`)
        ?.remove();
    },
  };
  shells.set(root, shell);
  return shell;
}
