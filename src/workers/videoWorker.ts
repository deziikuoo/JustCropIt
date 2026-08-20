/**
 * Video Processing Web Worker (FFmpeg.trim only)
 *
 * Active path: trim export via FFmpeg.wasm.
 * Probe + frame extraction moved to webCodecsWorker.ts (WebCodecs + web-demuxer).
 *
 * To re-enable FFmpeg probe/extract:
 * 1. Uncomment the LEGACY_FFMPEG_EXTRACTION block below
 * 2. Route probe/extract back to this worker in videoWorkerPool.ts
 */

/// <reference lib="webworker" />

import { FFmpeg } from '@ffmpeg/ffmpeg';
import ffmpegWorkerUrl from '@ffmpeg/ffmpeg/worker?url';
import type {
  VideoWorkerRequest,
  VideoWorkerResponse,
  ExtractionProgress,
  TrimExportOptions,
} from '../types/video';

const FFMPEG_CORE_VERSION = '0.12.6';

// Timing constants for memory management
const DELAY_AFTER_TERMINATE_MS = 100;

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let ffmpeg: FFmpeg | null = null;
let isLoaded = false;
let isCancelled = false;

const recentLogs: string[] = [];
const MAX_RECENT_LOGS = 15;

function recordLog(message: string): void {
  recentLogs.push(message);
  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs.shift();
  }
}

function getRecentLogs(): string {
  return recentLogs.slice(-8).join(' | ');
}

function copyBuffer(source: ArrayBuffer | Uint8Array): Uint8Array {
  if (source instanceof Uint8Array) {
    return source.slice();
  }
  return new Uint8Array(source).slice();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resetFFmpeg(): Promise<void> {
  if (ffmpeg) {
    try {
      ffmpeg.terminate();
    } catch (e) {
      console.warn('[FFmpeg] Terminate warning:', e);
    }
    ffmpeg = null;
    isLoaded = false;
  }

  await delay(DELAY_AFTER_TERMINATE_MS);
  await loadFFmpeg();

  if (!ffmpeg || !isLoaded) {
    throw new Error('Failed to reset FFmpeg instance');
  }
}

async function loadFFmpeg(): Promise<void> {
  if (isLoaded && ffmpeg) return;

  ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    console.log('[FFmpeg]', message);
    recordLog(message);
  });

  try {
    await ffmpeg.load({
      classWorkerURL: ffmpegWorkerUrl,
      coreURL: `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm/ffmpeg-core.js`,
      wasmURL: `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm/ffmpeg-core.wasm`,
    });
    isLoaded = true;
    console.log('[FFmpeg] Loaded successfully, core version:', FFMPEG_CORE_VERSION);
  } catch (loadError) {
    ffmpeg = null;
    isLoaded = false;
    throw new Error(`Failed to load FFmpeg core: ${loadError instanceof Error ? loadError.message : String(loadError)}`);
  }
}

function sendProgress(id: string, progress: ExtractionProgress): void {
  ctx.postMessage({ id, type: 'progress', progress } as VideoWorkerResponse);
}

function sendError(id: string, error: string): void {
  ctx.postMessage({ id, type: 'error', error } as VideoWorkerResponse);
}

async function deleteFileIfExists(name: string): Promise<void> {
  if (!ffmpeg) return;
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    // file may not exist
  }
}

async function writeInputVideo(inputName: string, videoBytes: Uint8Array): Promise<void> {
  if (!ffmpeg) throw new Error('FFmpeg not loaded');
  await ffmpeg.writeFile(inputName, videoBytes.slice());
}

function getMimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    m4v: 'video/x-m4v',
  };
  return map[ext.toLowerCase()] || 'video/mp4';
}

function buildTrimmedFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot > 0) {
    return `${fileName.slice(0, dot)}_trimmed${fileName.slice(dot)}`;
  }
  return `${fileName}_trimmed.mp4`;
}

