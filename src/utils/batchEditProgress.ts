/**
 * Helpers for batch-edit progress + ETA display.
 */

export function formatBatchEta(
  startedAtMs: number,
  current: number,
  total: number
): string | null {
  if (current <= 0 || total <= 0 || current >= total) return null;

  const elapsed = Date.now() - startedAtMs;
  if (elapsed < 200) return null;

  const msPerItem = elapsed / current;
  const remainingMs = Math.max(0, msPerItem * (total - current));

  if (remainingMs < 1000) return 'About 1 sec remaining';

  const totalSec = Math.max(1, Math.ceil(remainingMs / 1000));
  if (totalSec < 60) {
    return `About ${totalSec} sec remaining`;
  }

  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (sec === 0) {
    return min === 1 ? 'About 1 min remaining' : `About ${min} min remaining`;
  }
  return `About ${min} min ${sec} sec remaining`;
}

export type BatchProgressCallback = (completed: number, total: number) => void;

export function isBatchAborted(signal?: AbortSignal | null): boolean {
  return Boolean(signal?.aborted);
}
