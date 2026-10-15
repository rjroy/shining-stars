export function createCdpCommandChannel(socket, { timeoutMs = 5000 } = {}) {
  let sequence = 0;
  const pending = new Map();

  const rejectPending = (reason) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(new Error(`CDP command ${entry.method} (${id}) failed: ${reason}`));
    }
  };

  socket.addEventListener('close', (event) => {
    rejectPending(`WebSocket closed${event?.reason ? `: ${event.reason}` : ''}`);
  });
  socket.addEventListener('error', () => rejectPending('WebSocket error'));

  return {
    command(method, params = {}) {
      if (socket.readyState !== 1)
        return Promise.reject(new Error(`CDP command ${method} rejected: WebSocket is not open`));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP command ${method} (${id}) timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, { method, resolve, reject, timer });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error(`CDP command ${method} (${id}) could not be sent: ${error.message}`, { cause: error }));
        }
      });
    },
    handleMessage(message) {
      if (!message.id || !pending.has(message.id)) return false;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(`CDP command ${entry.method} (${message.id}) failed: ${message.error.message}`));
      else entry.resolve(message.result);
      return true;
    },
    rejectPending,
    get pendingCount() {
      return pending.size;
    },
  };
}