async function trimVideoExport(
  id: string,
  videoData: ArrayBuffer,
  fileName: string,
  options: TrimExportOptions,
): Promise<void> {
  isCancelled = false;

  const ext = fileName.split('.').pop() || 'mp4';
  const inputName = `trim_input.${ext}`;
  const outputName = `trim_output.${ext}`;
  const trimStart = options.trimStartSeconds;
  const clipDuration = options.clipDurationSeconds;

  if (clipDuration <= 0) {
    sendError(id, 'Invalid clip range');
    return;
  }

  const videoBytes = copyBuffer(videoData);

  try {
    sendProgress(id, {
      phase: 'loading',
      currentFrame: 0,
      totalFrames: 1,
      percent: 10,
      message: 'Preparing FFmpeg...',
    });

    await resetFFmpeg();
    await writeInputVideo(inputName, videoBytes);

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }

    sendProgress(id, {
      phase: 'processing',
      currentFrame: 0,
      totalFrames: 1,
      percent: 40,
      message: 'Trimming video (stream copy)...',
    });

    const copyArgs = [
      '-ss', trimStart.toFixed(3),
      '-i', inputName,
      '-t', clipDuration.toFixed(3),
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-y', outputName,
    ];

    let trimSucceeded = false;
    try {
      await ffmpeg!.exec(copyArgs);
      trimSucceeded = true;
    } catch (copyErr) {
      console.warn('[FFmpeg] Stream copy trim failed, retrying with re-encode:', copyErr);
    }

    if (!trimSucceeded) {
      if (isCancelled) {
        ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
        return;
      }

      sendProgress(id, {
        phase: 'processing',
        currentFrame: 0,
        totalFrames: 1,
        percent: 60,
        message: 'Trimming video (re-encoding)...',
      });

      await deleteFileIfExists(outputName);
      const reencodeArgs = [
        '-ss', trimStart.toFixed(3),
        '-i', inputName,
        '-t', clipDuration.toFixed(3),
        '-c:v', 'mpeg4',
        '-q:v', '2',
        '-an',
        '-y', outputName,
      ];
      await ffmpeg!.exec(reencodeArgs);
    }

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }

    sendProgress(id, {
      phase: 'processing',
      currentFrame: 1,
      totalFrames: 1,
      percent: 90,
      message: 'Reading trimmed file...',
    });

    const data = await ffmpeg!.readFile(outputName);
    const safeCopy = (data as Uint8Array).slice();

    await deleteFileIfExists(inputName);
    await deleteFileIfExists(outputName);

    if (safeCopy.byteLength === 0) {
      sendError(id, `Trim produced an empty file. FFmpeg output: ${getRecentLogs()}`);
      return;
    }

    ctx.postMessage({
      id,
      type: 'trimComplete',
      trimVideo: {
        data: safeCopy,
        mimeType: getMimeFromExt(ext),
        fileName: buildTrimmedFileName(fileName),
      },
      progress: {
        phase: 'complete',
        currentFrame: 1,
        totalFrames: 1,
        percent: 100,
        message: 'Trim complete',
      },
    } as VideoWorkerResponse);
  } catch (error) {
    await deleteFileIfExists(inputName);
    await deleteFileIfExists(outputName);
    sendError(id, `Failed to trim video: ${error instanceof Error ? error.message : String(error)}. FFmpeg output: ${getRecentLogs()}`);
  }
}

