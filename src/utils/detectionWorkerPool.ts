/**
 * Detection Worker Pool — singleton worker for ML face detection (Phase 4).
 */

import { DETECTION_WORKER_POOL_MAX } from '../constants/optimization';
import type {
  DetectionWorkerRequest,
  DetectionWorkerResponse,
} from '../types/detection';

interface PendingRequest {
  resolve: (value: DetectionWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  photoId?: string;
}

class DetectionWorkerPool {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private cancelledPhotoIds = new Set<string>();
  private requestCounter = 0;
  private initialized = false;

  isSupported(): boolean {
    return (
      typeof Worker !== 'undefined' &&
      typeof createImageBitmap !== 'undefined'
    );
  }

  private initWorker(): void {
    if (this.initialized || !this.isSupported()) return;

    this.worker = new Worker(
      new URL('../workers/detectionWorker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (event: MessageEvent<DetectionWorkerResponse>) => {
      this.handleResponse(event.data);
    };

    this.worker.onerror = (error) => {
      console.error('[DetectionWorkerPool] Worker error:', error);
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error(`Detection worker error: ${error.message}`));
        this.pendingRequests.delete(id);
      }
    };

    this.initialized = true;
  }

  private handleResponse(response: DetectionWorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    if (
      response.photoId &&
      this.cancelledPhotoIds.has(response.photoId)
    ) {
      this.pendingRequests.delete(response.id);
      pending.reject(new Error('Detection cancelled'));
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.type === 'error') {
      pending.reject(new Error(response.error ?? 'Detection failed'));
      return;
    }

    if (response.type === 'cancelled') {
      pending.reject(new Error('Detection cancelled'));
      return;
    }

    pending.resolve(response);
  }

  submitTask(
    request: Omit<DetectionWorkerRequest, 'id'> & { id?: string },
    transferables: Transferable[] = []
  ): Promise<DetectionWorkerResponse> {
    return new Promise((resolve, reject) => {
      if (!this.isSupported()) {
        reject(new Error('Detection worker not supported'));
        return;
      }

      if (!this.initialized) this.initWorker();

      const id = request.id ?? `detect-${++this.requestCounter}`;
      const fullRequest: DetectionWorkerRequest = { ...request, id };

      if (
        fullRequest.photoId &&
        this.cancelledPhotoIds.has(fullRequest.photoId)
      ) {
        reject(new Error('Detection cancelled'));
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

  async ping(): Promise<boolean> {
    try {
      const response = await this.submitTask({ type: 'ping' });
      return response.type === 'pong';
    } catch {
      return false;
    }
  }

  cancelRequest(requestId: string): void {
    if (!this.worker) return;
    this.worker.postMessage({
      id: requestId,
      type: 'cancel',
    } satisfies DetectionWorkerRequest);
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      this.pendingRequests.delete(requestId);
      pending.reject(new Error('Detection cancelled'));
    }
  }

  cancelForPhoto(photoId: string): void {
    for (const [id, pending] of this.pendingRequests) {
      if (pending.photoId === photoId) {
        this.cancelRequest(id);
      }
    }
  }

  clearCancelledForPhoto(photoId: string): void {
    this.cancelledPhotoIds.delete(photoId);
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.initialized = false;
    }
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Detection worker terminated'));
    }
    this.pendingRequests.clear();
    this.cancelledPhotoIds.clear();
  }

  get maxWorkers(): number {
    return DETECTION_WORKER_POOL_MAX;
  }
}

export const detectionWorkerPool = new DetectionWorkerPool();
