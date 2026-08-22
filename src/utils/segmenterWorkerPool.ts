/**
 * Segmenter Worker Pool — singleton worker for MagicTouch inference.
 */

import { DETECTION_IDLE_TERMINATE_MS } from '../constants/optimization';
import type {
  SegmentWorkerRequest,
  SegmentWorkerResponse,
} from '../types/segmentWorker';
import type { NormalizedKeypoint } from './objectMaskCrop';
import type { SegmentMaskPayload } from './interactiveSegmenterSession';
import type { BoundingBox } from '../types/detection';
import {
  isInteractiveSegmenterSupported,
  preloadInteractiveSegmenterRuntime,
  segmentAtRoiInBitmap,
} from './interactiveSegmenterSession';

interface PendingRequest {
  resolve: (value: SegmentWorkerResponse) => void;
  reject: (reason?: unknown) => void;
}

export interface ObjectSegmentResult {
  bounds: BoundingBox | null;
  areaRatio: number;
  keypoint: NormalizedKeypoint;
  mask: SegmentMaskPayload | null;
  imageWidth: number;
  imageHeight: number;
}

class SegmenterWorkerPool {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private initialized = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private workerFailed = false;
  private warmupPromise: Promise<void> | null = null;

  isSupported(): boolean {
    return isInteractiveSegmenterSupported() && !this.workerFailed;
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
      new URL('../workers/segmenterWorker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (event: MessageEvent<SegmentWorkerResponse>) => {
      this.handleResponse(event.data);
    };

    this.worker.onerror = (error) => {
      console.warn('[SegmenterWorkerPool] Worker error, using main thread:', error);
      this.workerFailed = true;
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error(`Segmenter worker error: ${error.message}`));
        this.pendingRequests.delete(id);
      }
      this.terminate();
    };

    this.initialized = true;
  }

  private handleResponse(response: SegmentWorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;
    this.pendingRequests.delete(response.id);

    if (response.type === 'error') {
      pending.reject(new Error(response.error ?? 'Segmenter worker error'));
    } else {
      pending.resolve(response);
    }

    if (this.pendingRequests.size === 0) {
      this.scheduleIdleTerminate();
    }
  }

  private nextId(): string {
    this.requestCounter += 1;
    return `segment-${this.requestCounter}-${Date.now()}`;
  }

  private postRequest(request: SegmentWorkerRequest): Promise<SegmentWorkerResponse> {
    this.initWorker();
    if (!this.worker || this.workerFailed) {
      return Promise.reject(new Error('Segmenter worker unavailable'));
    }

    this.clearIdleTimer();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, { resolve, reject });
      this.worker!.postMessage(request);
    });
  }

  async warmup(): Promise<void> {
    if (this.warmupPromise) return this.warmupPromise;

    this.warmupPromise = (async () => {
      if (this.workerFailed || typeof Worker === 'undefined') {
        await preloadInteractiveSegmenterRuntime();
        return;
      }
      try {
        const id = this.nextId();
        await this.postRequest({ id, type: 'warmup' });
      } catch {
        this.workerFailed = true;
        await preloadInteractiveSegmenterRuntime();
      }
    })();

    return this.warmupPromise;
  }

  terminate(): void {
    this.clearIdleTimer();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.initialized = false;
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Segmenter worker terminated'));
    }
    this.pendingRequests.clear();
  }

  private async bitmapToPngBuffer(bitmap: ImageBitmap): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { buffer: await blob.arrayBuffer(), mimeType: blob.type };
  }

  private async segmentViaWorker(
    bitmap: ImageBitmap,
    roi: { keypoint?: NormalizedKeypoint; scribble?: NormalizedKeypoint[] },
    photoId?: string,
    guided = false
  ): Promise<ObjectSegmentResult> {
    const { buffer, mimeType } = await this.bitmapToPngBuffer(bitmap);
    const id = this.nextId();
    const response = await this.postRequest({
      id,
      type: 'segment',
      photoId,
      imageData: buffer,
      mimeType,
      keypoint: roi.keypoint,
      scribble: roi.scribble,
      guided,
    });

    if (response.type === 'cancelled') {
      throw new Error('Segmentation cancelled');
    }

    return {
      bounds: response.bounds ?? null,
      areaRatio: response.areaRatio ?? 0,
      keypoint: response.keypoint ?? roi.keypoint ?? { x: 0.5, y: 0.5 },
      mask: response.mask ?? null,
      imageWidth: response.imageWidth ?? bitmap.width,
      imageHeight: response.imageHeight ?? bitmap.height,
    };
  }

  private async segmentViaMainThread(
    bitmap: ImageBitmap,
    roi: { keypoint?: NormalizedKeypoint; scribble?: NormalizedKeypoint[] },
    guided = false
  ): Promise<ObjectSegmentResult> {
    const result = await segmentAtRoiInBitmap(bitmap, roi, { guided });
    return {
      bounds: result.bounds,
      areaRatio: result.areaRatio,
      keypoint: result.keypoint,
      mask: result.mask,
      imageWidth: bitmap.width,
      imageHeight: bitmap.height,
    };
  }

  async segmentBitmapAtKeypoint(
    bitmap: ImageBitmap,
    keypoint: NormalizedKeypoint,
    photoId?: string
  ): Promise<ObjectSegmentResult> {
    return this.segmentBitmapAtRoi(bitmap, { keypoint }, photoId, false);
  }

  async segmentBitmapAtRoi(
    bitmap: ImageBitmap,
    roi: { keypoint?: NormalizedKeypoint; scribble?: NormalizedKeypoint[] },
    photoId?: string,
    guided = false
  ): Promise<ObjectSegmentResult> {
    if (guided || roi.scribble?.length) {
      return this.segmentViaMainThread(bitmap, roi, true);
    }

    if (this.workerFailed || typeof Worker === 'undefined') {
      return this.segmentViaMainThread(bitmap, roi, guided);
    }

    try {
      return await this.segmentViaWorker(bitmap, roi, photoId, guided);
    } catch (error) {
      console.warn('[SegmenterWorkerPool] Worker segment failed, main thread fallback:', error);
      this.workerFailed = true;
      return this.segmentViaMainThread(bitmap, roi, guided);
    }
  }
}

export const segmenterWorkerPool = new SegmenterWorkerPool();

export function preloadSegmenterRuntime(): Promise<void> {
  return segmenterWorkerPool.warmup();
}
