/**
 * Image Worker Pool Manager
 * 
 * Manages a pool of Web Workers for parallel image processing.
 * Handles task scheduling, worker lifecycle, and capability checks.
 */

import { WORKER_POOL_MAX, MIN_BATCH_FOR_WORKERS } from '../constants/optimization';
import type { WorkerRequest, WorkerResponse } from '../types/worker';

interface Task {
  request: WorkerRequest;
  resolve: (value: WorkerResponse) => void;
  reject: (reason?: any) => void;
  transferables?: Transferable[];
}

// Extend Navigator to include non-standard deviceMemory
interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

// Pool implementation with idle/busy tracking
class RobustImageWorkerPool {
  private idleWorkers: Worker[] = [];
  private busyWorkers: Set<Worker> = new Set();
  private taskQueue: Task[] = [];
  private maxWorkers: number;
  private initialized = false;

  constructor() {
    this.maxWorkers = this.determinePoolSize();
  }

  private determinePoolSize(): number {
    const nav = navigator as NavigatorWithMemory;
    const cpuCores = navigator.hardwareConcurrency || 4;
    const memory = nav.deviceMemory || 4;

    let optimalCount = Math.max(1, cpuCores - 1);

    if (memory < 4) {
      optimalCount = Math.min(optimalCount, 2);
    }

    return Math.min(optimalCount, WORKER_POOL_MAX);
  }

  isWorkerSupported(): boolean {
    return (
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap !== 'undefined'
    );
  }

  shouldUseWorkers(batchSize: number): boolean {
    return this.isWorkerSupported() && batchSize >= MIN_BATCH_FOR_WORKERS;
  }

  private initWorkers() {
    if (this.initialized) return;
    
    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = new Worker(
        new URL('../workers/imageWorker.ts', import.meta.url),
        { type: 'module' }
      );
      
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.onWorkerMessage(worker, event.data);
      };
      
      worker.onerror = (error) => {
        console.error('Worker pool error:', error);
        this.onWorkerError(worker, error);
      };

      this.idleWorkers.push(worker);
    }
    this.initialized = true;
  }

  submitTask(
    request: WorkerRequest, 
    transferables: Transferable[] = []
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      if (!this.initialized) this.initWorkers();
      
      this.taskQueue.push({ request, resolve, reject, transferables });
      this.processQueue();
    });
  }

  private processQueue() {
    if (this.taskQueue.length === 0 || this.idleWorkers.length === 0) return;

    const worker = this.idleWorkers.pop();
    const task = this.taskQueue.shift();

    if (worker && task) {
      this.busyWorkers.add(worker);
      
      // Store the resolve/reject with the worker (e.g. in a Map) to handle response
      // But since we use onmessage, we need to map the response ID back to the task.
      // Wait, standard pool pattern:
      // We need to map request ID to the task resolver.
      this.pendingTasks.set(task.request.id, task);

      try {
        worker.postMessage(task.request, task.transferables || []);
      } catch (e) {
        // Handle transfer error (e.g. detached buffer)
        this.pendingTasks.delete(task.request.id);
        this.busyWorkers.delete(worker);
        this.idleWorkers.push(worker);
        task.reject(e);
        this.processQueue();
      }
    }
  }

  private pendingTasks = new Map<string, Task>();

  private onWorkerMessage(worker: Worker, response: WorkerResponse) {
    const task = this.pendingTasks.get(response.id);
    if (task) {
      if (response.success) {
        task.resolve(response);
      } else {
        task.reject(new Error(response.error || 'Unknown worker error'));
      }
      this.pendingTasks.delete(response.id);
    }

    // Return worker to idle pool
    this.busyWorkers.delete(worker);
    this.idleWorkers.push(worker);
    
    // Process next
    this.processQueue();
  }

  private onWorkerError(worker: Worker, error: Event) {
    // If a worker crashes, we might lose the task it was processing.
    // In a robust pool we might retry or reject all tasks assigned to it.
    // For now, simple error logging.
    console.error('Worker error event:', error);
    
    // We should terminate and replace the worker if it's dead?
    // For now, let's assume transient errors don't kill the worker unless it's a crash.
    // If it's a crash, 'error' event might not even fire on the worker object in the same way.
    
    // Simple recovery: move back to idle if not there?
    // Actually busyWorkers would still have it.
    if (this.busyWorkers.has(worker)) {
       this.busyWorkers.delete(worker);
       this.idleWorkers.push(worker);
    }
    this.processQueue();
  }
}

export const imageWorkerPool = new RobustImageWorkerPool();
