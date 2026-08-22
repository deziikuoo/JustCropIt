/**
 * WebSAM-style box prompt via sam-web (SAM 2 Tiny).
 * WebSAM itself is an app, not a package; this is the same box → mask pipeline.
 */

import { SAMClient, type ProgressStage } from 'sam-web';
import SamWebWorker from '../workers/samHighPerfWorker.ts?worker';
import { SAM_OBJECT_MODEL_ID } from '../constants/optimization';
import {
  beginSamLoadProgress,
  clearSamDownloadProgress,
  ensureSamModelsDownloaded,
} from './samModelDownload';
import { quietIgnorableSamLogs } from './quietSamLogs';
import type { BoundingBox } from '../types/detection';
import type { SegmentMaskPayload } from './interactiveSegmenterSession';
import {
  boxCenter,
  boundsFromCategoryMask,
  boundsFromConfidenceMask,
  extractComponentAtSeed,
  padCropBox,
  scaleMaskBounds,
  scribbleNormalizedBox,
  type NormalizedKeypoint,
} from './objectMaskCrop';

export type SamProgressStage = ProgressStage | 'idle';

export interface SamBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SamSegmentResult {
  bbox: BoundingBox;
  padded: BoundingBox;
  keypoint: NormalizedKeypoint;
  mask: SegmentMaskPayload;
  imageWidth: number;
  imageHeight: number;
}

const AUTO_INSET = 0.08;

let client: SAMClient | null = null;
let initPromise: Promise<SAMClient> | null = null;
let encodedKey: string | null = null;
let opChain: Promise<unknown> = Promise.resolve();
let progressStage: SamProgressStage = 'idle';
const progressListeners = new Set<(stage: SamProgressStage) => void>();

function setProgress(stage: SamProgressStage) {
  progressStage = stage;
  for (const listener of progressListeners) listener(stage);
}

export function getSamProgressStage(): SamProgressStage {
  return progressStage;
}

export function subscribeSamProgress(
  listener: (stage: SamProgressStage) => void
): () => void {
  progressListeners.add(listener);
  listener(progressStage);
  return () => {
    progressListeners.delete(listener);
  };
}

function withSamLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = opChain.then(fn, fn);
  opChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function letterboxContent(
  imageWidth: number,
  imageHeight: number,
  squareSize: number
): { x: number; y: number; w: number; h: number } {
  if (imageHeight > imageWidth) {
    const w = (imageWidth / imageHeight) * squareSize;
    return { x: (squareSize - w) / 2, y: 0, w, h: squareSize };
  }
  if (imageWidth > imageHeight) {
    const h = (imageHeight / imageWidth) * squareSize;
    return { x: 0, y: (squareSize - h) / 2, w: squareSize, h };
  }
  return { x: 0, y: 0, w: squareSize, h: squareSize };
}

function photoToSquare(x: number, y: number, imageWidth: number, imageHeight: number) {
  const box = letterboxContent(imageWidth, imageHeight, 1);
  return { x: box.x + x * box.w, y: box.y + y * box.h };
}

function photoBoxToSquare(
  box: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number
): SamBox {
  const a = photoToSquare(box.x, box.y, imageWidth, imageHeight);
  const b = photoToSquare(box.x + box.width, box.y + box.height, imageWidth, imageHeight);
  return {
    x1: Math.min(a.x, b.x),
    y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x),
    y2: Math.max(a.y, b.y),
  };
}

function extractContentMask(
  data: Float32Array,
  maskWidth: number,
  maskHeight: number,
  imageWidth: number,
  imageHeight: number
): { data: Float32Array; width: number; height: number } {
  const box = letterboxContent(imageWidth, imageHeight, maskWidth);
  const x0 = Math.max(0, Math.min(maskWidth - 1, Math.round(box.x)));
  const y0 = Math.max(0, Math.min(maskHeight - 1, Math.round(box.y)));
  const width = Math.max(1, Math.min(maskWidth - x0, Math.round(box.w)));
  const height = Math.max(1, Math.min(maskHeight - y0, Math.round(box.h)));
  const cropped = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const src = (y0 + y) * maskWidth + x0;
    cropped.set(data.subarray(src, src + width), y * width);
  }
  return { data: cropped, width, height };
}

