import {
  SAVE_SCHEMA_VERSION,
  type SaveStore,
  type SaveImportMode,
  type SaveImportPreview,
  type SaveImportStatus,
  type ProgressionImportMode,
} from '../app/save-data';

type Phase =
  | 'closed'
  | 'choose'
  | 'reading'
  | 'preview'
  | 'confirm-replace'
  | 'confirm-session'
  | 'result'
  | 'error';
interface FlowOptions {
  previewImport(
    text: string,
    mode: SaveImportMode,
    progressionMode?: ProgressionImportMode,
  ): SaveImportPreview;
  applyImport(
    preview: SaveImportPreview,
    target: 'local' | 'session',
  ): { status: SaveImportStatus; notice: string | null };
  onImported(): void;
  onChange?(): void;
}
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function createSaveDataController(options: FlowOptions) {
  let phase: Phase = 'closed';
  let mode: SaveImportMode = 'merge';
  let progressionMode: ProgressionImportMode = 'keep-current';
  let notice: string | null = null;
  let preview: SaveImportPreview | null = null;
  let text = '';
  let filename = '';
  let generation = 0;
  let disposed = false;
  let sessionAvailable = false;
  const emit = () => options.onChange?.();
  function validate() {
    try {
      preview =
        progressionMode === 'keep-current'
          ? options.previewImport(text, mode)
          : options.previewImport(text, mode, progressionMode);
      phase = 'preview';
      notice = preview.hasChanges
        ? null
        : 'No changes to player data. Importing can save your current data on this device without changing those records.';
    } catch (error) {
      preview = null;
      phase = 'error';
      notice = `Nothing changed. ${error instanceof Error ? error.message : 'This file could not be validated.'}`;
    }
    emit();
  }
  function apply(target: 'local' | 'session') {
    if (preview === null || disposed) return;
    try {
      const result = options.applyImport(preview, target);
      notice = result.notice;
      if (result.status === 'applied' || result.status === 'session-only') {
        phase = 'result';
        notice ??=
          result.status === 'applied'
            ? 'Backup imported and saved on this device.'
            : 'Imported for this session only. Download a backup before leaving.';
        preview = null;
        sessionAvailable = false;
        options.onImported();
      } else {
        phase = 'error';
        sessionAvailable =
          result.status === 'failed' || result.status === 'conflict';
        notice ??=
          'Nothing changed. Choose the backup again and review it before importing.';
        if (!sessionAvailable) preview = null;
      }
    } catch {
      phase = 'error';
      preview = null;
      sessionAvailable = false;
      notice =
        'The import could not finish. Choose the backup again and review it before importing.';
    }
    emit();
  }
  return {
    snapshot: () => ({
      phase,
      mode,
      progressionMode,
      notice,
      preview,
      filename,
      sessionAvailable,
      canImport: phase === 'preview' && preview !== null,
    }),
    open() {
      if (disposed) return;
      generation++;
      phase = 'choose';
      mode = 'merge';
      progressionMode = 'keep-current';
      notice = null;
      preview = null;
      text = '';
      filename = '';
      sessionAvailable = false;
      emit();
    },
    close() {
      generation++;
      phase = 'closed';
      preview = null;
      emit();
    },
    async readFile(file: {
      name: string;
      size?: number;
      text(): Promise<string>;
    }) {
      if (disposed || phase === 'closed') return;
      const token = ++generation;
      phase = 'reading';
      preview = null;
      notice = null;
      sessionAvailable = false;
      filename = file.name;
      emit();
      try {
        if (file.size !== undefined && file.size > MAX_FILE_BYTES)
          throw new Error('Choose a backup smaller than 2 MB.');
        const contents = await file.text();
        if (disposed || token !== generation) return;
        if (new TextEncoder().encode(contents).byteLength > MAX_FILE_BYTES)
          throw new Error('Choose a backup smaller than 2 MB.');
        text = contents;
        validate();
      } catch (error) {
        if (disposed || token !== generation) return;
        phase = 'error';
        notice = `Nothing changed. ${error instanceof Error ? error.message : 'The file could not be read. Choose another file.'}`;
        emit();
      }
    },
    setMode(next: SaveImportMode) {
      if (phase !== 'preview') return;
      mode = next;
      validate();
    },
    requestImport() {
      if (phase !== 'preview' || preview === null) return;
      if (mode === 'replace' || progressionMode === 'replace') {
        phase = 'confirm-replace';
        emit();
      } else apply('local');
    },
    confirmReplace() {
      if (phase === 'confirm-replace') apply('local');
    },
    setProgressionMode(next: ProgressionImportMode) {
      if (phase !== 'preview') return;
      progressionMode = next;
      validate();
    },
    requestSessionImport() {
      if (phase === 'error' && sessionAvailable && preview) {
        phase = 'confirm-session';
        emit();
      }
    },
    confirmSessionImport() {
      if (phase === 'confirm-session') apply('session');
    },
    back() {
      if (phase === 'confirm-replace') phase = 'preview';
      else if (phase === 'confirm-session') phase = 'error';
      emit();
    },
    destroy() {
      disposed = true;
      generation++;
      phase = 'closed';
      preview = null;
      emit();
    },
  };
}

