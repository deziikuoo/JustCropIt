/**
 * Bounded-parallelism helpers.
 *
 * Unlike `Promise.all(items.map(...))`, these keep at most `limit` tasks in
 * flight, so a large batch never holds every decoded buffer in memory at once.
 */

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const workers = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const run = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: workers }, run));
  return results;
}

export function forEachWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>
): Promise<void[]> {
  return mapWithConcurrency(items, limit, task);
}
