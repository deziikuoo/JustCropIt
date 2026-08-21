/**
 * Detection Worker Pool — singleton worker for MediaPipe portrait / identity.
 */

import { DETECTION_IDLE_TERMINATE_MS, DETECTION_WORKER_POOL_MAX } from '../constants/optimization';
import type {
  DetectionWorkerRequest,
  DetectionWorkerResponse,
} from '../types/detection';
import { resetFaceDetectorSession } from './faceDetectorSession';
import { resetFaceLandmarkerSession } from './faceLandmarkerSession';
import { resetPoseLandmarkerSession } from './poseLandmarkerSession';
import { shutdownIdentityRuntime } from './identityWorkerPool';

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
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  isSupported(): boolean {
    return (
      typeof Worker !== 'undefined' &&
      typeof createImageBitmap !== 'undefined'
    );
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
      this.scheduleIdleTerminate();
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
      if (this.pendingRequests.size === 0) this.scheduleIdleTerminate();
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.type === 'error') {
      pending.reject(new Error(response.error ?? 'Detection failed'));
      if (this.pendingRequests.size === 0) this.scheduleIdleTerminate();
      return;
    }

    if (response.type === 'cancelled') {
      pending.reject(new Error('Detection cancelled'));
      if (this.pendingRequests.size === 0) this.scheduleIdleTerminate();
      return;
    }

    pending.resolve(response);
    if (this.pendingRequests.size === 0) this.scheduleIdleTerminate();
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
      this.clearIdleTimer();

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

  async warmup(): Promise<void> {
    await this.submitTask({ type: 'warmup' });
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
    if (this.pendingRequests.size === 0) this.scheduleIdleTerminate();
  }

  cancelForPhoto(photoId: string): void {
    this.cancelledPhotoIds.add(photoId);
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
    this.clearIdleTimer();
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
    resetPoseLandmarkerSession();
    resetFaceLandmarkerSession();
    resetFaceDetectorSession();
  }

  get maxWorkers(): number {
    return DETECTION_WORKER_POOL_MAX;
  }
}

export const detectionWorkerPool = new DetectionWorkerPool();

export function shutdownDetectionRuntime(): void {
  detectionWorkerPool.terminate();
  shutdownIdentityRuntime();
}
