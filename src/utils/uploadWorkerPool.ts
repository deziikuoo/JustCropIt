/**
 * Upload Worker Pool — dedicated pool for import ingest (isolated from edit workers).
 */

import { UPLOAD_WORKER_POOL_MAX } from '../constants/optimization';
import type { UploadWorkerRequest, UploadWorkerResponse } from '../types/import';

interface Task {
  request: UploadWorkerRequest;
  resolve: (value: UploadWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  transferables?: Transferable[];
}

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

class UploadWorkerPool {
  private idleWorkers: Worker[] = [];
  private busyWorkers = new Set<Worker>();
  private taskQueue: Task[] = [];
  private pendingTasks = new Map<string, Task>();
  private maxWorkers: number;
  private initialized = false;

  constructor() {
    this.maxWorkers = this.determinePoolSize();
  }

  private determinePoolSize(): number {
    const nav = navigator as NavigatorWithMemory;
    const cpuCores = navigator.hardwareConcurrency || 4;
    const memory = nav.deviceMemory || 4;

    if (memory < 4) {
      return 1;
    }

    if (memory < 8) {
      return Math.min(2, UPLOAD_WORKER_POOL_MAX);
    }

    const count = Math.min(
      UPLOAD_WORKER_POOL_MAX,
      Math.max(2, cpuCores - 1)
    );
    return count;
  }

  isSupported(): boolean {
    return (
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap !== 'undefined'
    );
  }

  private initWorkers(): void {
    if (this.initialized) return;

    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = new Worker(
        new URL('../workers/uploadWorker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (event: MessageEvent<UploadWorkerResponse>) => {
        this.onWorkerMessage(worker, event.data);
      };

      worker.onerror = (error) => {
        console.error('[UploadWorkerPool] Worker error:', error);
        this.onWorkerError(worker);
      };

      this.idleWorkers.push(worker);
    }

    this.initialized = true;
  }

  submitTask(
    request: UploadWorkerRequest,
    transferables: Transferable[] = []
  ): Promise<UploadWorkerResponse> {
    return new Promise((resolve, reject) => {
      if (!this.initialized) this.initWorkers();

      this.taskQueue.push({ request, resolve, reject, transferables });
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.taskQueue.length === 0 || this.idleWorkers.length === 0) return;

    const worker = this.idleWorkers.pop();
    const task = this.taskQueue.shift();

    if (!worker || !task) return;

    this.busyWorkers.add(worker);
    this.pendingTasks.set(task.request.id, task);

    try {
      worker.postMessage(task.request, task.transferables ?? []);
    } catch (error) {
      this.pendingTasks.delete(task.request.id);
      this.busyWorkers.delete(worker);
      this.idleWorkers.push(worker);
      task.reject(error);
      this.processQueue();
    }
  }

  private onWorkerMessage(worker: Worker, response: UploadWorkerResponse): void {
    const task = this.pendingTasks.get(response.id);
    if (task) {
      if (response.success) {
        task.resolve(response);
      } else {
        task.reject(new Error(response.error || 'Upload worker failed'));
      }
      this.pendingTasks.delete(response.id);
    }

    this.busyWorkers.delete(worker);
    this.idleWorkers.push(worker);
    this.processQueue();
  }

  private onWorkerError(worker: Worker): void {
    if (this.busyWorkers.has(worker)) {
      this.busyWorkers.delete(worker);
      this.idleWorkers.push(worker);
    }
    this.processQueue();
  }
}

export const uploadWorkerPool = new UploadWorkerPool();
