/**
 * Batch clip-thumbnail generation for the hidden Edit tab timeline.
 *
 * Primary path: a single WebCodecs hardware-decode pass captures every
 * needed source-video timestamp in one sweep — the same pipeline the Video
 * Frames tab uses (`extractFrames.ts`) — instead of spinning up a brand new
 * `<video>` element per clip on the main thread.
 *
 * Falls back to the naive per-clip `<video>` seek+capture path (run with
 * bounded concurrency instead of one-at-a-time) when WebCodecs is
 * unavailable, or for any individual timestamp that fails to decode.
 */
import { videoWorkerPool } from '../videoWorkerPool';
import { captureVideoFrameAsUrl } from './captureFrame';
import { mapWithConcurrency } from '../concurrency';
import { GRID_DECODE_CONCURRENCY } from '../../constants/optimization';

export interface ClipThumbnailRequest {
  /** Cache key the result should be stored under (e.g. clipThumbKey(clip)). */
  key: string;
  /** Absolute source-video timestamp (seconds) to capture. */
  sourceTime: number;
}

/**
 * WebCodecs extraction does one linear decode sweep from the earliest to the
 * latest requested timestamp — a big win when several clips are clustered
 * together (e.g. right after Split or Auto Build), but wasteful for a single
 * isolated thumbnail in a long video, where a native `<video>` seek is
 * cheaper. Only attempt the batch path once there's enough work to amortize.
 */
const MIN_REQUESTS_FOR_WEBCODECS_BATCH = 3;

/**
 * Captures a thumbnail (as an object URL) for every request, keyed by `key`.
 * Requests that resolve to the same timestamp (e.g. duplicated clips) share a
 * single decoded frame, though each still gets its own independently
 * revokable object URL.
 */
export async function generateClipThumbnails(
  videoFile: File | null,
  videoUrl: string | null,
  requests: ClipThumbnailRequest[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  if (requests.length === 0) return results;

  const remaining = new Map<string, number>(requests.map((r) => [r.key, r.sourceTime]));

  const distinctTimestamps = new Set(
    requests.map((r) => Math.round(Math.max(0, r.sourceTime) * 1000) / 1000)
  ).size;

  if (
    videoFile &&
    distinctTimestamps >= MIN_REQUESTS_FOR_WEBCODECS_BATCH &&
    videoWorkerPool.isSupported()
  ) {
    try {
      await extractViaWebCodecs(videoFile, remaining, results);
    } catch (err) {
      console.warn('[ClipThumbnails] WebCodecs batch extraction failed, falling back:', err);
    }
  }

  if (remaining.size > 0 && videoUrl) {
    await fallbackPerClip(videoUrl, remaining, results);
  }

  return results;
}

/** Single hardware-decode pass capturing every remaining requested timestamp. */
async function extractViaWebCodecs(
  videoFile: File,
  remaining: Map<string, number>,
  results: Map<string, string>
): Promise<void> {
  // Group requested keys by timestamp (ms precision) so requests that land on
  // the same instant only need to decode/capture one frame.
  const byTimestamp = new Map<number, string[]>();
  for (const [key, time] of remaining) {
    const rounded = Math.round(Math.max(0, time) * 1000) / 1000;
    const keys = byTimestamp.get(rounded);
    if (keys) keys.push(key);
    else byTimestamp.set(rounded, [key]);
  }

  const targetTimestamps = Array.from(byTimestamp.keys()).sort((a, b) => a - b);

  await videoWorkerPool.extractFrames(
    videoFile,
    {
      outputFormat: 'jpeg',
      quality: 0.85,
      targetTimestamps,
    },
    {
      onFrame: (frame) => {
        const rounded = Math.round(frame.timestamp * 1000) / 1000;
        const keys = byTimestamp.get(rounded);
        if (!keys) return;
        for (const key of keys) {
          // A fresh object URL per key — never share one URL across cache
          // entries, since revoking it for one stale clip would break the
          // others still referencing it.
          results.set(key, URL.createObjectURL(frame.blob));
          remaining.delete(key);
        }
      },
    }
  );
}

/** Naive per-clip `<video>` seek+capture, parallelized instead of sequential. */
async function fallbackPerClip(
  videoUrl: string,
  remaining: Map<string, number>,
  results: Map<string, string>
): Promise<void> {
  const entries = Array.from(remaining.entries());
  await mapWithConcurrency(entries, GRID_DECODE_CONCURRENCY, async ([key, time]) => {
    try {
      const url = await captureVideoFrameAsUrl(videoUrl, time);
      results.set(key, url);
    } catch (err) {
      console.warn(`[ClipThumbnails] Failed to capture fallback thumbnail for ${key}:`, err);
    }
  });
}
