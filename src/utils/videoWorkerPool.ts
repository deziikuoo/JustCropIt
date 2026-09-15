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
  TimelineRenderProgressWire,
} from '../types/video';
import type { ClipRenderSpec } from '../types/videoEdit';
import { isWebCodecsSupported } from './webCodecs/support';
import { getFfmpegWorkerPoolSize } from '../constants/optimization';

type ProgressCallback = (progress: ExtractionProgress) => void;
type FrameCallback = (frame: { index: number; timestamp: number; blob: Blob }) => void;
type InfoCallback = (info: VideoInfo) => void;
type TimelineProgressCallback = (progress: TimelineRenderProgressWire) => void;

interface PendingRequest {
  resolve: (value: VideoWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  onProgress?: ProgressCallback;
  onFrame?: FrameCallback;
  onInfo?: InfoCallback;
  onTimelineProgress?: TimelineProgressCallback;
  workerKind: 'webcodecs' | 'ffmpeg';
  /** Set when this request was dispatched to a pooled export worker rather
   * than the singleton `ffmpegWorker` — cancel() routes to this instead. */
  workerRef?: Worker;
}

interface RenderedClip {
  index: number;
  data: Uint8Array;
  mimeType: string;
}

class VideoWorkerPool {
  private webCodecsWorker: Worker | null = null;
  private ffmpegWorker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private webCodecsInitialized = false;
  private ffmpegInitialized = false;
  /** Ephemeral — only spun up for the duration of a parallel export, then torn down. */
  private ffmpegPoolWorkers: Worker[] = [];

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
        if (pending.onTimelineProgress && response.timelineProgress) {
          pending.onTimelineProgress(response.timelineProgress);
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
      case 'renderClipComplete':
      case 'exportTimelineComplete':
      case 'renderClipBatchComplete':
      case 'concatClipsComplete':
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

  private createFfmpegPoolWorker(label: string): Worker {
    const worker = new Worker(
      new URL('../workers/videoWorker.ts', import.meta.url),
      { type: 'module' }
    );
    this.bindWorker(worker, label);
    return worker;
  }

  /** Grows the export pool to `size` workers (each an independent FFmpeg instance). */
  private ensureFfmpegPool(size: number): Worker[] {
    while (this.ffmpegPoolWorkers.length < size) {
      this.ffmpegPoolWorkers.push(
        this.createFfmpegPoolWorker(`FFmpeg-Pool-${this.ffmpegPoolWorkers.length}`)
      );
    }
    return this.ffmpegPoolWorkers.slice(0, size);
  }

  /** Frees the (memory-heavy) pool workers once a parallel export finishes. */
  private terminateFfmpegPool(): void {
    for (const worker of this.ffmpegPoolWorkers) {
      worker.terminate();
    }
    this.ffmpegPoolWorkers = [];
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
   * Render a single timeline clip (crop/speed/reverse/freeze) via FFmpeg.
   * Used by the Edit tab preview to pre-render reversed clips.
   */
  async renderClip(
    videoFile: File,
    clip: ClipRenderSpec,
    onProgress?: ProgressCallback
  ): Promise<{ blob: Blob; fileName: string }> {
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
          if (response.type === 'renderClipComplete' && response.renderedClip) {
            const bytes =
              response.renderedClip.data instanceof Uint8Array
                ? response.renderedClip.data
                : new Uint8Array(response.renderedClip.data);
            resolve({
              blob: new Blob([bytes], { type: response.renderedClip.mimeType }),
              fileName: response.renderedClip.fileName,
            });
          } else if (response.type === 'cancelled') {
            reject(new Error('Render cancelled'));
          } else {
            reject(new Error('No rendered clip returned'));
          }
        },
        reject,
        onProgress,
        workerKind: 'ffmpeg',
      });

      const request: VideoWorkerRequest = {
        id,
        type: 'renderClip',
        videoData,
        fileName: videoFile.name,
        renderClipOptions: { clip },
      };

