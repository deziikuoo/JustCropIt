/**
 * Video Worker Pool Manager
 *
 * Routes probe + extract to the WebCodecs worker (hardware decode when available).
 * Routes trim export to the FFmpeg worker (lazy-loaded on first trim).
 */

import type {
  VideoWorkerRequest,
  VideoWorkerResponse,
  ExtractionOptions,
  ExtractionProgress,
  VideoInfo,
  TrimExportOptions,
} from '../types/video';
import { isWebCodecsSupported } from './webCodecs/support';

type ProgressCallback = (progress: ExtractionProgress) => void;
type FrameCallback = (frame: { index: number; timestamp: number; blob: Blob }) => void;
type InfoCallback = (info: VideoInfo) => void;

interface PendingRequest {
  resolve: (value: VideoWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  onProgress?: ProgressCallback;
  onFrame?: FrameCallback;
  onInfo?: InfoCallback;
  workerKind: 'webcodecs' | 'ffmpeg';
}

class VideoWorkerPool {
  private webCodecsWorker: Worker | null = null;
  private ffmpegWorker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private webCodecsInitialized = false;
  private ffmpegInitialized = false;

  /** WebCodecs path needs Worker + VideoDecoder + OffscreenCanvas. */
  isSupported(): boolean {
    return isWebCodecsSupported();
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

  private bindWorker(worker: Worker, label: string): void {
    worker.onmessage = (event: MessageEvent<VideoWorkerResponse>) => {
      this.handleResponse(event.data);
    };

    worker.onerror = (error) => {
      console.error(`${label} worker error:`, error);
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error(`Worker error: ${error.message}`));
        this.pendingRequests.delete(id);
      }
    };
  }

  private initWebCodecsWorker(): void {
    if (this.webCodecsInitialized || !this.isSupported()) return;

    this.webCodecsWorker = new Worker(
      new URL('../workers/webCodecsWorker.ts', import.meta.url),
      { type: 'module' }
    );
    this.bindWorker(this.webCodecsWorker, 'WebCodecs');
    this.webCodecsInitialized = true;
  }

  private initFfmpegWorker(): void {
    if (this.ffmpegInitialized) return;

    this.ffmpegWorker = new Worker(
      new URL('../workers/videoWorker.ts', import.meta.url),
      { type: 'module' }
    );
    this.bindWorker(this.ffmpegWorker, 'FFmpeg');
    this.ffmpegInitialized = true;
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

    this.initWebCodecsWorker();
    if (!this.webCodecsWorker) {
      throw new Error('Failed to initialize WebCodecs worker');
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
        onInfo,
        workerKind: 'webcodecs',
      });

      const request: VideoWorkerRequest = {
        id,
        type: 'probe',
        videoData,
        fileName: videoFile.name,
      };

      this.webCodecsWorker!.postMessage(request, [videoData]);
    });
  }

  /**
   * Extract frames from a video file via WebCodecs
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

    this.initWebCodecsWorker();
    if (!this.webCodecsWorker) {
      throw new Error('Failed to initialize WebCodecs worker');
    }

    const id = this.generateId();
    const videoData = await videoFile.arrayBuffer();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          resolve({
            framesExtracted: response.framesExtracted || 0,
            cancelled: response.type === 'cancelled',
          });
        },
        reject,
        onProgress: callbacks.onProgress,
        onFrame: callbacks.onFrame,
        workerKind: 'webcodecs',
      });

      const request: VideoWorkerRequest = {
        id,
        type: 'extract',
        videoData,
        fileName: videoFile.name,
        options,
      };

      this.webCodecsWorker!.postMessage(request, [videoData]);
    });
  }

  /**
   * Export a trimmed clip from a video file (FFmpeg)
   */
  async trimVideo(
    videoFile: File,
    trimOptions: TrimExportOptions,
    onProgress?: ProgressCallback
  ): Promise<{ blob: Blob; fileName: string }> {
    // Trim uses FFmpeg.wasm — only needs Worker support
    if (typeof Worker === 'undefined') {
      throw new Error('Video processing is not supported in this browser');
    }

    this.initFfmpegWorker();
    if (!this.ffmpegWorker) {
      throw new Error('Failed to initialize FFmpeg worker');
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
        workerKind: 'ffmpeg',
      });

      const request: VideoWorkerRequest = {
        id,
        type: 'trim',
        videoData,
        fileName: videoFile.name,
        trimOptions,
      };

      this.ffmpegWorker!.postMessage(request, [videoData]);
    });
  }

  /**
   * Cancel the current extraction / trim
   */
  cancel(): void {
    for (const [id, pending] of this.pendingRequests) {
      const request: VideoWorkerRequest = {
        id,
        type: 'cancel',
      };
      if (pending.workerKind === 'webcodecs' && this.webCodecsWorker) {
        this.webCodecsWorker.postMessage(request);
      } else if (pending.workerKind === 'ffmpeg' && this.ffmpegWorker) {
        this.ffmpegWorker.postMessage(request);
      }
    }
  }

  /**
   * Terminate workers and clean up
   */
  terminate(): void {
    if (this.webCodecsWorker) {
      this.webCodecsWorker.terminate();
      this.webCodecsWorker = null;
      this.webCodecsInitialized = false;
    }
    if (this.ffmpegWorker) {
      this.ffmpegWorker.terminate();
      this.ffmpegWorker = null;
      this.ffmpegInitialized = false;
    }
    this.pendingRequests.clear();
  }
}

export const videoWorkerPool = new VideoWorkerPool();
