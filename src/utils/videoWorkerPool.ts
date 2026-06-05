/**
 * Video Worker Pool Manager
 * 
 * Manages a single Web Worker for video processing with FFmpeg.wasm.
 * Unlike the image worker pool, we use a single worker because FFmpeg.wasm
 * handles its own internal threading and doesn't benefit from multiple instances.
 */

import type { 
  VideoWorkerRequest, 
  VideoWorkerResponse, 
  ExtractionOptions,
  ExtractionProgress,
  VideoInfo,
  TrimExportOptions,
} from '../types/video';

type ProgressCallback = (progress: ExtractionProgress) => void;
type FrameCallback = (frame: { index: number; timestamp: number; blob: Blob }) => void;
type InfoCallback = (info: VideoInfo) => void;

interface PendingRequest {
  resolve: (value: VideoWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  onProgress?: ProgressCallback;
  onFrame?: FrameCallback;
  onInfo?: InfoCallback;
}

class VideoWorkerPool {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private initialized = false;

  /** Single-threaded @ffmpeg/core only needs Web Workers (not SharedArrayBuffer). */
  isSupported(): boolean {
    return typeof Worker !== 'undefined';
  }

  private initWorker(): void {
    if (this.initialized || !this.isSupported()) return;

    this.worker = new Worker(
      new URL('../workers/videoWorker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (event: MessageEvent<VideoWorkerResponse>) => {
      this.handleResponse(event.data);
    };

    this.worker.onerror = (error) => {
      console.error('Video worker error:', error);
      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error(`Worker error: ${error.message}`));
        this.pendingRequests.delete(id);
      }
    };

    this.initialized = true;
  }

  private handleResponse(response: VideoWorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    switch (response.type) {
      case 'progress':
        if (pending.onProgress && response.progress) {
          pending.onProgress(response.progress);
        }
        break;

      case 'frame':
        if (pending.onFrame && response.frame) {
          const bytes =
            response.frame.data instanceof Uint8Array
              ? response.frame.data
              : new Uint8Array(response.frame.data);
          const blob = new Blob([bytes], { type: response.frame.mimeType });
          pending.onFrame({
            index: response.frame.index,
            timestamp: response.frame.timestamp,
            blob,
          });
        }
        break;

      case 'info':
        if (pending.onInfo && response.info) {
          pending.onInfo(response.info);
        }
        pending.resolve(response);
        this.pendingRequests.delete(response.id);
        break;

      case 'complete':
      case 'cancelled':
      case 'trimComplete':
        pending.resolve(response);
        this.pendingRequests.delete(response.id);
        break;

      case 'error':
        pending.reject(new Error(response.error || 'Unknown error'));
        this.pendingRequests.delete(response.id);
        break;
    }
  }

  private generateId(): string {
    return `video-${Date.now()}-${++this.requestCounter}`;
  }

  /**
   * Probe a video file to get its information (duration, dimensions)
   */
  async probeVideo(
    videoFile: File,
    onInfo?: InfoCallback
  ): Promise<VideoInfo> {
    if (!this.isSupported()) {
      throw new Error('Video processing is not supported in this browser');
    }

    this.initWorker();
    if (!this.worker) {
      throw new Error('Failed to initialize video worker');
    }

    const id = this.generateId();
    const videoData = await videoFile.arrayBuffer();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.info) {
            resolve(response.info);
          } else {
            reject(new Error('No video info returned'));
          }
        },
        reject,
        onInfo
      });

      const request: VideoWorkerRequest = {
        id,
        type: 'probe',
        videoData,
        fileName: videoFile.name
      };

      this.worker!.postMessage(request, [videoData]);
    });
  }

  /**
   * Extract frames from a video file
   */
  async extractFrames(
    videoFile: File,
    options: ExtractionOptions,
    callbacks: {
      onProgress?: ProgressCallback;
      onFrame?: FrameCallback;
    }
  ): Promise<{ framesExtracted: number; cancelled: boolean }> {
    if (!this.isSupported()) {
      throw new Error('Video processing is not supported in this browser');
    }

    this.initWorker();
    if (!this.worker) {
      throw new Error('Failed to initialize video worker');
    }

    const id = this.generateId();
    const videoData = await videoFile.arrayBuffer();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          resolve({
            framesExtracted: response.framesExtracted || 0,
            cancelled: response.type === 'cancelled'
          });
        },
        reject,
        onProgress: callbacks.onProgress,
        onFrame: callbacks.onFrame
      });

      const request: VideoWorkerRequest = {
        id,
        type: 'extract',
        videoData,
        fileName: videoFile.name,
        options
      };

      this.worker!.postMessage(request, [videoData]);
    });
  }

  /**
   * Export a trimmed clip from a video file
   */
  async trimVideo(
    videoFile: File,
    trimOptions: TrimExportOptions,
    onProgress?: ProgressCallback,
  ): Promise<{ blob: Blob; fileName: string }> {
    if (!this.isSupported()) {
      throw new Error('Video processing is not supported in this browser');
    }

    this.initWorker();
    if (!this.worker) {
      throw new Error('Failed to initialize video worker');
    }

    const id = this.generateId();
    const videoData = await videoFile.arrayBuffer();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.type === 'trimComplete' && response.trimVideo) {
            const bytes =
              response.trimVideo.data instanceof Uint8Array
                ? response.trimVideo.data
                : new Uint8Array(response.trimVideo.data);
            resolve({
              blob: new Blob([bytes], { type: response.trimVideo.mimeType }),
              fileName: response.trimVideo.fileName,
            });
          } else if (response.type === 'cancelled') {
            reject(new Error('Trim cancelled'));
          } else {
            reject(new Error('No trimmed video returned'));
          }
        },
        reject,
        onProgress,
      });

      const request: VideoWorkerRequest = {
        id,
        type: 'trim',
        videoData,
        fileName: videoFile.name,
        trimOptions,
      };

      this.worker!.postMessage(request, [videoData]);
    });
  }

  /**
   * Cancel the current extraction
   */
  cancel(): void {
    if (!this.worker) return;

    // Send cancel request to all pending extractions
    for (const [id] of this.pendingRequests) {
      const request: VideoWorkerRequest = {
        id,
        type: 'cancel'
      };
      this.worker.postMessage(request);
    }
  }

  /**
   * Terminate the worker and clean up
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.initialized = false;
    }
    this.pendingRequests.clear();
  }
}

export const videoWorkerPool = new VideoWorkerPool();