/** Native modal shell; all imported strings are rendered as text, never markup. */
export function createSaveDataDialog(
  host: HTMLElement,
  store: SaveStore,
  knownSongIds: ReadonlySet<string>,
  onImported: () => void,
) {
  const dialog = document.createElement('dialog');
  dialog.className = 'save-data-dialog';
  dialog.setAttribute('aria-labelledby', 'save-data-title');
  host.append(dialog);
  let opener: HTMLElement | null = null;
  let unknownCount = 0;
  let legacyBackup = false;
  let lastPhase: Phase = 'closed';
  let disposed = false;
  const controller = createSaveDataController({
    previewImport(text, mode, progressionMode = 'keep-current') {
      let decoded: unknown;
      try {
        decoded = JSON.parse(text);
      } catch {
        throw new Error(
          'This is not a valid JSON backup. Choose a Shining Stars backup file.',
        );
      }
      if (
        typeof decoded === 'object' &&
        decoded !== null &&
        'format' in decoded &&
        decoded.format === 'shining-stars-save' &&
        'schemaVersion' in decoded &&
        decoded.schemaVersion !== SAVE_SCHEMA_VERSION &&
        decoded.schemaVersion !== 1
      ) {
        throw new Error(
          `Backup version ${String(decoded.schemaVersion).slice(0, 40)} is not supported by this version of Shining Stars.`,
        );
      }
      let preview: SaveImportPreview;
      try {
        preview = store.previewImport(text, mode, progressionMode);
      } catch {
        throw new Error(
          'This file is not a valid Shining Stars backup. Choose another file.',
        );
      }
      // Core has validated the complete envelope before this display-only read.
      const data = JSON.parse(text) as {
        schemaVersion: number;
        favorites: string[];
        ratings: Record<string, unknown>;
      };
      legacyBackup = data.schemaVersion === 1;
      unknownCount = new Set(
        [...data.favorites, ...Object.keys(data.ratings)].filter(
          (id) => !knownSongIds.has(id),
        ),
      ).size;
      return preview;
    },
    applyImport: (preview, target) => store.applyImport(preview, target),
    onImported,
    onChange: render,
  });
  function paragraph(text: string, className?: string) {
    const node = document.createElement('p');
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(label: string, action: () => void, primary = false) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.className = primary ? 'observatory-gold-button' : 'save-data-button';
    node.addEventListener('click', action);
    return node;
  }
  function download() {
    let url: string | null = null;
    try {
      console.info('[Save data] export download attempt');
      url = URL.createObjectURL(
        new Blob([store.exportJson()], { type: 'application/json' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `shining-stars-save-v${SAVE_SCHEMA_VERSION}.json`;
      dialog.append(anchor);
      anchor.click();
      anchor.remove();
      const status = dialog.querySelector<HTMLElement>(
        '[data-download-status]',
      );
      if (status) status.textContent = 'Backup download started.';
      console.info('[Save data] export download started');
    } catch (error) {
      const status = dialog.querySelector<HTMLElement>(
        '[data-download-status]',
      );
      if (status)
        status.textContent =
          'The download could not start. Try Download backup again.';
      console.warn('[Save data] export download failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (url !== null) {
        const objectUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  }
  function render() {
    const state = controller.snapshot();
    if (state.phase === 'closed') {
      if (dialog.open) dialog.close();
      if (!disposed && opener?.isConnected) opener.focus();
      lastPhase = state.phase;
      return;
    }
    const oldFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.saveFocus
        : undefined;
    dialog.replaceChildren();
    const header = document.createElement('div');
    header.className = 'save-data-heading';
    const title = document.createElement('h2');
    title.id = 'save-data-title';
    title.tabIndex = -1;
    title.textContent =
      state.phase === 'confirm-replace'
        ? 'Replace current save data?'
        : state.phase === 'confirm-session'
          ? 'Import for this session?'
          : 'Save data';
    header.append(
      title,
      button('Close', () => controller.close()),
    );
    dialog.append(header);
    dialog.append(
      paragraph(
        'Download a backup or import one on this device. Includes stars, favorites, credited victories, credits and unlocks.',
      ),
    );
    const snapshot = store.snapshot();
    dialog.append(
      paragraph(
        `${snapshot.ratings.ratings.size} songs played · ${snapshot.favorites.ids.size} favorites · Backup version ${SAVE_SCHEMA_VERSION}`,
        'save-data-summary',
      ),
    );
    if (snapshot.favorites.notice)
      dialog.append(paragraph(snapshot.favorites.notice, 'save-data-notice'));
    const exportRow = document.createElement('div');
    exportRow.className = 'save-data-actions';
    exportRow.append(button('Download backup', download));
    dialog.append(exportRow);
    const downloadStatus = paragraph('');
    downloadStatus.dataset.downloadStatus = '';
    downloadStatus.setAttribute('role', 'status');
    dialog.append(downloadStatus);
    if (
      state.phase === 'confirm-replace' ||
      state.phase === 'confirm-session'
    ) {
      dialog.append(
        paragraph(
          state.phase === 'confirm-replace'
            ? `The selected domains will be replaced: ${state.mode === 'replace' ? 'stars and favorites' : ''}${state.mode === 'replace' && state.progressionMode === 'replace' ? '; ' : ''}${state.progressionMode === 'replace' ? 'all credited victories, credits and unlocks' : ''}. Missing records will be removed. Download your current backup first. This cannot be undone here.`
            : 'This import will change this session only. The save stored on this device will not be overwritten. Reopening the game may restore older data. Download a backup after importing to keep these changes.',
        ),
      );
    }
    if (state.filename)
      dialog.append(paragraph(state.filename, 'save-data-filename'));
    if (state.preview) {
      const changes = state.preview.changes;
      const progress = changes.progression;
      dialog.append(
        paragraph(
          `Progression before → after: Credits ${progress.before.balance} → ${progress.after.balance}; credited difficulty marks ${progress.before.marks} → ${progress.after.marks}; collection unlocks ${progress.before.collectionPurchases} → ${progress.after.collectionPurchases}; song unlocks ${progress.before.songPurchases} → ${progress.after.songPurchases}.`,
        ),
      );
      if (legacyBackup)
        dialog.append(
          paragraph(
            'Version 1 backups contain no progression. Replacing progression resets all credited victories, credits and unlocks to zero. Keep current progression to preserve them.',
            'save-data-notice',
          ),
        );
      dialog.append(
        paragraph(
          `Favorites: ${changes.favorites.added} added, ${changes.favorites.removed} removed. Songs played: ${changes.ratings.added} added, ${changes.ratings.improved} improved, ${changes.ratings.removed} removed, ${changes.ratings.downgraded} lowered.`,
        ),
      );
      if (unknownCount > 0)
        dialog.append(
          paragraph(
            `Includes ${unknownCount} songs not in this version. Their records will be kept, but won't appear in song lists.`,
            'save-data-notice',
          ),
        );
    }
    if (state.phase === 'preview') {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = 'Stars and favorites';
      fieldset.append(legend);
      for (const mode of ['merge', 'replace'] as const) {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'save-import-mode';
        radio.value = mode;
        radio.checked = state.mode === mode;
        radio.dataset.saveFocus = mode;
        radio.addEventListener('change', () => controller.setMode(mode));
        label.append(
          radio,
          document.createTextNode(
            mode === 'merge'
              ? 'Merge with current data'
              : 'Replace current data',
          ),
        );
        fieldset.append(label);
      }
      dialog.append(
        fieldset,
        paragraph(
          state.mode === 'merge'
            ? 'Keeps favorites from both saves and the better whole star rating for each song.'
            : 'Uses this backup exactly. Local-only records will be removed and star ratings may be lowered.',
        ),
      );
      const progressionFields = document.createElement('fieldset');
      const progressionLegend = document.createElement('legend');
      progressionLegend.textContent = 'Credits, credited victories and unlocks';
      progressionFields.append(progressionLegend);
      for (const value of ['keep-current', 'replace'] as const) {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'save-progression-mode';
        radio.checked = state.progressionMode === value;
        radio.dataset.saveFocus = `progression-${value}`;
        radio.addEventListener('change', () =>
          controller.setProgressionMode(value),
        );
        label.append(
          radio,
          document.createTextNode(
            value === 'keep-current'
              ? 'Keep current progression'
              : 'Replace all progression from backup',
          ),
        );
        progressionFields.append(label);
      }
      dialog.append(
        progressionFields,
        paragraph(
          'Progression is kept or replaced as one whole record. Credits and unlocks are never merged or added together.',
        ),
      );
    }
    if (state.notice || state.phase === 'reading') {
      const notice = paragraph(
        state.phase === 'reading'
          ? 'Reading and validating backup…'
          : state.notice!,
        'save-data-notice',
      );
      notice.setAttribute('role', state.phase === 'error' ? 'alert' : 'status');
      dialog.append(notice);
    }
    const actions = document.createElement('div');
    actions.className = 'save-data-actions';
    if (
      state.phase === 'confirm-replace' ||
      state.phase === 'confirm-session'
    ) {
      actions.append(
        button('Back', () => controller.back()),
        button(
          state.phase === 'confirm-replace'
            ? 'Replace save data'
            : 'Import for this session',
          () =>
            state.phase === 'confirm-replace'
              ? controller.confirmReplace()
              : controller.confirmSessionImport(),
          true,
        ),
      );
    } else {
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = '.json,application/json';
      picker.hidden = true;
      picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        if (file) void controller.readFile(file);
      });
      const choose = button(
        state.filename ? 'Choose another file' : 'Choose backup file',
        () => picker.click(),
      );
      choose.disabled = state.phase === 'reading';
      actions.append(choose, picker);
      if (state.phase === 'preview') {
        const commit = button(
          'Import backup',
          () => controller.requestImport(),
          true,
        );
        commit.disabled = !state.canImport;
        actions.append(commit);
      }
      if (state.sessionAvailable)
        actions.append(
          button('Import for this session…', () =>
            controller.requestSessionImport(),
          ),
        );
    }
    dialog.append(actions);
    if (dialog.open) {
      if (lastPhase !== state.phase) title.focus();
      else if (oldFocus)
        dialog
          .querySelector<HTMLInputElement>(`[data-save-focus="${oldFocus}"]`)
          ?.focus();
    }
    lastPhase = state.phase;
  }
  function cancel(event: Event) {
    event.preventDefault();
    controller.close();
  }
  function stopKeys(event: KeyboardEvent) {
    event.stopPropagation();
  }
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('keydown', stopKeys);
  return {
    open() {
      if (disposed || dialog.open) return;
      opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      unknownCount = 0;
      controller.open();
      dialog.showModal();
      dialog.querySelector<HTMLElement>('h2')?.focus();
    },
    destroy() {
      disposed = true;
      controller.destroy();
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('keydown', stopKeys);
      dialog.remove();
    },
  };
}
