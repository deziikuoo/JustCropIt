/**
 * Identity Worker Pool — singleton ArcFace ONNX worker.
 */

import { DETECTION_IDLE_TERMINATE_MS } from '../constants/optimization';
import type {
  IdentityWorkerRequest,
  IdentityWorkerResponse,
} from '../workers/identityWorker';
import { clearIdentityCache } from './identityCache';

interface PendingRequest {
  resolve: (value: IdentityWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  photoId?: string;
}

function isTransientIdentityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('terminated') || message.includes('cancelled');
}

class IdentityWorkerPool {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private cancelledPhotoIds = new Set<string>();
  private requestCounter = 0;
  private initialized = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private loadFailed = false;
  private loadError: string | null = null;
  private warmupPromise: Promise<void> | null = null;

  isSupported(): boolean {
    return (
      typeof Worker !== 'undefined' &&
      typeof createImageBitmap !== 'undefined' &&
      !this.loadFailed
    );
  }

  /** Allow another attempt after a previous load failure (e.g. cancel mid-warmup). */
  resetLoadFailure(): void {
    this.loadFailed = false;
    this.loadError = null;
  }

  getLastError(): string | null {
    return this.loadError;
  }

  private clearIdleTimer(): void {
    if (this.idleTimer != null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdleTerminate(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.terminate();
    }, DETECTION_IDLE_TERMINATE_MS);
  }

  private initWorker(): void {
    if (this.initialized || typeof Worker === 'undefined') return;

    this.worker = new Worker(
      new URL('../workers/identityWorker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (event: MessageEvent<IdentityWorkerResponse>) => {
      this.handleResponse(event.data);
    };

    this.worker.onerror = (error) => {
      console.error('[IdentityWorkerPool] Worker error:', error);
      this.loadFailed = true;
      this.loadError = error.message || 'Identity worker error';
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error(`Identity worker error: ${error.message}`));
        this.pendingRequests.delete(id);
      }
      this.scheduleIdleTerminate();
    };

    this.initialized = true;
  }

  private handleResponse(response: IdentityWorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    if (response.photoId && this.cancelledPhotoIds.has(response.photoId)) {
      this.pendingRequests.delete(response.id);
      pending.reject(new Error('Identity cancelled'));
      if (this.pendingRequests.size === 0) this.scheduleIdleTerminate();
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.type === 'error') {
      pending.reject(new Error(response.error ?? 'Identity failed'));
      if (this.pendingRequests.size === 0) this.scheduleIdleTerminate();
      return;
    }

    if (response.type === 'cancelled') {
      pending.reject(new Error('Identity cancelled'));
      if (this.pendingRequests.size === 0) this.scheduleIdleTerminate();
      return;
    }

    pending.resolve(response);
    if (this.pendingRequests.size === 0) this.scheduleIdleTerminate();
  }

  submitTask(
    request: Omit<IdentityWorkerRequest, 'id'> & { id?: string },
    transferables: Transferable[] = []
  ): Promise<IdentityWorkerResponse> {
    return new Promise((resolve, reject) => {
      if (!this.isSupported()) {
        reject(new Error(this.loadError ?? 'Identity worker not supported'));
        return;
      }

      if (!this.initialized) this.initWorker();
      this.clearIdleTimer();

      const id = request.id ?? `identity-${++this.requestCounter}`;
      const fullRequest: IdentityWorkerRequest = { ...request, id };

      if (
        fullRequest.photoId &&
        this.cancelledPhotoIds.has(fullRequest.photoId)
      ) {
        reject(new Error('Identity cancelled'));
        return;
      }

      this.pendingRequests.set(id, {
        resolve,
        reject,
        photoId: fullRequest.photoId,
      });

      this.worker!.postMessage(fullRequest, transferables);
    });
  }

  async warmup(): Promise<void> {
    if (this.warmupPromise) return this.warmupPromise;

    this.warmupPromise = this.runWarmup().finally(() => {
      this.warmupPromise = null;
    });
    return this.warmupPromise;
  }

  private async runWarmup(): Promise<void> {
    // Prior cancel/terminate mid-load must not permanently block This person.
    this.resetLoadFailure();
    try {
      const response = await this.submitTask({ type: 'warmup' });
      if (response.type !== 'success' && response.type !== 'pong') {
        throw new Error(response.error ?? 'Identity warmup failed');
      }
      this.loadFailed = false;
      this.loadError = null;
    } catch (error) {
      if (!isTransientIdentityError(error)) {
        this.loadFailed = true;
        this.loadError =
          error instanceof Error ? error.message : 'Identity warmup failed';
      }
      this.terminate();
      throw error;
    }
  }

  async embed(
    tensors: Float32Array[],
    photoId?: string
  ): Promise<{
    embeddings: Float32Array[];
    loadModelMs?: number;
    inferenceMs?: number;
  }> {
    const buffers = tensors.map((tensor) => {
      const copy = tensor.buffer.slice(
        tensor.byteOffset,
        tensor.byteOffset + tensor.byteLength
      );
      return copy;
    });
    const response = await this.submitTask(
      {
        type: 'embed',
        photoId,
        tensors: buffers,
      },
      buffers
    );
    return {
      embeddings: (response.embeddings ?? []).map((values) =>
        Float32Array.from(values)
      ),
      loadModelMs: response.loadModelMs,
      inferenceMs: response.inferenceMs,
    };
  }

  cancelForPhoto(photoId: string): void {
    this.cancelledPhotoIds.add(photoId);
    for (const [id, pending] of this.pendingRequests) {
      if (pending.photoId === photoId) {
        if (this.worker) {
          this.worker.postMessage({
            id,
            type: 'cancel',
          } satisfies IdentityWorkerRequest);
        }
        this.pendingRequests.delete(id);
        pending.reject(new Error('Identity cancelled'));
      }
    }
    if (this.pendingRequests.size === 0) this.scheduleIdleTerminate();
  }

  clearCancelledForPhoto(photoId: string): void {
    this.cancelledPhotoIds.delete(photoId);
  }

  terminate(): void {
    this.clearIdleTimer();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.initialized = false;
    }
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Identity worker terminated'));
    }
    this.pendingRequests.clear();
    this.cancelledPhotoIds.clear();
  }
}

export const identityWorkerPool = new IdentityWorkerPool();

export function shutdownIdentityRuntime(): void {
  identityWorkerPool.terminate();
  clearIdentityCache();
}
