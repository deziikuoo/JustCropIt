import type { GridUrlCache } from './gridUrlCache';
import type { GridDecodeQueue } from './gridDecodeQueue';
import { performanceLogger } from './performanceLogger';

export function recordGridMetrics(opts: {
  urlCache: GridUrlCache;
  decodeQueue: GridDecodeQueue;
  visibleIndices: ReadonlySet<number>;
}): void {
  if (!import.meta.env.DEV) return;

  performanceLogger.recordGridSnapshot({
    gridUrlsActive: opts.urlCache.size,
    gridDecodesQueued: opts.decodeQueue.pendingCount,
    visibleIndices: opts.visibleIndices.size,
  });
}