/* =============================================================================
 * LEGACY_FFMPEG_EXTRACTION — preserved for reference (do not delete)
 *
 * Previously used for probe + per-frame extract. Replaced by WebCodecs
 * (src/workers/webCodecsWorker.ts) for speed at dense intervals (e.g. 0.05s).
 * =============================================================================

import {
  VIDEO_EXTRACTION_CHUNK_SIZE,
  VIDEO_EXTRACTION_CHUNK_SIZE_PNG,
} from '../constants/optimization';
import type { ExtractionOptions } from '../types/video';

const SINGLE_FRAME_OUTPUT = 'frame_out';
const DELAY_AFTER_FRAME_MS = 10;
const DELAY_BETWEEN_BATCHES_MS = 150;

async function pngToJpeg(pngBytes: Uint8Array, quality: number): Promise<Uint8Array> {
  const pngBlob = new Blob([pngBytes], { type: 'image/png' });
  const bitmap = await createImageBitmap(pngBlob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const c2d = canvas.getContext('2d');
    if (!c2d) {
      throw new Error('OffscreenCanvas 2D context unavailable');
    }
    c2d.drawImage(bitmap, 0, 0);
    const clampedQuality = Math.min(1, Math.max(0.1, quality));
    const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: clampedQuality });
    const buf = await jpegBlob.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    bitmap.close();
  }
}

async function probeVideo(id: string, videoData: ArrayBuffer, fileName: string): Promise<void> {
  if (!ffmpeg) {
    sendError(id, 'FFmpeg not loaded');
    return;
  }

  const inputName = `probe_${Date.now()}.${fileName.split('.').pop() || 'mp4'}`;

  try {
    const videoBytes = copyBuffer(videoData);
    await ffmpeg.writeFile(inputName, videoBytes);

    let duration = 0;
    let width = 0;
    let height = 0;

    ffmpeg.on('log', ({ message }) => {
      const durationMatch = message.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      if (durationMatch) {
        const hours = parseInt(durationMatch[1], 10);
        const minutes = parseInt(durationMatch[2], 10);
        const seconds = parseFloat(durationMatch[3]);
        duration = hours * 3600 + minutes * 60 + seconds;
      }
      const streamMatch = message.match(/Stream.*Video.*?(\d+)x(\d+)/);
      if (streamMatch) {
        width = parseInt(streamMatch[1], 10);
        height = parseInt(streamMatch[2], 10);
      }
    });

    await ffmpeg.exec(['-i', inputName, '-vframes', '1', '-f', 'null', '-']);
    await deleteFileIfExists(inputName);

    ctx.postMessage({
      id,
      type: 'info',
      info: { duration, width, height },
    } as VideoWorkerResponse);
  } catch (error) {
    await deleteFileIfExists(inputName);
    sendError(id, `Failed to probe video: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function extractSingleFrame(
  inputName: string,
  timestamp: number,
  ext: string
): Promise<Uint8Array | null> {
  if (!ffmpeg) return null;

  const outputName = `${SINGLE_FRAME_OUTPUT}.${ext}`;
  await deleteFileIfExists(outputName);

  const args = [
    '-ss', timestamp.toFixed(3),
    '-i', inputName,
    '-frames:v', '1',
    '-an',
    '-update', '1',
    '-y', outputName,
  ];

  try {
    await ffmpeg.exec(args);
  } catch (err) {
    console.warn(`[FFmpeg] exec failed at ${timestamp}s with args [${args.join(' ')}]:`, err);
    console.warn(`[FFmpeg] Recent log context: ${getRecentLogs()}`);
    await deleteFileIfExists(outputName);
    return null;
  }

  try {
    const data = await ffmpeg.readFile(outputName);
    await deleteFileIfExists(outputName);

    const safeCopy = (data as Uint8Array).slice();
    await delay(DELAY_AFTER_FRAME_MS);

    return safeCopy;
  } catch (readErr) {
    console.warn(`[FFmpeg] readFile failed at ${timestamp}s:`, readErr);
    await deleteFileIfExists(outputName);
    return null;
  }
}

async function extractFrames(
  id: string,
  videoData: ArrayBuffer,
  fileName: string,
  options: ExtractionOptions
): Promise<void> {
  isCancelled = false;

  const intervalSeconds = options.intervalMs / 1000;
  const isJpeg = options.outputFormat === 'jpeg';
  const deliveredMimeType = isJpeg ? 'image/jpeg' : 'image/png';
  const jpegQuality = typeof options.quality === 'number' && options.quality > 0 && options.quality <= 1
    ? options.quality
    : 0.95;
  const chunkSize = options.chunkSize ?? (
    isJpeg ? VIDEO_EXTRACTION_CHUNK_SIZE : VIDEO_EXTRACTION_CHUNK_SIZE_PNG
  );

  const clipDuration = options.videoDuration;
  const trimStart = options.trimStartSeconds ?? 0;
  if (!clipDuration || clipDuration <= 0) {
    sendError(id, 'Video duration unknown — reload the video and try again');
    return;
  }

  let totalFrames = Math.ceil(clipDuration / intervalSeconds);
  if (options.maxFrames) {
    totalFrames = Math.min(totalFrames, options.maxFrames);
  }
  if (totalFrames <= 0) {
    sendError(id, 'No frames to extract at this interval');
    return;
  }

  const inputName = `input.${fileName.split('.').pop() || 'mp4'}`;
  let framesSent = 0;
  let failedFrames = 0;
  const totalChunks = Math.ceil(totalFrames / chunkSize);

  const videoBytes = copyBuffer(videoData);

  try {
    sendProgress(id, {
      phase: 'loading',
      currentFrame: 0,
      totalFrames,
      percent: 0,
      message: 'Preparing FFmpeg...',
    });

    await resetFFmpeg();
    await writeInputVideo(inputName, videoBytes);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      if (isCancelled) break;

      if (chunkIndex > 0) {
        sendProgress(id, {
          phase: 'loading',
          currentFrame: framesSent,
          totalFrames,
          percent: 5 + Math.round((framesSent / totalFrames) * 85),
          message: `Resetting memory before batch ${chunkIndex + 1}...`,
        });

        await delay(DELAY_BETWEEN_BATCHES_MS);
        await resetFFmpeg();
        await writeInputVideo(inputName, videoBytes);
      }

      const chunkStartFrame = chunkIndex * chunkSize;
      const batchSize = Math.min(chunkSize, totalFrames - chunkStartFrame);

      sendProgress(id, {
        phase: 'extracting',
        currentFrame: framesSent,
        totalFrames,
        percent: 5 + Math.round((framesSent / totalFrames) * 85),
        message: `Batch ${chunkIndex + 1} of ${totalChunks} (frames ${chunkStartFrame + 1}–${chunkStartFrame + batchSize})...`,
      });

      for (let i = 0; i < batchSize; i++) {
        if (isCancelled) break;

        const globalIndex = chunkStartFrame + i;
        const timestamp = trimStart + globalIndex * intervalSeconds;

        const pngData = await extractSingleFrame(inputName, timestamp, 'png');
        if (!pngData || pngData.byteLength === 0) {
          console.warn(`[FFmpeg] No data for frame ${globalIndex} at ${timestamp}s`);
          failedFrames++;
          if (framesSent === 0 && failedFrames >= 8) {
            sendError(id, `Extraction failing on every frame (${failedFrames} errors). FFmpeg output: ${getRecentLogs()}`);
            return;
          }
          continue;
        }

        let outData: Uint8Array = pngData;
        if (isJpeg) {
          try {
            outData = await pngToJpeg(pngData, jpegQuality);
          } catch (convErr) {
            console.warn(`[Convert] PNG→JPEG failed at frame ${globalIndex}:`, convErr);
            failedFrames++;
            continue;
          }
        }

        ctx.postMessage({
          id,
          type: 'frame',
          frame: {
            index: globalIndex,
            timestamp,
            data: outData,
            mimeType: deliveredMimeType,
          },
        } as VideoWorkerResponse);

        framesSent++;
        sendProgress(id, {
          phase: 'processing',
          currentFrame: framesSent,
          totalFrames,
          percent: 5 + Math.round((framesSent / totalFrames) * 90),
          message: `Extracted frames ${framesSent} of ${totalFrames}`,
        });
      }
    }

    if (ffmpeg) {
      await deleteFileIfExists(inputName);
    }

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled', framesExtracted: framesSent } as VideoWorkerResponse);
      return;
    }

    if (framesSent === 0 && failedFrames > 0) {
      sendError(id, `Failed to extract any frames (${failedFrames} errors). FFmpeg output: ${getRecentLogs()}`);
      return;
    }

    ctx.postMessage({
      id,
      type: 'complete',
      framesExtracted: framesSent,
      progress: {
        phase: 'complete',
        currentFrame: framesSent,
        totalFrames: framesSent,
        percent: 100,
        message: framesSent > 0
          ? `Extracted ${framesSent} frames${failedFrames > 0 ? ` (${failedFrames} failed)` : ''}`
          : 'No frames extracted',
      },
    } as VideoWorkerResponse);
  } catch (error) {
    sendError(id, error instanceof Error ? error.message : String(error));
  }
}

============================================================================= */

ctx.onmessage = async (event: MessageEvent<VideoWorkerRequest>) => {
  const { id, type, videoData, fileName, trimOptions } = event.data;

  try {
    if (type === 'cancel') {
      isCancelled = true;
      return;
    }

    if (type === 'probe' || type === 'extract') {
      sendError(
        id,
        `FFmpeg ${type} is disabled — use the WebCodecs worker. Legacy code is preserved in LEGACY_FFMPEG_EXTRACTION.`
      );
      return;
    }

    if (!isLoaded) {
      sendProgress(id, {
        phase: 'loading',
        currentFrame: 0,
        totalFrames: 0,
        percent: 0,
        message: 'Loading FFmpeg...',
      });
      await loadFFmpeg();
    }

    if (type === 'trim' && videoData && fileName && trimOptions) {
      await trimVideoExport(id, videoData, fileName, trimOptions);
    } else {
      sendError(id, `Invalid request: missing required parameters for ${type}`);
    }
  } catch (error) {
    sendError(id, `Worker error: ${error instanceof Error ? error.message : String(error)}`);
  }
};
