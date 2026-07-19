const queues = new Map<string, Promise<unknown>>();

// Serialises async operations sharing the same key, in call order.
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  queues.set(
    key,
    run.catch(() => {}),
  );
  return run;
}
