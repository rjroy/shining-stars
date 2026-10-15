function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
  if (exited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (didExit) => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(didExit);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(exited(child)), timeoutMs);
    child.once('exit', onExit);
  });
}

export async function stopOwnedChild(child, { graceMs = 5000, killGraceMs = 1500 } = {}) {
  if (exited(child)) return { stopped: true, alreadyExited: true };
  child.kill('SIGTERM');
  if (await waitForExit(child, graceMs)) return { stopped: true, alreadyExited: false };
  if (exited(child)) return { stopped: true, alreadyExited: true };
  child.kill('SIGKILL');
  if (await waitForExit(child, killGraceMs)) return { stopped: true, alreadyExited: false };
  throw new Error('Owned child remained alive after SIGTERM and bounded SIGKILL wait.');
}

export async function stopOwnedChildren(children, options) {
  const failures = [];
  for (const [name, child] of children) {
    if (!child) continue;
    try {
      await stopOwnedChild(child, options);
    } catch (error) {
      failures.push({ name, error });
    }
  }
  return failures;
}