function sampleNeighborhoodMean(
  data: Float32Array,
  width: number,
  height: number,
  seed: NormalizedKeypoint,
  radius = 2
): number {
  const cx = Math.round(seed.x * (width - 1));
  const cy = Math.round(seed.y * (height - 1));
  let sum = 0;
  let count = 0;
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      sum += data[y * width + x];
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function invertMaskInPlace(data: Float32Array): void {
  for (let i = 0; i < data.length; i += 1) {
    data[i] = -data[i];
  }
}

async function createClient(): Promise<SAMClient> {
  const sam = new SAMClient({
    model: SAM_OBJECT_MODEL_ID,
    device: 'webgpu',
    onProgress: (stage) => setProgress(stage),
  });
  await sam.initializeWithWorker(new SamWebWorker());
  return sam;
}

export async function ensureSamReady(): Promise<SAMClient> {
  quietIgnorableSamLogs();
  if (client?.isInitialized()) return client;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    setProgress('downloading');
    try {
      const downloaded = await ensureSamModelsDownloaded();
      if (downloaded) {
        setProgress('loading');
        beginSamLoadProgress();
      }
      const sam = await createClient();
      client = sam;
      setProgress('ready');
      return sam;
    } catch (error) {
      initPromise = null;
      client = null;
      setProgress('idle');
      throw error;
    } finally {
      clearSamDownloadProgress();
    }
  })();

  return initPromise;
}

export function disposeSamSession(): void {
  initPromise = null;
  encodedKey = null;
  if (client) {
    client.dispose();
    client = null;
  }
  setProgress('idle');
}

function imageKey(bitmap: ImageBitmap, photoId?: string): string {
  return photoId ?? `${bitmap.width}x${bitmap.height}`;
}

export async function encodeSamImage(
  bitmap: ImageBitmap,
  photoId?: string
): Promise<void> {
  await withSamLock(async () => {
    const sam = await ensureSamReady();
    const key = imageKey(bitmap, photoId);
    if (encodedKey === key) return;
    setProgress('encoding');
    await sam.setImage(bitmap);
    encodedKey = key;
    setProgress('ready');
  });
}

export async function segmentSamBox(
  bitmap: ImageBitmap,
  photoBox: { x: number; y: number; width: number; height: number },
  padPx: number,
  photoId?: string
): Promise<SamSegmentResult | null> {
  return withSamLock(async () => {
    const sam = await ensureSamReady();
    const key = imageKey(bitmap, photoId);
    if (encodedKey !== key) {
      setProgress('encoding');
      await sam.setImage(bitmap);
      encodedKey = key;
    }

    setProgress('decoding');
    // Official SAM only accepts XYXY with x1<x2, y1<y2. Always send that,
    // and never mix in a click — a center point plus the sorted box was
    // rotating which corner “worked” across jobs.
    const result = await sam.segment({
      box: photoBoxToSquare(photoBox, bitmap.width, bitmap.height),
    });
    setProgress('ready');

    const maskWidth = result.shape[1];
    const maskHeight = result.shape[0];
    const maskData = new Float32Array(result.data);
    result.bitmap.close();

    const cropped = extractContentMask(
      maskData,
      maskWidth,
      maskHeight,
      bitmap.width,
      bitmap.height
    );
    const seed = boxCenter(photoBox);
    // Box-only SAM often returns the background. If the box center is
    // background, flip so the stamp is foreground. Do not send a click.
    if (sampleNeighborhoodMean(cropped.data, cropped.width, cropped.height, seed) <= 0) {
      invertMaskInPlace(cropped.data);
    }

    const areaBounds = { minAreaRatio: 0.0005, maxAreaRatio: 0.98 };
    const extracted = extractComponentAtSeed(
      cropped.data,
      cropped.width,
      cropped.height,
      seed,
      0,
      areaBounds
    );
    const maskBounds =
      (extracted?.component
        ? boundsFromCategoryMask(
            extracted.component,
            cropped.width,
            cropped.height,
            areaBounds
          )
        : null) ??
      extracted?.bounds ??
      boundsFromConfidenceMask(
        cropped.data,
        cropped.width,
        cropped.height,
        0,
        areaBounds
      );
    if (!maskBounds) return null;

    const bbox = scaleMaskBounds(
      maskBounds,
      cropped.width,
      cropped.height,
      bitmap.width,
      bitmap.height
    );

    return {
      bbox,
      padded: padCropBox(bbox, bitmap.width, bitmap.height, padPx),
      keypoint: seed,
      mask: {
        maskWidth: cropped.width,
        maskHeight: cropped.height,
        confidenceMask: cropped.data,
        overlayThreshold: 0,
        componentMask: extracted?.component,
        letterboxed: false,
      },
      imageWidth: bitmap.width,
      imageHeight: bitmap.height,
    };
  });
}

export function boxFromScribble(
  scribble: NormalizedKeypoint[]
): { x: number; y: number; width: number; height: number } | null {
  return scribbleNormalizedBox(scribble);
}

export function autoSubjectBox(): { x: number; y: number; width: number; height: number } {
  const size = 1 - AUTO_INSET * 2;
  return { x: AUTO_INSET, y: AUTO_INSET, width: size, height: size };
}

export function samStatusLabel(stage: SamProgressStage, findingFallback: string): string {
  if (stage === 'downloading') return 'Downloading object finder…';
  if (stage === 'loading') return 'Loading object finder…';
  if (stage === 'encoding') return 'Reading this photo…';
  if (stage === 'decoding') return 'Finding the object…';
  return findingFallback;
}
