/** UI state uses fractions; the native range displays whole percentages. */
export interface MusicVolumeState {
  readonly volume: number;
  readonly muted: boolean;
  readonly lastAudibleVolume: number;
}

export interface MusicVolumeOptions {
  readonly musicVolume?: MusicVolumeState;
  readonly onMusicVolumeChange?: (state: MusicVolumeState) => void;
}

export interface MusicVolumeControl {
  setState(state: MusicVolumeState): void;
  destroy(): void;
}

const defaultState: MusicVolumeState = {
  volume: 1,
  muted: false,
  lastAudibleVolume: 1,
};
let nextControlId = 0;

/** A persistent DOM control: updates never replace the focused input/button. */
export function createMusicVolumeControl(
  host: HTMLElement,
  options: MusicVolumeOptions = {},
): MusicVolumeControl {
  const id = `music-volume-${++nextControlId}`;
  host.classList.add('music-volume-control');
  host.innerHTML = `
    <div class="music-volume-heading">
      <label for="${id}">Music volume</label>
      <output for="${id}" aria-live="off" data-music-percentage></output>
    </div>
    <div class="music-volume-inputs">
      <input id="${id}" type="range" min="0" max="100" step="1" aria-label="Music volume" />
      <button class="music-volume-mute" type="button" data-music-mute>Mute</button>
    </div>`;
  const range = host.querySelector<HTMLInputElement>('input')!;
  const output = host.querySelector<HTMLOutputElement>('output')!;
  const mute = host.querySelector<HTMLButtonElement>('[data-music-mute]')!;
  let current = options.musicVolume ?? defaultState;

  function setState(state: MusicVolumeState): void {
    current = { ...state };
    const percentage = String(Math.round(current.volume * 100));
    if (range.value !== percentage) range.value = percentage;
    const text = `${percentage}%`;
    if (output.textContent !== text) output.textContent = text;
    range.setAttribute(
      'aria-valuetext',
      current.muted ? `${text}, muted` : text,
    );
    const action = current.muted ? 'Unmute' : 'Mute';
    if (mute.textContent !== action) mute.textContent = action;
    mute.setAttribute('aria-label', `${action} music`);
  }

  function publish(state: MusicVolumeState): void {
    setState(state);
    options.onMusicVolumeChange?.({ ...current });
  }

  function onInput(): void {
    const volume = Number(range.value) / 100;
    publish({
      volume,
      muted: volume === 0,
      lastAudibleVolume: volume > 0 ? volume : current.lastAudibleVolume,
    });
  }

  function onMute(): void {
    if (current.muted || current.volume === 0) {
      const volume =
        current.lastAudibleVolume > 0 ? current.lastAudibleVolume : 1;
      publish({ volume, muted: false, lastAudibleVolume: volume });
    } else {
      publish({
        volume: 0,
        muted: true,
        lastAudibleVolume: current.volume,
      });
    }
  }

  range.addEventListener('input', onInput);
  mute.addEventListener('click', onMute);
  setState(current);

  return {
    setState,
    destroy() {
      range.removeEventListener('input', onInput);
      mute.removeEventListener('click', onMute);
    },
  };
}
