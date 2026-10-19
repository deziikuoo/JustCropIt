/**
 * Fast reverse-preview strips for the Edit timeline.
 *
 * Decodes a downscaled JPEG sequence once per unique source range (WebCodecs
 * hardware decode) and plays it backwards on a canvas. Export reverse uses
 * hardware VideoEncoder when available, otherwise FFmpeg.
 */
import type { Clip } from '../../types/videoEdit';
import {
  REVERSE_PREVIEW_CACHE_MAX,
  REVERSE_PREVIEW_FPS,
  REVERSE_PREVIEW_JPEG_QUALITY,
  REVERSE_PREVIEW_MAX_EDGE_PX,
  REVERSE_PREVIEW_MAX_FRAMES,
} from '../../constants/optimization';
import { videoWorkerPool } from '../videoWorkerPool';
import { captureVideoFrameAsUrl } from './captureFrame';
import { flattenClipsForRender } from './compoundClip';

export interface ReversePreviewFrame {
  time: number;
  bitmap: ImageBitmap;
}

export interface ReversePreviewSequence {
  sourceStart: number;
  sourceEnd: number;
  width: number;
  height: number;
  frames: ReversePreviewFrame[];
}

const cache = new Map<string, ReversePreviewSequence>();
const inflight = new Map<string, Promise<ReversePreviewSequence>>();
let cacheEpoch = 0;

export function reversePreviewCacheKey(clip: Clip): string {
  return `${clip.sourceStart.toFixed(3)}|${clip.sourceEnd.toFixed(3)}`;
}

export function hasReversePreview(clip: Clip): boolean {
  return cache.has(reversePreviewCacheKey(clip));
}

type ReverseProgress = (percent: number) => void;

function disposeSequence(sequence: ReversePreviewSequence): void {
  for (const frame of sequence.frames) {
    try {
      frame.bitmap.close();
    } catch {
      // already closed
    }
  }
}

export function clearReversePreviewCache(): void {
  cacheEpoch += 1;
  for (const sequence of cache.values()) disposeSequence(sequence);
  cache.clear();
  inflight.clear();
}

function remember(key: string, sequence: ReversePreviewSequence): void {
  const existing = cache.get(key);
  if (existing && existing !== sequence) disposeSequence(existing);
  if (cache.has(key)) cache.delete(key);
  cache.set(key, sequence);
  while (cache.size > REVERSE_PREVIEW_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    const evicted = cache.get(oldest);
    if (evicted) disposeSequence(evicted);
    cache.delete(oldest);
  }
}

function previewIntervalMs(sourceDuration: number): number {
  const fromFps = 1000 / REVERSE_PREVIEW_FPS;
  const fromCap = (sourceDuration * 1000) / REVERSE_PREVIEW_MAX_FRAMES;
  return Math.max(fromFps, fromCap);
}

async function bitmapsFromBlobs(
  collected: { time: number; blob: Blob }[]
): Promise<ReversePreviewSequence> {
  collected.sort((a, b) => a.time - b.time);
  const frames: ReversePreviewFrame[] = [];
  for (const item of collected) {
    try {
      const bitmap = await createImageBitmap(item.blob);
      frames.push({ time: item.time, bitmap });
    } catch (err) {
      console.warn('[ReversePreview] Failed to decode preview frame:', err);
    }
  }
  if (frames.length === 0) {
    throw new Error('No reverse-preview frames decoded');
  }
  return {
    sourceStart: frames[0].time,
    sourceEnd: frames[frames.length - 1].time,
    width: frames[0].bitmap.width,
    height: frames[0].bitmap.height,
    frames,
  };
}

async function extractViaWebCodecs(
  videoFile: File,
  clip: Clip,
  onProgress?: ReverseProgress
): Promise<ReversePreviewSequence> {
  const sourceDuration = Math.max(0.05, clip.sourceEnd - clip.sourceStart);
  const collected: { time: number; blob: Blob }[] = [];

  await videoWorkerPool.extractFrames(
    videoFile,
    {
      outputFormat: 'jpeg',
      quality: REVERSE_PREVIEW_JPEG_QUALITY,
      intervalMs: previewIntervalMs(sourceDuration),
      maxFrames: REVERSE_PREVIEW_MAX_FRAMES,
      videoDuration: sourceDuration,
      trimStartSeconds: Math.max(0, clip.sourceStart),
      maxEdgePx: REVERSE_PREVIEW_MAX_EDGE_PX,
    },
    {
      onFrame: (frame) => {
        collected.push({ time: frame.timestamp, blob: frame.blob });
      },
      onProgress: (progress) => onProgress?.(Math.round(progress.percent * 0.9)),
    }
  );

  return bitmapsFromBlobs(collected);
}

