import { defaultDifficulty, type Difficulty } from '../game/game-balance';
import { formatPersonalBestScore } from './personal-best-copy';
import {
  getSongChart,
  getSongDifficulties,
  type SongCatalog,
  type SongCatalogEntry,
} from '../catalog/catalog';
import {
  canStartSong,
  reconcileSongSelection,
  selectSongs,
  type SongBrowseFilters,
  type SongBrowseProgress,
  type SongSelection,
  type SongSortMode,
} from '../catalog/selectors';
import type { FavoriteStore } from '../catalog/favorites';
import type { SaveStore } from '../app/save-data';
import { createProgressionMembership } from '../catalog/progression-catalog';
import type {
  ProgressionMembership,
  ProgressionState,
  ProgressionPurchaseRequest,
} from '../catalog/progression';
import { createUnlockDialog } from './unlock-dialog';
import { createSaveDataDialog } from './save-data-dialog';
import type { SongRating } from '../catalog/song-ratings';
import { ensureExperienceShell } from './experience-shell';
import type { BrightvaleRendererStatus } from '../rendering/brightvale/viewport';
import {
  createBrowsePreferenceStore,
  type BrowsePreferenceStorage,
} from '../catalog/browse-preferences';

export interface ObservatoryPlayRequest {
  readonly songId: string;
  readonly difficulty: Difficulty;
}

export type ObservatoryPlayStatus = 'idle' | 'preparing' | 'error';

export interface ObservatoryUIActions {
  readonly onPlay: (request: ObservatoryPlayRequest) => void;
  readonly onRendererRetry?: () => void;
}

export interface ObservatoryUIOptions {
  readonly saveStore?: SaveStore;
  readonly getSongRating?: (songId: string) => SongRating | null;
  readonly getRatingNotice?: () => string | null;
  readonly browsePreferenceStorage?: BrowsePreferenceStorage | null;
}

/** Keep each independent local-storage warning visible without replacing it. */
export function getObservatoryStorageNotice(
  favoriteNotice: string | null,
  ratingNotice: string | null,
): string | null {
  const notices = [favoriteNotice, ratingNotice].filter(
    (notice): notice is string => notice !== null && notice !== '',
  );
  return notices.length > 0 ? [...new Set(notices)].join(' ') : null;
}

export interface ObservatorySelectionSnapshot {
  readonly screen: 'overview' | 'browser';
  readonly collectionId: string | null;
  readonly filters: SongBrowseFilters;
  readonly selection: SongSelection;
}

export interface ObservatoryUI {
  refreshSavedData(): void;
  getSelectionSnapshot(): ObservatorySelectionSnapshot;
  getViewportSize(): { readonly width: number; readonly height: number };
  setRendererStatus(status: BrightvaleRendererStatus, message?: string): void;
  setPlayStatus(status: ObservatoryPlayStatus, message?: string): void;
  focusSelectedSong(): void;
  destroy(): void;
}

/** Pure selection transition used when a song row is activated. */
export function chooseObservatorySong(
  catalog: SongCatalog,
  selection: SongSelection,
  songId: string,
): SongSelection | null {
  const song = catalog.songs.find((entry) => entry.id === songId);
  if (song === undefined || song.availability !== 'available') return null;
  const supportedDifficulties = getSongDifficulties(song);
  return {
    selectedSongId: song.id,
    runDifficulty:
      selection.runDifficulty !== null &&
      supportedDifficulties.includes(selection.runDifficulty)
        ? selection.runDifficulty
        : supportedDifficulties.length === 0
          ? null
          : defaultDifficulty(supportedDifficulties),
  };
}

export function getObservatoryBrowserTitle(
  catalog: SongCatalog,
  filters: SongBrowseFilters,
  favoritesOnly: boolean,
): string {
  if (filters.collectionId !== undefined)
    return (
      catalog.collections.find((item) => item.id === filters.collectionId)
        ?.title ?? 'All Songs'
    );
  return favoritesOnly ? 'Favorites' : 'All Songs';
}

/** Format playable chart time to the nearest whole second. */
export function formatSongDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function browseChart(song: SongCatalogEntry) {
  return getSongChart(song, defaultDifficulty(getSongDifficulties(song)));
}

