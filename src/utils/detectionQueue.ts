/**
 * Single-flight detection queue with revision guard (Phase 4).
 */

import { getDetectionConcurrency } from '../constants/optimization';

interface QueuedTask<T> {
  photoId: string;
  revision: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  cancelled: boolean;
}

export interface DetectionQueue {
  enqueue: <T>(
    photoId: string,
    revision: number,
    task: () => Promise<T>
  ) => Promise<T>;
  cancelForPhoto: (photoId: string) => void;
  getRevision: (photoId: string) => number;
  bumpRevision: (photoId: string) => number;
  readonly pendingCount: number;
}

export function createDetectionQueue(
  maxConcurrency: number = getDetectionConcurrency()
): DetectionQueue {
  const queue: QueuedTask<unknown>[] = [];
  const revisions = new Map<string, number>();
  let activeCount = 0;

  const runNext = (): void => {
    while (activeCount < maxConcurrency && queue.length > 0) {
      const task = queue.shift();
      if (!task || task.cancelled) continue;

      const expectedRevision = revisions.get(task.photoId) ?? task.revision;
      if (task.revision !== expectedRevision) {
        task.resolve(null);
        continue;
      }

      activeCount += 1;
      task
        .run()
        .then((result) => {
          const currentRevision = revisions.get(task.photoId) ?? task.revision;
          if (task.cancelled || task.revision !== currentRevision) {
            return;
          }
          task.resolve(result);
        })
        .catch((error) => {
          if (!task.cancelled) task.reject(error);
        })
        .finally(() => {
          activeCount -= 1;
          runNext();
        });
    }
  };

  return {
    get pendingCount() {
      return queue.length + activeCount;
    },

    getRevision(photoId: string): number {
      return revisions.get(photoId) ?? 0;
    },

    bumpRevision(photoId: string): number {
      const next = (revisions.get(photoId) ?? 0) + 1;
      revisions.set(photoId, next);
      return next;
    },

    enqueue<T>(
      photoId: string,
      revision: number,
      task: () => Promise<T>
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          photoId,
          revision,
          run: task as () => Promise<unknown>,
          resolve: resolve as (value: unknown) => void,
          reject,
          cancelled: false,
        });
        runNext();
      });
    },

    cancelForPhoto(photoId: string): void {
      const nextRevision = (revisions.get(photoId) ?? 0) + 1;
      revisions.set(photoId, nextRevision);

      for (const task of queue) {
        if (task.photoId === photoId) {
          task.cancelled = true;
          task.resolve(null);
        }
      }
    },
  };
}