async function extractViaVideoSeek(
  videoUrl: string,
  clip: Clip,
  onProgress?: ReverseProgress
): Promise<ReversePreviewSequence> {
  const sourceDuration = Math.max(0.05, clip.sourceEnd - clip.sourceStart);
  const interval = previewIntervalMs(sourceDuration) / 1000;
  const total = Math.max(
    1,
    Math.min(
      REVERSE_PREVIEW_MAX_FRAMES,
      Math.floor(sourceDuration / interval) + 1
    )
  );
  const collected: { time: number; blob: Blob }[] = [];

  // Include exact sourceEnd to ensure last frame is captured
  for (let t = clip.sourceStart, i = 0; t <= clip.sourceEnd && i < REVERSE_PREVIEW_MAX_FRAMES; t += interval, i++) {
    onProgress?.(Math.round((i / total) * 90));
    const url = await captureVideoFrameAsUrl(videoUrl, t);
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      collected.push({ time: t, blob });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return bitmapsFromBlobs(collected);
}

export async function loadReversePreviewSequence(
  clip: Clip,
  videoFile: File | null,
  videoUrl: string | null,
  onProgress?: ReverseProgress
): Promise<ReversePreviewSequence> {
  const key = reversePreviewCacheKey(clip);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const epoch = cacheEpoch;
  const promise = (async () => {
    if (videoFile && videoWorkerPool.isSupported()) {
      try {
        return await extractViaWebCodecs(videoFile, clip, onProgress);
      } catch (err) {
        console.warn('[ReversePreview] WebCodecs strip failed, falling back to seek capture:', err);
      }
    }
    if (!videoUrl) {
      throw new Error('No source video available for reverse preview');
    }
    return extractViaVideoSeek(videoUrl, clip, onProgress);
  })()
    .then((sequence) => {
      if (epoch !== cacheEpoch) {
        disposeSequence(sequence);
        throw new Error('Reverse preview cache cleared');
      }
      remember(key, sequence);
      return sequence;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export async function prefetchReversePreviews(
  clips: Clip[],
  videoFile: File | null,
  videoUrl: string | null,
  onProgress?: ReverseProgress
): Promise<void> {
  const leaves = flattenClipsForRender(clips);
  const seen = new Set<string>();
  const jobs: Clip[] = [];
  for (const clip of leaves) {
    if (!clip.reversed || clip.freeze) continue;
    const key = reversePreviewCacheKey(clip);
    if (seen.has(key) || cache.has(key) || inflight.has(key)) continue;
    seen.add(key);
    jobs.push(clip);
  }
  if (jobs.length === 0) return;

  onProgress?.(0);
  for (let i = 0; i < jobs.length; i++) {
    try {
      await loadReversePreviewSequence(jobs[i], videoFile, videoUrl, (inner) => {
        onProgress?.(Math.round(((i + inner / 100) / jobs.length) * 100));
      });
    } catch (err) {
      console.warn('[ReversePreview] Prefetch failed:', err);
    }
  }
  onProgress?.(100);
}

export function nearestReverseFrame(
  sequence: ReversePreviewSequence,
  sourceTime: number
): ReversePreviewFrame {
  const frames = sequence.frames;
  let lo = 0;
  let hi = frames.length - 1;
  if (sourceTime <= frames[0].time) return frames[0];
  if (sourceTime >= frames[hi].time) return frames[hi];
  
  // Binary search for floor (largest time <= sourceTime)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].time <= sourceTime) lo = mid;
    else hi = mid - 1;
  }
  
  // Check if next frame is closer (true nearest-neighbor)
  if (lo + 1 < frames.length) {
    const curr = frames[lo];
    const next = frames[lo + 1];
    if (Math.abs(next.time - sourceTime) < Math.abs(curr.time - sourceTime)) {
      return next;
    }
  }
  
  return frames[lo];
}
