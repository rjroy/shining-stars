import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createCdpCommandChannel } from './cdp-command.mjs';

class FakeWebSocket extends EventEmitter {
  readyState = 1;
  sent = [];
  addEventListener(type, listener) { this.on(type, listener); }
  send(data) { this.sent.push(JSON.parse(data)); }
}

test('CDP commands reject with method/id and timeout context', async () => {
  const socket = new FakeWebSocket();
  const channel = createCdpCommandChannel(socket, { timeoutMs: 10 });
  await assert.rejects(channel.command('Runtime.evaluate'), /Runtime\.evaluate \(1\) timed out after 10ms/);
  assert.equal(channel.pendingCount, 0);
});

test('WebSocket disconnect rejects pending commands and clears their timers', async () => {
  const socket = new FakeWebSocket();
  const channel = createCdpCommandChannel(socket, { timeoutMs: 1000 });
  const pending = channel.command('Page.captureScreenshot');
  socket.emit('close', { reason: 'test disconnect' });
  await assert.rejects(pending, /Page\.captureScreenshot \(1\).*WebSocket closed: test disconnect/);
  assert.equal(channel.pendingCount, 0);
});
