/**
 * Timeline clip thumbnails — same WebCodecs extract path as the Video Frames
 * tab, with the image-tab downscale (max edge + JPEG quality) so filmstrip
 * tiles don't decode full-resolution frames.
 *
 * Frames stream in via `onFrame` so the timeline can paint incrementally
 * instead of waiting for the whole pass.
 */
import { videoWorkerPool } from '../videoWorkerPool';
import { captureVideoFrameAsUrl } from './captureFrame';
import {
  THUMBNAIL_JPEG_QUALITY,
  TIMELINE_THUMB_MAX_EDGE_PX,
} from '../../constants/optimization';

export interface ClipThumbnailRequest {
  /** Cache key the result should be stored under (e.g. clipThumbKey(clip)). */
  key: string;
  /** Absolute source-video timestamp (seconds) to capture. */
  sourceTime: number;
}

export function roundThumbTimeMs(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 1000);
}

/**
 * Captures a thumbnail (as an object URL) for every request, keyed by `key`.
 * Same source timestamp shares one object URL. `onFrame` fires as each unique
 * time is ready so the UI can stream tiles in.
 */
export async function generateClipThumbnails(
  videoFile: File | null,
  videoUrl: string | null,
  requests: ClipThumbnailRequest[],
  onFrame?: (sourceTime: number, objectUrl: string) => void
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  if (requests.length === 0) return results;

  const remaining = new Map<string, number>(requests.map((r) => [r.key, r.sourceTime]));
  const urlByMs = new Map<number, string>();

  const publish = (sourceTime: number, url: string): void => {
    const ms = roundThumbTimeMs(sourceTime);
    urlByMs.set(ms, url);
    onFrame?.(sourceTime, url);
    for (const [key, time] of remaining) {
      if (roundThumbTimeMs(time) === ms) {
        results.set(key, url);
        remaining.delete(key);
      }
    }
  };

  if (videoFile && videoWorkerPool.isSupported()) {
    try {
      await extractViaWebCodecs(videoFile, remaining, publish);
    } catch (err) {
      console.warn('[ClipThumbnails] WebCodecs batch extraction failed, falling back:', err);
    }
  }

  if (remaining.size > 0 && videoUrl) {
    await fallbackSeekCapture(videoUrl, remaining, publish);
  }

  return results;
}

async function extractViaWebCodecs(
  videoFile: File,
  remaining: Map<string, number>,
  publish: (sourceTime: number, url: string) => void
): Promise<void> {
  const byTimestamp = new Map<number, string[]>();
  for (const [key, time] of remaining) {
    const rounded = Math.round(Math.max(0, time) * 1000) / 1000;
    const keys = byTimestamp.get(rounded);
    if (keys) keys.push(key);
    else byTimestamp.set(rounded, [key]);
  }

  const targetTimestamps = Array.from(byTimestamp.keys()).sort((a, b) => a - b);
  if (targetTimestamps.length === 0) return;

  await videoWorkerPool.extractFrames(
    videoFile,
    {
      outputFormat: 'jpeg',
      quality: THUMBNAIL_JPEG_QUALITY,
      targetTimestamps,
      maxEdgePx: TIMELINE_THUMB_MAX_EDGE_PX,
    },
    {
      onFrame: (frame) => {
        const rounded = Math.round(frame.timestamp * 1000) / 1000;
        const keys = byTimestamp.get(rounded);
        if (!keys) return;
        publish(rounded, URL.createObjectURL(frame.blob));
      },
    }
  );
}

/** Sequential seek+capture on one element, downscaled like the image grid. */
async function fallbackSeekCapture(
  videoUrl: string,
  remaining: Map<string, number>,
  publish: (sourceTime: number, url: string) => void
): Promise<void> {
  const times = Array.from(
    new Set(Array.from(remaining.values()).map((t) => Math.round(Math.max(0, t) * 1000) / 1000))
  ).sort((a, b) => a - b);

  for (const time of times) {
    if (![...remaining.values()].some((t) => Math.round(Math.max(0, t) * 1000) / 1000 === time)) {
      continue;
    }
    try {
      const url = await captureVideoFrameAsUrl(videoUrl, time, {
        maxEdgePx: TIMELINE_THUMB_MAX_EDGE_PX,
        quality: THUMBNAIL_JPEG_QUALITY,
      });
      publish(time, url);
    } catch (err) {
      console.warn(`[ClipThumbnails] Failed to capture fallback thumbnail at ${time}s:`, err);
    }
  }
}