/** Static menu presentation only: targets come from generated metadata. */
export function getObservatorySongPresentation(
  song: SongCatalogEntry,
  rating: SongRating | null,
) {
  const normal = rating?.normalStars ?? 0;
  const gold = rating?.goldStars ?? 0;
  const path = 'M50 5 63 34 95 38 71 60 78 93 50 76 22 93 29 60 5 38 37 34Z';
  const starsMarkup = `<span class="song-rating-stars" role="img" aria-label="Normal stars: ${normal} of 5; Gold stars: ${gold} of 5.">${Array.from(
    { length: 5 },
    (_, index) =>
      `<svg data-rating-slot="${index}" data-rating-normal="${index < normal}" data-rating-gold="${index < gold}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path class="song-rating-empty" d="${path}"/>${index < normal ? `<path class="song-rating-normal" d="${path}"/>` : ''}${index < gold ? `<path class="song-rating-gold" d="${path}"/>` : ''}</svg>`,
  ).join('')}</span>`;
  const hasTarget = song.scoring.fiveGoldTarget !== null;
  return {
    durationText: formatSongDuration(browseChart(song).duration),
    bestText:
      rating === null ? 'Not played' : `${normal} normal · ${gold} gold`,
    starsMarkup,
    fiveGoldTargetText: hasTarget
      ? song.scoring.fiveGoldTarget!.toLocaleString('en-US')
      : 'Not available',
    targetBasisText: hasTarget
      ? '90% of the Normal maximum · Same for every difficulty'
      : 'No Normal chart',
  };
}

const escapeKey = 'Escape';

export function getSongUnlockRequest(
  songId: string,
  state: ProgressionState,
  membership: ProgressionMembership,
): ProgressionPurchaseRequest | null {
  const parent = membership.songs.get(songId);
  if (parent === undefined || membership.collections.get(parent) === null)
    return null;
  if (!Object.hasOwn(state.collectionPurchases, parent))
    return { kind: 'collection', collectionId: parent };
  return Object.hasOwn(state.songPurchases, songId)
    ? null
    : { kind: 'song', songId };
}

export function getCreditedSealsMarkup(mark?: Difficulty): string {
  const tiers = ['easy', 'normal', 'hard'] as const;
  const level = mark === undefined ? -1 : tiers.indexOf(mark);
  return `<span class="credited-seals" aria-label="Credited victories">${tiers.map((tier, index) => `<span class="credited-seal${index <= level ? ' is-credited' : ''}" aria-label="${tier[0]!.toUpperCase() + tier.slice(1)}: ${index <= level ? 'credited' : 'not credited'}" title="${tier}: ${index <= level ? 'credited' : 'not credited'}">${tier[0]!.toUpperCase()}</span>`).join('')}</span>`;
}

function createSvgIcon(
  name: 'heart' | 'search' | 'filter' | 'sort' | 'back',
): string {
  const paths = {
    heart:
      '<path d="M20.8 8.8c0 5.1-8.8 10-8.8 10s-8.8-4.9-8.8-10A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.7Z"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 4.4 4.4"/>',
    filter:
      '<path d="M3 6h18M6 12h12m-9 6h6"/><circle cx="8" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="18" r="2"/>',
    back: '<path d="m14.5 5-7 7 7 7"/>',
    sort: '<path d="M4 5v14m-3-3 3 3 3-3M11 6h10M11 12h7M11 18h4"/>',
  } satisfies Record<string, string>;
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function starGlyph(index: number, className = ''): string {
  const turn = (index % 5) * 12;
  return `<svg class="song-glyph ${className}" aria-hidden="true" viewBox="0 0 64 64" fill="none">
    <circle class="song-glyph-orbit" cx="32" cy="32" r="22" transform="rotate(${turn} 32 32)"/>
    <path class="song-glyph-star" d="M32 9 36.8 26.8 55 32l-18.2 5.2L32 55l-4.8-17.8L9 32l18.2-5.2L32 9Z"/>
    <circle class="song-glyph-core" cx="32" cy="32" r="3.2"/>
  </svg>`;
}

function normalizeDifficulty(value: string): Difficulty | null {
  return value === 'easy' || value === 'normal' || value === 'hard'
    ? value
    : null;
}

function createButton(
  text: string,
  action: string,
  className: string,
  icon?: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.action = action;
  if (icon !== undefined) button.innerHTML = icon;
  const label = document.createElement('span');
  label.textContent = text;
  button.append(label);
  return button;
}

function appendOptions(
  select: HTMLSelectElement,
  choices: readonly { readonly value: string; readonly label: string }[],
): void {
  for (const choice of choices) {
    const option = document.createElement('option');
    option.value = choice.value;
    option.textContent = choice.label;
    select.append(option);
  }
}

/**
 * Mounts the accessible DOM selector into the shared, persistent experience
 * shell. Three.js owns its atmosphere; all controls and selection state stay
 * in this DOM surface.
 */
export function createObservatoryUI(
  applicationRoot: HTMLElement,
  catalog: SongCatalog,
  actions: ObservatoryUIActions,
  favoriteStore: FavoriteStore,
  options: ObservatoryUIOptions = {},
): ObservatoryUI {
  const shell = ensureExperienceShell(applicationRoot);
  const root = shell.createScreen('observatory', 'Observatory song selection');
  root.innerHTML = `
    <div class="observatory-app">
      <header class="observatory-topbar">
        <div class="observatory-wordmark">
          <span class="wordmark-seal" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="18"/><path d="M24 5v38M5 24h38M11 11l26 26M37 11 11 37"/><path d="m24 12 3.2 8.8L36 24l-8.8 3.2L24 36l-3.2-8.8L12 24l8.8-3.2L24 12Z"/></svg></span>
          <span class="wordmark-copy"><strong>Shining Stars</strong><small>Observatory</small></span>
        </div>
        <div class="observatory-save-utility"><span class="observatory-credits" data-credits></span>
        <button class="observatory-save-entry" type="button" data-action="save-data">Save data</button></div>
        <nav class="observatory-tools" aria-label="Song navigation">
          <button class="observatory-nav-button is-active" type="button" data-action="all-songs">All Songs</button>
          <label class="observatory-search">
            ${createSvgIcon('search')}
            <span class="sr-only">Search songs</span>
            <input type="search" data-search placeholder="Search songs" autocomplete="off" />
          </label>
          <button class="observatory-tool-button" type="button" data-action="favorites" aria-pressed="false">${createSvgIcon('heart')}<span>Favorites</span></button>
          <button class="observatory-tool-button" type="button" data-action="toggle-filters" aria-expanded="false" aria-controls="observatory-filters">${createSvgIcon('filter')}<span>Filters</span></button>
          <button class="observatory-tool-button" type="button" data-action="toggle-sort" aria-label="Sort songs" aria-expanded="false" aria-controls="observatory-sort">${createSvgIcon('sort')}<span>Sort</span></button>
        </nav>
      </header>

      <div class="observatory-feedback" data-renderer-notice role="status" aria-live="polite" hidden>
        <span data-renderer-copy></span>
        <button class="observatory-retry" type="button" data-action="renderer-retry" hidden>Retry the Observatory</button>
      </div>
      <p class="observatory-storage-notice" data-storage-notice role="status" hidden></p>

      <div class="observatory-pages">
      <section class="observatory-overview" data-observatory-page="overview" aria-labelledby="observatory-title">
        <div class="overview-copy">
          <p class="observatory-kicker">A song can change tomorrow</p>
          <h1 id="observatory-title">Choose your constellation.</h1>
          <p class="overview-lede">Find your next performance, then carry its song into the city.</p>
        </div>
        <div class="overview-layout">
        <section class="collection-library" aria-labelledby="collection-library-title">
          <div class="collection-library-heading"><h2 id="collection-library-title">Song collections</h2><span data-collection-total></span></div>
          <div class="collection-grid" data-collection-grid role="group" aria-label="Song collections"></div>
        </section>
        <aside class="collection-detail" aria-labelledby="collection-title">
          <div class="detail-emblem" aria-hidden="true">
            <svg viewBox="0 0 220 220" fill="none"><circle cx="110" cy="110" r="85"/><circle cx="110" cy="110" r="71"/><path d="M110 25v170M25 110h170M50 50l120 120M170 50 50 170"/><path d="m110 52 12 44 44 14-44 13-12 45-13-45-44-13 44-14 13-44Z"/><circle cx="110" cy="110" r="5"/><circle cx="72" cy="76" r="3"/><circle cx="151" cy="69" r="3"/><circle cx="155" cy="151" r="3"/><circle cx="64" cy="148" r="3"/></svg>
          </div>
          <p class="detail-kicker">Selected constellation</p>
          <h2 id="collection-title" data-collection-title>All Songs</h2>
          <p class="collection-count" data-collection-count>7 songs</p>
          <p class="collection-story">Songs in the current collection.</p>
          <button class="observatory-gold-button browse-collection-button" type="button" data-action="browse-collection">Browse Collection <span aria-hidden="true">→</span></button>
        </aside>
        </div>
        <div class="overview-shortcuts" aria-label="Quick song routes">
          <button type="button" data-action="overview-all">Open All Songs</button>
          <span aria-hidden="true">✦</span>
          <button type="button" data-action="overview-favorites">Browse Favorites</button>
        </div>
      </section>

      <section class="observatory-browser" data-observatory-page="browser" aria-labelledby="browser-title" hidden>
        <div class="browser-heading">
          <button class="back-to-overview" type="button" data-action="back-overview" aria-label="Back to constellation overview">${createSvgIcon('back')}<span>Constellations</span></button>
          <span class="breadcrumb-divider" aria-hidden="true">/</span>
          <span class="browser-breadcrumb" data-breadcrumb>All Songs</span>
          <div class="browser-title-block">
            <p class="observatory-kicker">Songs for a brighter tomorrow</p>
            <h1 id="browser-title" data-browser-title>All Songs</h1>
            <p data-browser-count>7 performances</p>
          </div>
        </div>
        <div class="browser-layout">
          <section class="song-list-panel" aria-label="Songs">
            <div class="song-list-heading"><span>Choose a song</span><span data-result-count></span></div>
            <div class="song-list" data-song-list role="list" aria-label="Song list"></div>
          </section>
          <aside class="song-detail-panel" aria-label="Selected song details" aria-live="polite" aria-atomic="true" data-song-detail></aside>
        </div>
      </section>

      </div>
      <section class="observatory-filter-panel" id="observatory-filters" data-filter-panel aria-label="Filter songs" hidden>
        <div class="filter-heading"><h2>Refine your search</h2><button type="button" data-action="clear-filters">Clear filters</button></div>
         <fieldset class="song-progress-filters">
           <legend>Progress</legend>
            <label>Unlock status<select data-filter-unlock-status><option value="all">All songs</option><option value="unlocked">Unlocked</option><option value="locked">Locked</option></select></label>
           <label class="song-filter-check"><input type="checkbox" data-filter-unplayed>Show Unplayed</label>
           <label>Undefeated on difficulty<select data-filter-undefeated><option value="">None</option><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option></select></label>
           <label class="song-filter-check"><input type="checkbox" data-filter-normal-stars>Less than 5 normal stars</label>
           <label class="song-filter-check"><input type="checkbox" data-filter-gold-stars>Less than 5 golden stars</label>
         </fieldset>
         <p class="song-filter-help">All selected filters apply together. Stars use your best result across difficulties.</p>
      </section>

      <section class="observatory-filter-panel" id="observatory-sort" data-sort-panel aria-label="Sort songs" hidden>
        <div class="filter-heading"><h2>Sort songs</h2></div>
        <label>Order<select data-song-sort><option value="unsorted">Unsorted</option><option value="alphabetical">Alphabetical</option><option value="length">Length</option><option value="difficulty">Difficulty</option></select></label>
        <p class="song-filter-help">A–Z, shortest first, or lowest difficulty first. Difficulty is the five-gold target per playable second.</p>
      </section>
      <div class="observatory-play-status" data-play-status role="status" aria-live="polite" hidden></div>
    </div>`;

  shell.activate('observatory');

  const searchInput = root.querySelector<HTMLInputElement>('[data-search]')!;
  const overview = root.querySelector<HTMLElement>(
    '[data-observatory-page="overview"]',
  )!;
  const browser = root.querySelector<HTMLElement>(
    '[data-observatory-page="browser"]',
  )!;
  const filterPanel = root.querySelector<HTMLElement>('[data-filter-panel]')!;
  const collectionGrid = root.querySelector<HTMLElement>(
    '[data-collection-grid]',
  )!;
  const list = root.querySelector<HTMLElement>('[data-song-list]')!;
  const detail = root.querySelector<HTMLElement>('[data-song-detail]')!;
  let selectedCollectionId = catalog.collections[0]?.id ?? null;
  const currentCollection = () =>
    catalog.collections.find((item) => item.id === selectedCollectionId) ??
    null;
  const initialSong =
    catalog.songs.find((song) => song.availability === 'available') ?? null;
  const initialDifficulties =
    initialSong === null ? [] : getSongDifficulties(initialSong);
  const selection: SongSelection =
    initialSong === null
      ? { selectedSongId: null, runDifficulty: null }
      : {
          selectedSongId: initialSong.id,
          runDifficulty:
            initialDifficulties.length === 0
              ? null
              : defaultDifficulty(initialDifficulties),
        };
  let currentSelection = selection;
  let screen: 'overview' | 'browser' = 'overview';
  let filters: SongBrowseFilters = {};
  let favoritesOnly = false;
  let filtersOpen = false;
  let sortOpen = false;
  let sortMode: SongSortMode = 'unsorted';
  const browsePreferences = createBrowsePreferenceStore(
    options.browsePreferenceStorage,
  );
  const savedBrowsePreferences = browsePreferences.read();
  filters = { ...savedBrowsePreferences.filters };
  favoritesOnly = savedBrowsePreferences.favoritesOnly;
  sortMode = savedBrowsePreferences.sortMode;
  let rendererStatus: BrightvaleRendererStatus = 'loading';
  let rendererMessage = 'The Observatory is lighting its stars…';
  let playStatus: ObservatoryPlayStatus = 'idle';
  let playMessage = '';
  let overviewScrollTop = 0;
  let collectionScrollTop = 0;
  let overviewReturnFocus: HTMLElement | null = null;
  let disposed = false;
  const membership =
    options.saveStore === undefined
      ? null
      : createProgressionMembership(catalog);
  const unlockRequest = (songId: string) =>
    options.saveStore === undefined || membership === null
      ? null
      : getSongUnlockRequest(
          songId,
          options.saveStore.progression.snapshot(),
          membership,
        );
  const unlockDialog =
    options.saveStore === undefined
      ? null
      : createUnlockDialog(root, options.saveStore, refreshSavedData);
  function openUnlock(request: ProgressionPurchaseRequest) {
    if (membership === null) return;
    const collection =
      request.kind === 'collection'
        ? catalog.collections.find((item) => item.id === request.collectionId)
        : null;
    const title =
      request.kind === 'collection'
        ? collection?.title
        : catalog.songs.find((song) => song.id === request.songId)?.title;
    const cost =
      request.kind === 'collection'
        ? membership.collections.get(request.collectionId)
        : (membership.songPrice ?? 1);
    if (cost === null || cost === undefined) return;
    unlockDialog?.open(request, title ?? 'Selection', cost);
  }
  const saveDialog =
    options.saveStore === undefined
      ? null
      : createSaveDataDialog(
          root,
          options.saveStore,
          new Set(catalog.songs.map((song) => song.id)),
          refreshSavedData,
        );
  const saveEntry = root.querySelector<HTMLButtonElement>(
    '[data-action="save-data"]',
  )!;
  saveEntry.hidden = saveDialog === null;
  const collectionButtons = new Map<string, HTMLButtonElement>();

  function currentSong() {
    return (
      catalog.songs.find(
        (song) => song.id === currentSelection.selectedSongId,
      ) ?? null
    );
  }

  function snapshot(): ObservatorySelectionSnapshot {
    return {
      screen,
      collectionId: filters.collectionId ?? null,
      filters: { ...filters, favoritesOnly },
      selection: { ...currentSelection },
    };
  }

  function setNotice(selector: string, text: string, visible: boolean): void {
    const node = root.querySelector<HTMLElement>(selector);
    if (node === null) return;
    node.textContent = text;
    node.hidden = !visible;
  }

  function syncStorageNotice(): void {
    const notice = getObservatoryStorageNotice(
      favoriteStore.snapshot().notice,
      options.getRatingNotice?.() ?? null,
    );
    setNotice('[data-storage-notice]', notice ?? '', notice !== null);
  }

  function syncFilterControls(): void {
    root.querySelector<HTMLSelectElement>('[data-song-sort]')!.value = sortMode;
    root
      .querySelector('[data-action="toggle-sort"]')!
      .setAttribute('aria-expanded', String(sortOpen));
    root.querySelector<HTMLElement>('[data-sort-panel]')!.hidden = !sortOpen;
    root.querySelector<HTMLSelectElement>(
      '[data-filter-unlock-status]',
    )!.value = filters.unlockStatus ?? 'all';
    root.querySelector<HTMLSelectElement>('[data-filter-undefeated]')!.value =
      filters.undefeatedDifficulty ?? '';
    for (const [selector, checked] of [
      ['[data-filter-unplayed]', filters.unplayedOnly],
      ['[data-filter-normal-stars]', filters.belowFiveNormalStars],
      ['[data-filter-gold-stars]', filters.belowFiveGoldStars],
    ] as const)
      root.querySelector<HTMLInputElement>(selector)!.checked =
        checked ?? false;
    const favoritesButton = root.querySelector<HTMLButtonElement>(
      '[data-action="favorites"]',
    );
    favoritesButton?.setAttribute('aria-pressed', String(favoritesOnly));
    const filterButton = root.querySelector<HTMLButtonElement>(
      '[data-action="toggle-filters"]',
    );
    filterButton?.setAttribute('aria-expanded', String(filtersOpen));
    filterPanel.hidden = !filtersOpen;
  }

  function browseProgress(): SongBrowseProgress {
    const state = options.saveStore?.progression.snapshot();
    return {
      getRating:
        options.getSongRating ??
        ((id) => options.saveStore?.songRatings.get(id) ?? null),
      isUnlocked: (id) =>
        state === undefined ||
        membership === null ||
        getSongUnlockRequest(id, state, membership) === null,
      getVictoryDifficulty: (id) => state?.victoryMarks[id],
    };
  }

  function reconcile(): void {
    currentSelection = reconcileSongSelection(
      catalog,
      { ...filters, favoritesOnly },
      currentSelection,
      favoriteStore.snapshot().ids,
      browseProgress(),
      sortMode,
    );
  }

  function persistBrowsePreferences(): void {
    const {
      query: _query,
      collectionId: _collectionId,
      favoritesOnly: _favoritesOnly,
      ...persistentFilters
    } = filters;
    browsePreferences.write({
      filters: persistentFilters,
      sortMode,
      favoritesOnly,
    });
  }

  function renderCollections(): void {
    root.querySelector<HTMLElement>('[data-collection-total]')!.textContent =
      `${catalog.collections.length} ${catalog.collections.length === 1 ? 'constellation' : 'constellations'}`;
    const collectionIds = new Set(catalog.collections.map((item) => item.id));
    for (const [collectionId, button] of collectionButtons) {
      if (collectionIds.has(collectionId)) continue;
      button.remove();
      collectionButtons.delete(collectionId);
    }
    for (const item of catalog.collections) {
      let button = collectionButtons.get(item.id);
      if (button === undefined) {
        button = createButton(
          item.title,
          'select-collection',
          'constellation-hotspot',
          `<span class="constellation-art" aria-hidden="true">${starGlyph(0)}</span>`,
        );
        button.lastElementChild!.classList.add('constellation-label');
        collectionButtons.set(item.id, button);
        collectionGrid.append(button);
      }
      let artwork = button.querySelector<HTMLImageElement>(
        'img[data-collection-artwork]',
      );
      if (item.artworkUrl !== undefined) {
        button.classList.add('has-artwork');
        if (artwork === null) {
          artwork = document.createElement('img');
          artwork.dataset.collectionArtwork = '';
          artwork.alt = '';
          artwork.setAttribute('aria-hidden', 'true');
          artwork.decoding = 'async';
          artwork.draggable = false;
          button.querySelector('.constellation-art')!.prepend(artwork);
        }
        if (artwork.dataset.artworkUrl !== item.artworkUrl) {
          artwork.src = item.artworkUrl;
          artwork.dataset.artworkUrl = item.artworkUrl;
        }
      } else {
        button.classList.remove('has-artwork');
        artwork?.remove();
      }
      button.dataset.collectionId = item.id;
      button.dataset.artworkUrl = item.artworkUrl ?? '';
      button.setAttribute(
        'aria-pressed',
        String(item.id === selectedCollectionId),
      );
      button.setAttribute('aria-label', `Select ${item.title} constellation`);
    }
  }

  function renderRows(): void {
    const scrollTop = list.scrollTop;
    const results = selectSongs(
      catalog,
      { ...filters, favoritesOnly },
      favoriteStore.snapshot().ids,
      browseProgress(),
      sortMode,
    );
    root.querySelector<HTMLElement>('[data-result-count]')!.textContent =
      `${results.length} ${results.length === 1 ? 'song' : 'songs'}`;
    root.querySelector<HTMLElement>('[data-browser-count]')!.textContent =
      `${results.length} ${results.length === 1 ? 'performance' : 'performances'}`;
    const fragment = document.createDocumentFragment();
    results.forEach((song, index) => {
      const presentation = getObservatorySongPresentation(
        song,
        options.getSongRating?.(song.id) ?? null,
      );
      const row = document.createElement('div');
      row.className = `song-row${song.id === currentSelection.selectedSongId ? ' is-selected' : ''}`;
      row.setAttribute('role', 'listitem');
      row.setAttribute('aria-label', song.title);
      row.dataset.songId = song.id;
      const select = createButton(
        '',
        'select-song',
        'song-row-main',
        starGlyph(index),
      );
      select.dataset.songId = song.id;
      select.setAttribute(
        'aria-pressed',
        String(song.id === currentSelection.selectedSongId),
      );
      const text = document.createElement('span');
      text.className = 'song-row-copy';
      const title = document.createElement('strong');
      title.textContent = song.title;
      const status = document.createElement('small');
      status.textContent =
        song.segmentKind === 'excerpt'
          ? `Demo excerpt · play-test chart · ${presentation.durationText}`
          : `Play-test chart · ${presentation.durationText}`;
      const locked = unlockRequest(song.id);
      if (locked !== null)
        status.textContent = `Locked · ${locked.kind === 'collection' ? 'Unlock collection first' : 'Unlock song · 1 credit'} · ${presentation.durationText}`;
      const best = document.createElement('span');
      best.className = 'song-row-rating';
      best.dataset.songBest = song.id;
      best.innerHTML = presentation.starsMarkup;
      const bestCopy = document.createElement('span');
      bestCopy.textContent = presentation.bestText;
      best.append(bestCopy);
      text.append(title, status, best);
      if (options.saveStore !== undefined) {
        const seals = document.createElement('span');
        seals.innerHTML = getCreditedSealsMarkup(
          options.saveStore.progression.snapshot().victoryMarks[song.id],
        );
        best.append(seals);
      }
      select.append(text);
      const favorite = createButton(
        favoriteStore.isFavorite(song.id)
          ? 'Remove from Favorites'
          : 'Add to Favorites',
        'toggle-favorite',
        `song-favorite${favoriteStore.isFavorite(song.id) ? ' is-favorite' : ''}`,
        createSvgIcon('heart'),
      );
      favorite.dataset.songId = song.id;
      const favoriteLabel = favorite.querySelector('span');
      favoriteLabel?.classList.add('sr-only');
      favorite.setAttribute(
        'aria-pressed',
        String(favoriteStore.isFavorite(song.id)),
      );
      row.append(select, favorite);
      fragment.append(row);
    });
    list.replaceChildren(fragment);
    list.scrollTop = scrollTop;
    if (results.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'song-list-empty';
      empty.textContent =
        selectSongs(catalog, { collectionId: filters.collectionId }).length ===
        0
          ? filters.collectionId === undefined
            ? 'No songs are available yet. Check back later.'
            : 'No songs are available in this collection yet. Try All Songs or another collection.'
          : 'No songs match these filters. Clear a filter or try another search.';
      list.append(empty);
    }
  }

  function renderDetail(): void {
    const song = currentSong();
    detail.replaceChildren();
    if (song === null) {
      const empty = document.createElement('div');
      empty.className = 'song-detail-empty';
      empty.innerHTML = `${starGlyph(0, 'detail-empty-glyph')}<h2>Choose a song</h2><p>Your next performance will appear here.</p>`;
      detail.append(empty);
      return;
    }
    const presentation = getObservatorySongPresentation(
      song,
      options.getSongRating?.(song.id) ?? null,
    );
    const heading = document.createElement('div');
    heading.className = 'song-detail-heading';
    const art = document.createElement('div');
    art.className = 'song-detail-emblem';
    art.innerHTML = starGlyph(
      catalog.songs.findIndex((entry) => entry.id === song.id),
    );
    const title = document.createElement('h2');
    title.textContent = song.title;
    const eyebrow = document.createElement('p');
    eyebrow.className = 'detail-kicker';
    eyebrow.textContent =
      song.segmentKind === 'excerpt' ? 'Demo excerpt' : 'Full track';
    const duration = document.createElement('p');
    duration.className = 'song-detail-duration';
    duration.textContent = `${presentation.durationText} playable`;
    heading.append(art, eyebrow, title, duration);

    const status = document.createElement('p');
    status.className = `song-chart-status${song.availability === 'unavailable' ? ' is-unavailable' : ''}`;
    status.textContent =
      song.availability === 'unavailable'
        ? 'This song is currently unavailable.'
        : song.chartStatus === 'candidate'
          ? 'Play-test chart · still being refined'
          : 'Chart verified';

    const achievement = document.createElement('section');
    achievement.className = 'song-achievement';
    achievement.dataset.songAchievement = song.id;
    achievement.setAttribute('aria-label', 'Personal best and target');
    const bestLabel = document.createElement('p');
    bestLabel.className = 'song-achievement-label';
    bestLabel.textContent = 'Personal best';
    const bestStars = document.createElement('div');
    bestStars.innerHTML = presentation.starsMarkup;
    const bestCopy = document.createElement('p');
    bestCopy.className = 'song-best-copy';
    bestCopy.textContent = presentation.bestText;
    const target = document.createElement('p');
    target.className = 'song-target';
    const targetLabel = document.createElement('span');
    targetLabel.textContent = 'Five-gold target';
    const targetValue = document.createElement('strong');
    targetValue.dataset.fiveGoldTarget = '';
    targetValue.textContent = presentation.fiveGoldTargetText;
    target.append(targetLabel, targetValue);
    const basis = document.createElement('p');
    basis.className = 'song-target-basis';
    basis.textContent = presentation.targetBasisText;
    achievement.append(bestLabel, bestStars, bestCopy, target, basis);
    if (options.saveStore !== undefined) {
      const seals = document.createElement('div');
      seals.className = 'song-credited-victories';
      seals.innerHTML = `<span>Credited victories</span>${getCreditedSealsMarkup(options.saveStore.progression.snapshot().victoryMarks[song.id])}`;
      achievement.append(seals);
    }

    const difficultyLabel = document.createElement('label');
    difficultyLabel.className = 'song-difficulty-label';
    difficultyLabel.textContent = 'Difficulty';
    const difficulty = document.createElement('select');
    difficulty.className = 'song-difficulty-select';
    difficulty.dataset.runDifficulty = 'true';
    difficulty.setAttribute('aria-label', `Difficulty for ${song.title}`);
    appendOptions(
      difficulty,
      getSongDifficulties(song).map((value) => ({
        value,
        label: value[0]!.toUpperCase() + value.slice(1),
      })),
    );
    difficulty.value = currentSelection.runDifficulty ?? '';
    difficulty.disabled = getSongDifficulties(song).length < 2;
    difficultyLabel.append(difficulty);
    const bestScore = document.createElement('span');
    bestScore.className = 'song-best-score';
    bestScore.dataset.personalBestScore = '';
    if (currentSelection.runDifficulty !== null) {
      bestScore.textContent = formatPersonalBestScore(
        currentSelection.runDifficulty,
        options.saveStore?.personalBestScores.getBest(
          song.id,
          currentSelection.runDifficulty,
        ) ?? null,
      );
    }
    difficultyLabel.append(bestScore);

    const play = createButton(
      'Play',
      'play',
      'observatory-gold-button song-play-button',
      '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5 3.5 16 10 5 16.5z" fill="currentColor"/></svg>',
    );
    const rendererReady = rendererStatus === 'rendered';
    const locked = unlockRequest(song.id);
    const valid = canStartSong(catalog, song, currentSelection.runDifficulty);
    play.disabled = !valid || !rendererReady || playStatus === 'preparing';
    if (locked !== null) {
      play.dataset.action = 'unlock';
      play.replaceChildren(
        document.createTextNode(
          locked.kind === 'collection' ? 'Unlock collection…' : 'Unlock song…',
        ),
      );
      play.disabled =
        song.availability === 'unavailable' || playStatus === 'preparing';
    }
    const reason =
      song.availability === 'unavailable'
        ? 'This song is unavailable.'
        : !valid
          ? 'Choose a supported difficulty to continue.'
          : !rendererReady
            ? rendererMessage
            : playStatus === 'preparing'
              ? 'Preparing this performance…'
              : '';
    play.setAttribute('aria-describedby', 'song-play-help');
    const help = document.createElement('p');
    help.id = 'song-play-help';
    help.className = 'song-play-help';
    help.textContent = playStatus === 'error' ? playMessage : reason;
    if (locked !== null && song.availability !== 'unavailable')
      help.textContent =
        locked.kind === 'collection'
          ? `Collection: ${membership?.collections.get(locked.collectionId) ?? 0} credits first; then 1 credit per song. Browsing and favorites stay available.`
          : 'Unlock for 1 credit. You can choose Play afterward.';
    detail.append(heading, status, achievement, difficultyLabel, play, help);
  }

  function render(): void {
    const progress = options.saveStore?.progression.snapshot();
    setNotice(
      '[data-credits]',
      progress === undefined
        ? ''
        : `${progress.balance} credits${progress.persistence === 'session' ? ' · session only' : ''}`,
      progress !== undefined,
    );
    overview.hidden = screen !== 'overview';
    browser.hidden = screen !== 'browser';
    const browserTitle = getObservatoryBrowserTitle(
      catalog,
      filters,
      favoritesOnly,
    );
    root.querySelector<HTMLElement>('[data-browser-title]')!.textContent =
      browserTitle;
    root.querySelector<HTMLElement>('[data-breadcrumb]')!.textContent =
      browserTitle;
    const allSongsButton = root.querySelector<HTMLButtonElement>(
      '[data-action="all-songs"]',
    );
    const isAllSongsRoute =
      !favoritesOnly &&
      (screen === 'overview' || filters.collectionId === undefined);
    allSongsButton?.classList.toggle('is-active', isAllSongsRoute);
    if (isAllSongsRoute) allSongsButton?.setAttribute('aria-current', 'page');
    else allSongsButton?.removeAttribute('aria-current');
    root.querySelector<HTMLElement>('[data-collection-title]')!.textContent =
      currentCollection()?.title ?? 'All Songs';
    const collectionEmblem = root.querySelector<HTMLElement>('.detail-emblem')!;
    const collection = currentCollection();
    collectionEmblem.dataset.collectionId = collection?.id ?? '';
    let detailArtwork = collectionEmblem.querySelector<HTMLImageElement>(
      'img[data-collection-artwork]',
    );
    if (collection?.artworkUrl !== undefined) {
      collectionEmblem.classList.add('has-artwork');
      if (detailArtwork === null) {
        detailArtwork = document.createElement('img');
        detailArtwork.dataset.collectionArtwork = '';
        detailArtwork.alt = '';
        detailArtwork.setAttribute('aria-hidden', 'true');
        detailArtwork.decoding = 'async';
        detailArtwork.draggable = false;
        collectionEmblem.append(detailArtwork);
      }
      if (detailArtwork.dataset.artworkUrl !== collection.artworkUrl) {
        detailArtwork.src = collection.artworkUrl;
        detailArtwork.dataset.artworkUrl = collection.artworkUrl;
      }
    } else {
      collectionEmblem.classList.remove('has-artwork');
      detailArtwork?.remove();
    }
    const collectionSongCount = selectSongs(catalog, {
      collectionId: collection?.id,
    }).length;
    const collectionCountText = `${collectionSongCount} ${collectionSongCount === 1 ? 'song' : 'songs'}`;
    root.querySelector<HTMLElement>('[data-collection-count]')!.textContent =
      collectionCountText;
    root.querySelector<HTMLElement>('.collection-story')!.textContent =
      `${collectionCountText} in the current collection.`;
    if (collection !== null && membership !== null && progress !== undefined) {
      const price = membership.collections.get(collection.id);
      if (
        price !== null &&
        price !== undefined &&
        !Object.hasOwn(progress.collectionPurchases, collection.id)
      ) {
        root.querySelector<HTMLElement>('.collection-story')!.textContent =
          `Locked collection · ${price} credits. Browse every song before unlocking. Songs cost 1 credit each after the collection unlock.`;
      }
    }
    syncFilterControls();
    renderCollections();
    renderRows();
    renderDetail();
    syncStorageNotice();
    setNotice(
      '[data-play-status]',
      playMessage,
      playStatus === 'preparing' || playStatus === 'error',
    );
  }

  function refreshSavedData(): void {
    reconcile();
    render();
  }

  function rememberOverview(opener: HTMLElement | null): void {
    if (screen !== 'overview') return;
    overviewScrollTop = overview.scrollTop;
    collectionScrollTop = collectionGrid.scrollTop;
    overviewReturnFocus = opener;
  }

  function returnToOverview(): void {
    screen = 'overview';
    render();
    overview.scrollTop = overviewScrollTop;
    collectionGrid.scrollTop = collectionScrollTop;
    const opener = overviewReturnFocus?.isConnected
      ? overviewReturnFocus
      : root.querySelector<HTMLButtonElement>(
          '[data-action="browse-collection"]',
        );
    opener?.focus({ preventScroll: true });
    // Resizing while browsing can move the opener into the short-window flow.
    opener?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function openBrowser(
    collectionId?: string,
    focusSearch = true,
    opener: HTMLElement | null = null,
  ): void {
    rememberOverview(opener);
    filters = { ...filters, collectionId };
    screen = 'browser';
    reconcile();
    render();
    if (focusSearch) searchInput.focus();
  }

  function selectSong(songId: string): void {
    const next = chooseObservatorySong(catalog, currentSelection, songId);
    if (next === null) return;
    currentSelection = next;
    playStatus = 'idle';
    playMessage = '';
    render();
    root
      .querySelector<HTMLButtonElement>(
        `button[data-action="select-song"][data-song-id="${songId}"]`,
      )
      ?.focus();
  }

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'save-data') {
      saveDialog?.open();
    } else if (action === 'all-songs' || action === 'overview-all') {
      favoritesOnly = false;
      persistBrowsePreferences();
      openBrowser(undefined, true, button);
    } else if (action === 'browse-collection') {
      openBrowser(selectedCollectionId ?? undefined, false, button);
      root
        .querySelector<HTMLButtonElement>('[data-action="back-overview"]')
        ?.focus();
    } else if (action === 'back-overview') {
      returnToOverview();
    } else if (action === 'select-collection') {
      const id = button.dataset.collectionId;
      if (
        id !== undefined &&
        catalog.collections.some((item) => item.id === id)
      ) {
        selectedCollectionId = id;
        filters = { ...filters, collectionId: id };
        render();
        [
          ...root.querySelectorAll<HTMLButtonElement>(
            'button[data-action="select-collection"]',
          ),
        ]
          .find((item) => item.dataset.collectionId === id)
          ?.focus();
      }
    } else if (action === 'favorites') {
      rememberOverview(button);
      favoritesOnly = !favoritesOnly;
      persistBrowsePreferences();
      screen = 'browser';
      reconcile();
      render();
    } else if (action === 'overview-favorites') {
      favoritesOnly = true;
      persistBrowsePreferences();
      openBrowser(undefined, true, button);
    } else if (action === 'toggle-favorite') {
      const songId = button.dataset.songId;
      if (songId !== undefined) {
        favoriteStore.toggle(songId);
        reconcile();
        render();
        [
          ...root.querySelectorAll<HTMLButtonElement>(
            'button[data-action="toggle-favorite"]',
          ),
        ]
          .find((item) => item.dataset.songId === songId)
          ?.focus();
      }
    } else if (action === 'select-song') {
      const songId = button.dataset.songId;
      if (songId !== undefined) selectSong(songId);
    } else if (action === 'toggle-filters') {
      filtersOpen = !filtersOpen;
      sortOpen = false;
      syncFilterControls();
    } else if (action === 'toggle-sort') {
      sortOpen = !sortOpen;
      filtersOpen = false;
      syncFilterControls();
    } else if (action === 'clear-filters') {
      filters = { collectionId: filters.collectionId };
      favoritesOnly = false;
      persistBrowsePreferences();
      searchInput.value = '';
      reconcile();
      render();
      searchInput.focus();
    } else if (action === 'play') {
      const song = currentSong();
      if (
        !canStartSong(catalog, song, currentSelection.runDifficulty) ||
        song === null ||
        unlockRequest(song.id) !== null ||
        rendererStatus !== 'rendered'
      )
        return;
      playStatus = 'preparing';
      playMessage = 'Preparing this performance…';
      render();
      actions.onPlay({
        songId: song.id,
        difficulty: currentSelection.runDifficulty!,
      });
    } else if (action === 'unlock') {
      const song = currentSong();
      const request = song === null ? null : unlockRequest(song.id);
      if (request !== null) openUnlock(request);
    } else if (action === 'renderer-retry') {
      actions.onRendererRetry?.();
    }
  }

  function onInput(event: Event): void {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) ||
      target.dataset.search === undefined
    )
      return;
    filters = { ...filters, query: target.value };
    if (target.value.length > 0 && screen === 'overview') {
      rememberOverview(target);
      screen = 'browser';
    }
    reconcile();
    render();
    const nextInput = root.querySelector<HTMLInputElement>('[data-search]');
    nextInput?.focus();
    nextInput?.setSelectionRange(target.selectionStart, target.selectionEnd);
  }

  function onChange(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      const key = target.hasAttribute('data-filter-unplayed')
        ? 'unplayedOnly'
        : target.hasAttribute('data-filter-normal-stars')
          ? 'belowFiveNormalStars'
          : target.hasAttribute('data-filter-gold-stars')
            ? 'belowFiveGoldStars'
            : null;
      if (key === null) return;
      filters = { ...filters, [key]: target.checked };
      persistBrowsePreferences();
      reconcile();
      render();
      return;
    }
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.dataset.songSort !== undefined) {
      const value = target.value;
      sortMode =
        value === 'alphabetical' || value === 'length' || value === 'difficulty'
          ? value
          : 'unsorted';
      persistBrowsePreferences();
    } else if (target.dataset.filterUnlockStatus !== undefined) {
      filters = {
        ...filters,
        unlockStatus:
          target.value === 'locked' || target.value === 'unlocked'
            ? target.value
            : 'all',
      };
      persistBrowsePreferences();
    } else if (target.dataset.filterUndefeated !== undefined) {
      filters = {
        ...filters,
        undefeatedDifficulty: normalizeDifficulty(target.value) ?? undefined,
      };
      persistBrowsePreferences();
    } else if (target.dataset.runDifficulty !== undefined) {
      const difficulty = normalizeDifficulty(target.value);
      if (
        difficulty !== null &&
        currentSong() !== null &&
        getSongDifficulties(currentSong()!).includes(difficulty)
      ) {
        currentSelection = { ...currentSelection, runDifficulty: difficulty };
        playStatus = 'idle';
      }
    }
    reconcile();
    render();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== escapeKey || screen !== 'browser') return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.matches('input, select, textarea')
    )
      return;
    event.preventDefault();
    returnToOverview();
  }

  function onDocumentClick(event: MouseEvent): void {
    if (!filtersOpen && !sortOpen) return;
    const path = event.composedPath();
    const toggle = root.querySelector('[data-action="toggle-filters"]');
    const sortPanel = root.querySelector('[data-sort-panel]')!;
    const sortToggle = root.querySelector('[data-action="toggle-sort"]')!;
    if (
      filtersOpen &&
      !path.includes(filterPanel) &&
      (toggle === null || !path.includes(toggle))
    )
      filtersOpen = false;
    if (sortOpen && !path.includes(sortPanel) && !path.includes(sortToggle))
      sortOpen = false;
    syncFilterControls();
  }

  root.addEventListener('click', onClick);
  root.ownerDocument.addEventListener('click', onDocumentClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', onKeyDown);
  reconcile();
  render();

  return {
    refreshSavedData,
    getSelectionSnapshot: snapshot,
    getViewportSize() {
      return {
        width: shell.surface.clientWidth,
        height: shell.surface.clientHeight,
      };
    },
    setRendererStatus(status, message) {
      rendererStatus = status;
      rendererMessage =
        message ??
        {
          loading: 'The Observatory is lighting its stars…',
          rendered: '',
          suspended: 'The Observatory needs more room to show its sky.',
          unavailable:
            'The celestial view could not start. You can keep browsing or retry it.',
        }[status];
      const notice = root.querySelector<HTMLElement>('[data-renderer-notice]')!;
      const retry = root.querySelector<HTMLButtonElement>(
        '[data-action="renderer-retry"]',
      )!;
      notice.hidden = status === 'rendered';
      root.querySelector<HTMLElement>('[data-renderer-copy]')!.textContent =
        rendererMessage;
      retry.hidden = status !== 'unavailable';
      renderDetail();
    },
    setPlayStatus(status, message = '') {
      playStatus = status;
      playMessage = message;
      if (status === 'idle') {
        reconcile();
        render();
      }
      renderDetail();
      setNotice(
        '[data-play-status]',
        message,
        status === 'preparing' || status === 'error',
      );
    },
    focusSelectedSong() {
      const selected = currentSelection.selectedSongId;
      if (screen === 'browser' && selected !== null) {
        root
          .querySelector<HTMLButtonElement>(
            `button[data-action="select-song"][data-song-id="${selected}"]`,
          )
          ?.focus();
      } else {
        root
          .querySelector<HTMLButtonElement>('[data-action="browse-collection"]')
          ?.focus();
      }
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      saveDialog?.destroy();
      unlockDialog?.destroy();
      root.removeEventListener('click', onClick);
      root.ownerDocument.removeEventListener('click', onDocumentClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      root.removeEventListener('keydown', onKeyDown);
      collectionButtons.clear();
      shell.removeScreen('observatory');
    },
  };
}