      this.ffmpegWorker!.postMessage(request, [videoData]);
    });
  }

  /**
   * Render every clip in the timeline and concatenate them into one final video.
   * Uses a pool of parallel FFmpeg workers when there are enough clips to make
   * it worthwhile (see `getFfmpegWorkerPoolSize`); otherwise renders sequentially
   * on the single persistent FFmpeg worker.
   */
  async exportTimeline(
    videoFile: File,
    clips: ClipRenderSpec[],
    onTimelineProgress?: TimelineProgressCallback
  ): Promise<{ blob: Blob; fileName: string }> {
    if (typeof Worker === 'undefined') {
      throw new Error('Video processing is not supported in this browser');
    }

    const poolSize = getFfmpegWorkerPoolSize(clips.length);
    if (poolSize <= 1) {
      return this.exportTimelineSequential(videoFile, clips, onTimelineProgress);
    }

    try {
      return await this.exportTimelineParallel(videoFile, clips, poolSize, onTimelineProgress);
    } catch (err) {
      // A real user cancellation should propagate as-is, not trigger a silent
      // (and wasteful) full re-render on the sequential path.
      if (err instanceof Error && err.message === 'Export cancelled') {
        throw err;
      }
      console.warn('[VideoWorkerPool] Parallel export failed, retrying sequentially:', err);
      return this.exportTimelineSequential(videoFile, clips, onTimelineProgress);
    }
  }

  /** Renders every clip on a single FFmpeg worker, one at a time, then concatenates. */
  private async exportTimelineSequential(
    videoFile: File,
    clips: ClipRenderSpec[],
    onTimelineProgress?: TimelineProgressCallback
  ): Promise<{ blob: Blob; fileName: string }> {
    this.initFfmpegWorker();
    if (!this.ffmpegWorker) {
      throw new Error('Failed to initialize FFmpeg worker');
    }

    const id = this.generateId();
    const videoData = await videoFile.arrayBuffer();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.type === 'exportTimelineComplete' && response.exportedTimeline) {
            const bytes =
              response.exportedTimeline.data instanceof Uint8Array
                ? response.exportedTimeline.data
                : new Uint8Array(response.exportedTimeline.data);
            resolve({
              blob: new Blob([bytes], { type: response.exportedTimeline.mimeType }),
              fileName: response.exportedTimeline.fileName,
            });
          } else if (response.type === 'cancelled') {
            reject(new Error('Export cancelled'));
          } else {
            reject(new Error('No exported video returned'));
          }
        },
        reject,
        onTimelineProgress,
        workerKind: 'ffmpeg',
      });

      const request: VideoWorkerRequest = {
        id,
        type: 'exportTimeline',
        videoData,
        fileName: videoFile.name,
        exportTimelineOptions: { clips },
      };

      this.ffmpegWorker!.postMessage(request, [videoData]);
    });
  }

  /**
   * Splits `clips` into `poolSize` contiguous batches, renders each batch on
   * its own worker in parallel, then joins every rendered clip (in original
   * order) via the singleton FFmpeg worker. The pool is torn down afterward —
   * it's only worth the memory while an export is actively running.
   */
  private async exportTimelineParallel(
    videoFile: File,
    clips: ClipRenderSpec[],
    poolSize: number,
    onTimelineProgress?: TimelineProgressCallback
  ): Promise<{ blob: Blob; fileName: string }> {
    try {
      const workers = this.ensureFfmpegPool(poolSize);
      const totalClips = clips.length;
      const batchSize = Math.ceil(totalClips / workers.length);
      const sourceBuffer = await videoFile.arrayBuffer();
      const batches: { clips: ClipRenderSpec[]; startIndex: number; worker: Worker }[] = [];
      for (let w = 0; w < workers.length; w++) {
        const startIndex = w * batchSize;
        if (startIndex >= totalClips) break;
        const batchClips = clips.slice(startIndex, startIndex + batchSize);
        if (batchClips.length === 0) continue;
        batches.push({ clips: batchClips, startIndex, worker: workers[w] });
      }

      const progressByBatch = new Map<number, number>();
      const reportProgress = (batchIndex: number, completedInBatch: number) => {
        progressByBatch.set(batchIndex, completedInBatch);
        let completed = 0;
        for (const v of progressByBatch.values()) completed += v;
        onTimelineProgress?.({
          phase: 'rendering',
          currentClip: completed,
          totalClips,
          percent: Math.round((completed / totalClips) * 80),
          message: `Rendering clips... (${completed}/${totalClips})`,
        });
      };

      const batchResults = await Promise.all(
        batches.map((batch, batchIndex) =>
          this.renderClipBatchOnWorker(
            batch.worker,
            videoFile.name,
            sourceBuffer,
            batch,
            totalClips,
            (p) => {
              reportProgress(batchIndex, Math.max(0, p.currentClip - batch.startIndex));
            }
          )
        )
      );

      const ordered = batchResults.flat().sort((a, b) => a.index - b.index);

      onTimelineProgress?.({
        phase: 'concatenating',
        currentClip: totalClips,
        totalClips,
        percent: 85,
        message: 'Joining clips...',
      });

      return await this.concatClipsOnWorker(
        videoFile.name,
        ordered.map((r) => r.data),
        onTimelineProgress
      );
    } finally {
      this.terminateFfmpegPool();
    }
  }

  /** Renders one worker's contiguous batch of clips, returning every buffer tagged with its global index. */
  private async renderClipBatchOnWorker(
    worker: Worker,
    fileName: string,
    sourceBuffer: ArrayBuffer,
    batch: { clips: ClipRenderSpec[]; startIndex: number },
    totalClips: number,
    onProgress: (progress: TimelineRenderProgressWire) => void
  ): Promise<RenderedClip[]> {
    const id = this.generateId();
    const videoData = sourceBuffer.slice(0);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.type === 'renderClipBatchComplete' && response.renderedClipBatch) {
            resolve(
              response.renderedClipBatch.clips.map((c) => ({
                index: c.index,
                mimeType: c.mimeType,
                data: c.data instanceof Uint8Array ? c.data : new Uint8Array(c.data),
              }))
            );
          } else if (response.type === 'cancelled') {
            reject(new Error('Export cancelled'));
          } else {
            reject(new Error('No rendered clip batch returned'));
          }
        },
        reject,
        onTimelineProgress: onProgress,
        workerKind: 'ffmpeg',
        workerRef: worker,
      });

      const request: VideoWorkerRequest = {
        id,
        type: 'renderClipBatch',
        videoData,
        fileName,
        renderClipBatchOptions: { clips: batch.clips, startIndex: batch.startIndex, totalClips },
      };

      worker.postMessage(request, [videoData]);
    });
  }

  /** Joins already-rendered clip buffers (in caller-supplied order) via the singleton FFmpeg worker. */
  private async concatClipsOnWorker(
    fileName: string,
    clipBuffers: Uint8Array[],
    onTimelineProgress?: TimelineProgressCallback
  ): Promise<{ blob: Blob; fileName: string }> {
    this.initFfmpegWorker();
    if (!this.ffmpegWorker) {
      throw new Error('Failed to initialize FFmpeg worker');
    }
    const worker = this.ffmpegWorker;

    const id = this.generateId();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.type === 'concatClipsComplete' && response.concatenatedTimeline) {
            const bytes =
              response.concatenatedTimeline.data instanceof Uint8Array
                ? response.concatenatedTimeline.data
                : new Uint8Array(response.concatenatedTimeline.data);
            resolve({
              blob: new Blob([bytes], { type: response.concatenatedTimeline.mimeType }),
              fileName: response.concatenatedTimeline.fileName,
            });
          } else if (response.type === 'cancelled') {
            reject(new Error('Export cancelled'));
          } else {
            reject(new Error('No joined video returned'));
          }
        },
        reject,
        onTimelineProgress,
        workerKind: 'ffmpeg',
      });

      const request: VideoWorkerRequest = {
        id,
        type: 'concatClips',
        fileName,
        concatClipsOptions: { clipBuffers },
      };

      worker.postMessage(
        request,
        clipBuffers.map((b) => b.buffer)
      );
    });
  }

  /**
   * Warm FFmpeg WASM in the background so the first clip render/export
   * is not blocked on downloading and compiling the core.
   */
  preloadFfmpeg(): void {
    if (typeof Worker === 'undefined') return;
    this.initFfmpegWorker();
    if (!this.ffmpegWorker) return;
    const id = this.generateId();
    this.pendingRequests.set(id, {
      resolve: () => undefined,
      reject: (err) => {
        console.warn('[VideoWorkerPool] FFmpeg preload failed:', err);
      },
      workerKind: 'ffmpeg',
    });
    this.ffmpegWorker.postMessage({ id, type: 'preload' } as VideoWorkerRequest);
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
      if (pending.workerRef) {
        pending.workerRef.postMessage(request);
      } else if (pending.workerKind === 'webcodecs' && this.webCodecsWorker) {
        this.webCodecsWorker.postMessage(request);
      } else if (pending.workerKind === 'ffmpeg' && this.ffmpegWorker) {
        this.ffmpegWorker.postMessage(request);
      }
    }
    // Pool workers tear themselves down once every batch settles (see the
    // `finally` in exportTimelineParallel) — forcing it here would race their
    // in-flight `cancelled` responses and leave those promises unresolved.
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
    this.terminateFfmpegPool();
    this.pendingRequests.clear();
  }
}

export const videoWorkerPool = new VideoWorkerPool();
