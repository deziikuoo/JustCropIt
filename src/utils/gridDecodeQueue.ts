import { GRID_DECODE_CONCURRENCY } from '../constants/optimization';

interface QueuedTask {
  photoId?: string;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  cancelled: boolean;
}

export interface GridDecodeQueue {
  enqueue: (task: () => Promise<void>, photoId?: string) => Promise<void>;
  cancelForPhoto: (photoId: string) => void;
  readonly pendingCount: number;
}

export function createGridDecodeQueue(
  maxConcurrency: number = GRID_DECODE_CONCURRENCY
): GridDecodeQueue {
  const queue: QueuedTask[] = [];
  let activeCount = 0;

  const runNext = (): void => {
    while (activeCount < maxConcurrency && queue.length > 0) {
      const task = queue.shift();
      if (!task || task.cancelled) continue;

      activeCount += 1;
      task
        .run()
        .then(() => {
          if (!task.cancelled) task.resolve();
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

    enqueue(task: () => Promise<void>, photoId?: string): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        queue.push({ photoId, run: task, resolve, reject, cancelled: false });
        runNext();
      });
    },

    cancelForPhoto(photoId: string): void {
      for (const task of queue) {
        if (task.photoId === photoId) {
          task.cancelled = true;
          task.resolve();
        }
      }
    },
  };
}
