import type { SaveStore, SaveImportTarget } from '../app/save-data';
import type { ProgressionPurchaseRequest } from '../catalog/progression';

export function purchaseUnlock(
  progression: Pick<SaveStore['progression'], 'purchase'>,
  request: ProgressionPurchaseRequest,
  target: SaveImportTarget,
) {
  const result = progression.purchase(request, target);
  const done = result.status === 'applied' || result.status === 'session-only';
  return {
    done,
    notice: done
      ? result.status === 'session-only'
        ? 'Unlocked for this session only. Download a backup before leaving.'
        : 'Unlock saved on this device.'
      : (result.notice ??
        'Purchase was not applied. No credits were spent. Try again or explicitly choose session only.'),
  };
}

export function createUnlockController(
  progression: SaveStore['progression'],
  request: ProgressionPurchaseRequest,
) {
  type Phase = 'confirm' | 'error' | 'confirm-temporary' | 'result';
  const temporaryWarning =
    'This unlock will not be saved on this device. It lasts for this session only. Download a backup before leaving. Confirm the temporary unlock to spend credits.';
  let phase: Phase =
    progression.snapshot().persistence === 'session'
      ? 'confirm-temporary'
      : 'confirm';
  let notice = phase === 'confirm-temporary' ? temporaryWarning : '';
  return {
    snapshot: () => ({ phase, notice, canOfferTemporary: phase === 'error' }),
    requestTemporary() {
      if (phase !== 'error') return;
      phase = 'confirm-temporary';
      notice = temporaryWarning;
    },
    back() {
      if (phase !== 'confirm-temporary') return;
      phase = 'error';
      notice =
        'Nothing changed. No credits were spent. Retry saving or explicitly choose a temporary unlock.';
    },
    confirm() {
      if (phase === 'result') return;
      const target = phase === 'confirm-temporary' ? 'session' : 'local';
      try {
        const result = purchaseUnlock(progression, request, target);
        phase = result.done ? 'result' : 'error';
        notice = result.done
          ? result.notice
          : `Nothing changed. No credits were spent; nothing was unlocked. ${result.notice}`;
      } catch (error) {
        phase = 'error';
        notice = `Nothing changed. No credits were spent; nothing was unlocked. ${error instanceof Error ? error.message : 'The purchase could not finish.'}`;
      }
    },
  };
}

/** Protected confirmation: a failed local purchase never becomes a session purchase. */
export function createUnlockDialog(
  host: HTMLElement,
  store: SaveStore,
  onChanged: () => void,
) {
  const dialog = document.createElement('dialog');
  dialog.className = 'save-data-dialog unlock-dialog';
  dialog.setAttribute('aria-labelledby', 'unlock-title');
  host.append(dialog);
  let opener: HTMLElement | null = null;
  let request: ProgressionPurchaseRequest | null = null;
  let title = '';
  let cost = 0;
  let flow: ReturnType<typeof createUnlockController> | null = null;
  const close = () => {
    dialog.close();
    if (opener?.isConnected) opener.focus();
    else
      host
        .querySelector<HTMLElement>(
          '[data-action="unlock"], [data-action="play"]',
        )
        ?.focus();
  };
  function render() {
    if (flow === null) return;
    const state = flow.snapshot();
    const done = state.phase === 'result';
    dialog.replaceChildren();
    const heading = document.createElement('h2');
    heading.id = 'unlock-title';
    heading.tabIndex = -1;
    heading.textContent = done
      ? 'Unlocked'
      : state.phase === 'confirm-temporary'
        ? `Temporarily unlock ${title}?`
        : `Unlock ${title}?`;
    const copy = document.createElement('p');
    const balance = store.progression.snapshot().balance;
    copy.textContent = done
      ? request?.kind === 'collection'
        ? 'Collection unlocked. Choose a song to unlock for 1 credit; nothing starts automatically.'
        : 'Your song is unlocked. Choose Play when you are ready.'
      : `Cost: ${cost} ${cost === 1 ? 'credit' : 'credits'} · Balance: ${balance} · After unlock: ${Math.max(0, balance - cost)} credits. ${request?.kind === 'collection' ? 'Songs are unlocked separately for 1 credit each.' : 'This unlock does not start a performance.'}`;
    const status = document.createElement('p');
    status.className = 'save-data-notice';
    status.setAttribute('role', 'status');
    status.textContent =
      state.notice ||
      (balance < cost
        ? `You need ${cost - balance} more credits. Win on a new difficulty to earn credits; higher victories also credit lower difficulties.`
        : '');
    const actions = document.createElement('div');
    actions.className = 'save-data-actions';
    const button = (text: string, action: () => void) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'save-data-button';
      node.textContent = text;
      node.addEventListener('click', action);
      actions.append(node);
      return node;
    };
    button(done ? 'Done' : 'Cancel', close);
    if (!done && balance >= cost) {
      const price = `${cost} ${cost === 1 ? 'credit' : 'credits'}`;
      button(
        state.phase === 'confirm-temporary'
          ? `Confirm temporary unlock · ${price}`
          : state.phase === 'error'
            ? 'Retry unlock'
            : `Unlock · ${price}`,
        buy,
      );
      if (state.canOfferTemporary)
        button('Use temporary unlock…', () => {
          flow?.requestTemporary();
          render();
        });
      if (
        state.phase === 'confirm-temporary' &&
        store.progression.snapshot().persistence === 'local'
      )
        button('Back', () => {
          flow?.back();
          render();
        });
    }
    dialog.append(heading, copy, status, actions);
    if (dialog.open) heading.focus();
  }
  function buy() {
    if (flow === null) return;
    flow.confirm();
    onChanged();
    render();
  }
  const cancel = (event: Event) => {
    event.preventDefault();
    close();
  };
  const stopKeys = (event: KeyboardEvent) => event.stopPropagation();
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('keydown', stopKeys);
  return {
    open(next: ProgressionPurchaseRequest, name: string, price: number) {
      if (dialog.open) return;
      opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      request = next;
      title = name;
      cost = price;
      flow = createUnlockController(store.progression, next);
      render();
      dialog.showModal();
      dialog.querySelector<HTMLElement>('h2')?.focus();
    },
    destroy() {
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('keydown', stopKeys);
      dialog.remove();
    },
  };
}
