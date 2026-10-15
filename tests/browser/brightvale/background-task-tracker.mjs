export function createBackgroundTaskTracker() {
  const tasks = [];
  let failure = null;
  return {
    track(task, label) {
      // Attach both handlers immediately, including when task rejects before
      // the owning flow next reaches its drain point.
      const observed = Promise.resolve()
        .then(task)
        .then(
          (value) => ({ value }),
          (error) => {
            failure ??= new Error(`${label} failed: ${error?.message ?? error}`, { cause: error });
            return { error: failure };
          },
        );
      tasks.push(observed);
      return observed;
    },
    throwIfFailed() {
      if (failure) throw failure;
    },
    async drain() {
      await Promise.all(tasks);
      this.throwIfFailed();
    },
  };
}
