import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { stopOwnedChild, stopOwnedChildren } from './child-process-cleanup.mjs';

class FakeChild extends EventEmitter {
  exitCode = null;
  signalCode = null;
  signals = [];
  constructor({ exitOnTerm = false } = {}) { super(); this.exitOnTerm = exitOnTerm; }
  kill(signal) {
    this.signals.push(signal);
    if (signal === 'SIGTERM' && this.exitOnTerm) {
      queueMicrotask(() => {
        this.signalCode = signal;
        this.emit('exit', null, signal);
      });
    }
  }
}

test('already signal-exited children are not signaled or awaited again', async () => {
  const child = new FakeChild();
  child.signalCode = 'SIGTERM';
  assert.deepEqual(await stopOwnedChild(child), { stopped: true, alreadyExited: true });
  assert.deepEqual(child.signals, []);
});

test('stuck children get bounded TERM and KILL waits before cleanup reports failure', async () => {
  const child = new FakeChild();
  await assert.rejects(stopOwnedChild(child, { graceMs: 5, killGraceMs: 5 }), /remained alive/);
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
});

test('cleanup attempts both owned children when the first child remains stuck', async () => {
  const stuck = new FakeChild();
  const exitsOnTerm = new FakeChild({ exitOnTerm: true });
  const failures = await stopOwnedChildren(
    [['Chromium', stuck], ['Vite', exitsOnTerm]],
    { graceMs: 5, killGraceMs: 5 },
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].name, 'Chromium');
  assert.match(failures[0].error.message, /remained alive/);
  assert.deepEqual(stuck.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(exitsOnTerm.signals, ['SIGTERM']);
});
