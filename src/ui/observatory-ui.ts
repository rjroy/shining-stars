import { defaultDifficulty, type Difficulty } from '../game/game-balance';
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
  type SongSelection,
} from '../catalog/selectors';
import { createFavoriteStore, type FavoriteStore } from '../catalog/favorites';
import { ensureExperienceShell } from './experience-shell';
import type { BrightvaleRendererStatus } from '../rendering/brightvale/viewport';

export interface ObservatoryAnchor {
  readonly collectionId: string;
  /** Position relative to the stable scene host, in CSS pixels. */
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

export interface ObservatoryPlayRequest {
  readonly songId: string;
  readonly difficulty: Difficulty;
}

export type ObservatoryPlayStatus = 'idle' | 'preparing' | 'error';

export interface ObservatoryUIActions {
  readonly onPlay: (request: ObservatoryPlayRequest) => void;
  readonly onRendererRetry?: () => void;
}

export interface ObservatorySelectionSnapshot {
  readonly screen: 'overview' | 'browser';
  readonly collectionId: string | null;
  readonly filters: SongBrowseFilters;
  readonly selection: SongSelection;
}

export interface ObservatoryUI {
  getSelectionSnapshot(): ObservatorySelectionSnapshot;
  getViewportSize(): { readonly width: number; readonly height: number };
  setProjectedAnchors(anchors: readonly ObservatoryAnchor[]): void;
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
  if (song === undefined) return null;
  return {
    selectedSongId: song.id,
    runDifficulty:
      selection.runDifficulty !== null &&
      getSongDifficulties(song).includes(selection.runDifficulty)
        ? selection.runDifficulty
        : getSongDifficulties(song).includes('normal')
          ? 'normal'
          : (getSongDifficulties(song)[0] ?? null),
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

const escapeKey = 'Escape';

function createSvgIcon(name: 'heart' | 'search' | 'filter' | 'back'): string {
  const paths = {
    heart:
      '<path d="M20.8 8.8c0 5.1-8.8 10-8.8 10s-8.8-4.9-8.8-10A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.7Z"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 4.4 4.4"/>',
    filter:
      '<path d="M3 6h18M6 12h12m-9 6h6"/><circle cx="8" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="18" r="2"/>',
    back: '<path d="m14.5 5-7 7 7 7"/>',
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
  favoriteStore: FavoriteStore = createFavoriteStore(),
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
        <nav class="observatory-tools" aria-label="Song navigation">
          <button class="observatory-nav-button is-active" type="button" data-action="all-songs">All Songs</button>
          <label class="observatory-search">
            ${createSvgIcon('search')}
            <span class="sr-only">Search songs</span>
            <input type="search" data-search placeholder="Search songs" autocomplete="off" />
          </label>
          <button class="observatory-tool-button" type="button" data-action="favorites" aria-pressed="false">${createSvgIcon('heart')}<span>Favorites</span></button>
          <button class="observatory-tool-button" type="button" data-action="toggle-filters" aria-expanded="false" aria-controls="observatory-filters">${createSvgIcon('filter')}<span>Filters</span></button>
        </nav>
      </header>

      <div class="observatory-feedback" data-renderer-notice role="status" aria-live="polite" hidden>
        <span data-renderer-copy></span>
        <button class="observatory-retry" type="button" data-action="renderer-retry" hidden>Retry the Observatory</button>
      </div>
      <p class="observatory-storage-notice" data-storage-notice role="status" hidden></p>

      <section class="observatory-overview" data-observatory-page="overview" aria-labelledby="observatory-title">
        <div class="overview-copy">
          <p class="observatory-kicker">A song can change tomorrow</p>
          <h1 id="observatory-title">Choose your constellation.</h1>
          <p class="overview-lede">Find your next performance, then carry its song into the city.</p>
        </div>
        <div class="constellation-anchor-layer" data-anchor-layer role="group" aria-label="Song collections"></div>
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

      <section class="observatory-filter-panel" id="observatory-filters" data-filter-panel aria-label="Filter songs" hidden>
        <div class="filter-heading"><h2>Refine your search</h2><button type="button" data-action="clear-filters">Clear filters</button></div>
        <label>Availability<select data-filter-availability><option value="">All songs</option><option value="available">Available to play</option><option value="unavailable">Unavailable</option></select></label>
        <label>Difficulty support<select data-filter-difficulty><option value="">Any difficulty</option><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option></select></label>
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
  const list = root.querySelector<HTMLElement>('[data-song-list]')!;
  const detail = root.querySelector<HTMLElement>('[data-song-detail]')!;
  let selectedCollectionId = catalog.collections[0]?.id ?? null;
  const currentCollection = () =>
    catalog.collections.find((item) => item.id === selectedCollectionId) ??
    null;
  const initialSong =
    catalog.songs.find((song) => song.availability === 'available') ?? null;
  const selection: SongSelection =
    initialSong === null
      ? { selectedSongId: null, runDifficulty: null }
      : {
          selectedSongId: initialSong.id,
          runDifficulty: getSongDifficulties(initialSong).includes('normal')
            ? 'normal'
            : (getSongDifficulties(initialSong)[0] ?? null),
        };
  let currentSelection = selection;
  let screen: 'overview' | 'browser' = 'overview';
  let filters: SongBrowseFilters = {};
  let favoritesOnly = false;
  let filtersOpen = false;
  let rendererStatus: BrightvaleRendererStatus = 'loading';
  let rendererMessage = 'The Observatory is lighting its stars…';
  let playStatus: ObservatoryPlayStatus = 'idle';
  let playMessage = '';
  let projectedAnchors: readonly ObservatoryAnchor[] = [];
  let disposed = false;
  const anchorButtons = new Map<string, HTMLButtonElement>();

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

  function syncFilterControls(): void {
    const availability = root.querySelector<HTMLSelectElement>(
      '[data-filter-availability]',
    );
    const supports = root.querySelector<HTMLSelectElement>(
      '[data-filter-difficulty]',
    );
    if (availability !== null) availability.value = filters.availability ?? '';
    if (supports !== null) supports.value = filters.supportsDifficulty ?? '';
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

  function reconcile(): void {
    currentSelection = reconcileSongSelection(
      catalog,
      { ...filters, favoritesOnly },
      currentSelection,
      favoriteStore.snapshot().ids,
    );
  }

  function renderAnchors(): void {
    const layer = root.querySelector<HTMLElement>('[data-anchor-layer]');
    if (layer === null) return;
    const byCollection = new Map(
      projectedAnchors.map((anchor) => [anchor.collectionId, anchor]),
    );
    const hostRect = shell.surface.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const hostStyle = getComputedStyle(shell.surface);
    const contentLeft =
      hostRect.left +
      (Number.parseFloat(hostStyle.borderLeftWidth) || 0) +
      (Number.parseFloat(hostStyle.paddingLeft) || 0);
    const contentTop =
      hostRect.top +
      (Number.parseFloat(hostStyle.borderTopWidth) || 0) +
      (Number.parseFloat(hostStyle.paddingTop) || 0);
    const collectionIds = new Set(catalog.collections.map((item) => item.id));
    for (const [collectionId, button] of anchorButtons) {
      if (collectionIds.has(collectionId)) continue;
      button.remove();
      anchorButtons.delete(collectionId);
    }
    for (const item of catalog.collections) {
      const anchor = byCollection.get(item.id);
      let button = anchorButtons.get(item.id);
      if (button === undefined) {
        button = createButton(
          item.title,
          'select-collection',
          'constellation-hotspot',
          starGlyph(0),
        );
        anchorButtons.set(item.id, button);
        layer.append(button);
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
          button.prepend(artwork);
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
      button.style.left = `${anchor === undefined ? overview.clientWidth * 0.33 : anchor.x + contentLeft - layerRect.left}px`;
      button.style.top = `${anchor === undefined ? overview.clientHeight * 0.42 : anchor.y + contentTop - layerRect.top}px`;
      button.hidden = anchor !== undefined && !anchor.visible;
    }
  }

  function renderRows(): void {
    const scrollTop = list.scrollTop;
    const results = selectSongs(
      catalog,
      { ...filters, favoritesOnly },
      favoriteStore.snapshot().ids,
    );
    root.querySelector<HTMLElement>('[data-result-count]')!.textContent =
      `${results.length} ${results.length === 1 ? 'song' : 'songs'}`;
    root.querySelector<HTMLElement>('[data-browser-count]')!.textContent =
      `${results.length} ${results.length === 1 ? 'performance' : 'performances'}`;
    const fragment = document.createDocumentFragment();
    results.forEach((song, index) => {
      const row = document.createElement('div');
      row.className = `song-row${song.id === currentSelection.selectedSongId ? ' is-selected' : ''}${song.availability === 'unavailable' ? ' is-unavailable' : ''}`;
      row.setAttribute('role', 'listitem');
      row.setAttribute(
        'aria-label',
        `${song.title}${song.availability === 'unavailable' ? ', unavailable' : ''}`,
      );
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
          ? `Demo excerpt · play-test chart · ${formatSongDuration(browseChart(song).duration)}`
          : song.availability === 'unavailable'
            ? `Unavailable · ${formatSongDuration(browseChart(song).duration)}`
            : `Play-test chart · ${formatSongDuration(browseChart(song).duration)}`;
      text.append(title, status);
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
        'No songs match these filters. Clear a filter or try another search.';
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
    duration.textContent = `${formatSongDuration(browseChart(song).duration)} playable`;
    heading.append(art, eyebrow, title, duration);

    const status = document.createElement('p');
    status.className = `song-chart-status${song.availability === 'unavailable' ? ' is-unavailable' : ''}`;
    status.textContent =
      song.availability === 'unavailable'
        ? 'This song is currently unavailable.'
        : song.chartStatus === 'candidate'
          ? 'Play-test chart · still being refined'
          : 'Chart verified';

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

    const play = createButton(
      'Play',
      'play',
      'observatory-gold-button song-play-button',
      '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5 3.5 16 10 5 16.5z" fill="currentColor"/></svg>',
    );
    const rendererReady = rendererStatus === 'rendered';
    const valid = canStartSong(catalog, song, currentSelection.runDifficulty);
    play.disabled = !valid || !rendererReady || playStatus === 'preparing';
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
    detail.append(heading, status, difficultyLabel, play, help);
  }

  function render(): void {
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
    root.querySelector<HTMLElement>('[data-collection-count]')!.textContent =
      `${currentCollection()?.songIds.length ?? 0} songs`;
    root.querySelector<HTMLElement>('.collection-story')!.textContent =
      `${currentCollection()?.songIds.length ?? 0} songs in the current collection.`;
    syncFilterControls();
    renderAnchors();
    renderRows();
    renderDetail();
    const storage = favoriteStore.snapshot();
    setNotice(
      '[data-storage-notice]',
      storage.notice ?? '',
      storage.notice !== null,
    );
    setNotice(
      '[data-play-status]',
      playMessage,
      playStatus === 'preparing' || playStatus === 'error',
    );
  }

  function openBrowser(collectionId?: string, focusSearch = true): void {
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
    if (action === 'all-songs' || action === 'overview-all') {
      favoritesOnly = false;
      openBrowser(undefined);
    } else if (action === 'browse-collection') {
      openBrowser(selectedCollectionId ?? undefined, false);
      root
        .querySelector<HTMLButtonElement>('[data-action="back-overview"]')
        ?.focus();
    } else if (action === 'back-overview') {
      screen = 'overview';
      render();
      root
        .querySelector<HTMLButtonElement>('[data-action="browse-collection"]')
        ?.focus();
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
    } else if (action === 'favorites' || action === 'overview-favorites') {
      favoritesOnly = true;
      openBrowser(undefined);
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
      syncFilterControls();
    } else if (action === 'clear-filters') {
      filters = { collectionId: filters.collectionId };
      favoritesOnly = false;
      searchInput.value = '';
      reconcile();
      render();
      searchInput.focus();
    } else if (action === 'play') {
      const song = currentSong();
      if (
        !canStartSong(catalog, song, currentSelection.runDifficulty) ||
        song === null ||
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
    if (target.value.length > 0 && screen === 'overview') screen = 'browser';
    reconcile();
    render();
    const nextInput = root.querySelector<HTMLInputElement>('[data-search]');
    nextInput?.focus();
    nextInput?.setSelectionRange(target.selectionStart, target.selectionEnd);
  }

  function onChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.dataset.filterAvailability !== undefined) {
      const value = target.value;
      const availability =
        value === 'available' || value === 'unavailable' ? value : undefined;
      filters = { ...filters, availability };
    } else if (target.dataset.filterDifficulty !== undefined) {
      filters = {
        ...filters,
        supportsDifficulty: normalizeDifficulty(target.value) ?? undefined,
      };
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
    screen = 'overview';
    render();
    root
      .querySelector<HTMLButtonElement>('[data-action="browse-collection"]')
      ?.focus();
  }

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', onKeyDown);
  reconcile();
  render();

  return {
    getSelectionSnapshot: snapshot,
    getViewportSize() {
      return {
        width: shell.surface.clientWidth,
        height: shell.surface.clientHeight,
      };
    },
    setProjectedAnchors(anchors) {
      projectedAnchors = anchors;
      renderAnchors();
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
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      root.removeEventListener('keydown', onKeyDown);
      anchorButtons.clear();
      shell.removeScreen('observatory');
    },
  };
}
