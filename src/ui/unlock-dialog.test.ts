import { describe, expect, it, vi } from 'vitest';
import { createUnlockController } from './unlock-dialog';

function setup(persistence: 'local' | 'session' = 'local') {
  const purchase = vi.fn(() => ({
    status: 'applied' as string,
    notice: null,
    persistence,
    changed: true,
  }));
  const flow = createUnlockController(
    { snapshot: () => ({ persistence }), purchase } as never,
    { kind: 'song', songId: 'song' },
  );
  return { flow, purchase };
}
describe('Unlock confirmation policy', () => {
  it('ordinary confirmation offers no destination picker and automatically saves locally', () => {
    const { flow, purchase } = setup();
    expect(flow.snapshot()).toMatchObject({
      phase: 'confirm',
      canOfferTemporary: false,
    });
    flow.requestTemporary();
    expect(flow.snapshot().phase).toBe('confirm');
    flow.confirm();
    expect(purchase).toHaveBeenCalledExactlyOnceWith(
      { kind: 'song', songId: 'song' },
      'local',
    );
    expect(flow.snapshot().phase).toBe('result');
  });
  it('failed local purchase reports nothing spent and retries locally without fallback', () => {
    const { flow, purchase } = setup();
    purchase.mockReturnValueOnce({
      status: 'failed',
      notice: null,
      persistence: 'local',
      changed: false,
    });
    flow.confirm();
    expect(flow.snapshot()).toMatchObject({
      phase: 'error',
      canOfferTemporary: true,
      notice: expect.stringMatching(/no credits were spent/i),
    });
    expect(purchase).toHaveBeenCalledTimes(1);
    flow.confirm();
    expect(purchase).toHaveBeenLastCalledWith(expect.anything(), 'local');
  });
  it('temporary unlock requires a separate explicit confirmation after failure', () => {
    const { flow, purchase } = setup();
    purchase.mockReturnValueOnce({
      status: 'failed',
      notice: null,
      persistence: 'local',
      changed: false,
    });
    flow.confirm();
    flow.requestTemporary();
    expect(flow.snapshot().phase).toBe('confirm-temporary');
    expect(purchase).toHaveBeenCalledTimes(1);
    flow.confirm();
    expect(purchase).toHaveBeenLastCalledWith(expect.anything(), 'session');
  });
  it('existing session state warns and requires temporary consent, never claims local persistence', () => {
    const { flow, purchase } = setup('session');
    purchase.mockReturnValueOnce({
      status: 'session-only',
      notice: null,
      persistence: 'session',
      changed: true,
    });
    expect(flow.snapshot()).toMatchObject({
      phase: 'confirm-temporary',
      notice: expect.stringMatching(/not be saved on this device/i),
    });
    expect(purchase).not.toHaveBeenCalled();
    flow.confirm();
    expect(purchase).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      'session',
    );
    expect(flow.snapshot().notice).toMatch(/session only/i);
    expect(flow.snapshot().notice).not.toMatch(/saved on this device/i);
  });
});
