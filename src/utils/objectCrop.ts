/**
 * Crop-to-object detection — SAM box prompt (WebSAM-style).
 */

import type { BoundingBox } from '../types/detection';
import {
  boxCenter,
  type NormalizedKeypoint,
} from './objectMaskCrop';
import type { SegmentMaskPayload } from './interactiveSegmenterSession';
import {
  autoSubjectBox,
  boxFromScribble,
  encodeSamImage,
  ensureSamReady,
  segmentSamBox,
} from './webSamSession';

export interface ObjectCropDetectResult {
  bbox: BoundingBox;
  padded: BoundingBox;
  keypoint: NormalizedKeypoint;
  mask: SegmentMaskPayload | null;
  imageWidth: number;
  imageHeight: number;
}

export interface ObjectCropDetectOptions {
  keypoint?: NormalizedKeypoint;
  scribble?: NormalizedKeypoint[];
  /** Normalized 0–1 box. Preferred over scribble when both are set. */
  box?: { x: number; y: number; width: number; height: number };
  padPx?: number;
  photoId?: string;
  /** Unused: batch uses one inset box instead of multi-seed search. */
  autoSearch?: boolean;
}

async function loadBitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
}

async function loadBitmapFromUrl(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status})`);
  }
  return loadBitmapFromBlob(await response.blob());
}

export async function detectObjectFromBitmap(
  bitmap: ImageBitmap,
  options: ObjectCropDetectOptions = {}
): Promise<ObjectCropDetectResult | null> {
  const padPx = options.padPx ?? 0;
  const guideBox =
    options.box ??
    (options.scribble?.length ? boxFromScribble(options.scribble) : null);
  const photoBox = guideBox ?? autoSubjectBox();
  const keypoint = options.keypoint ?? boxCenter(photoBox);

  const result = await segmentSamBox(bitmap, photoBox, padPx, options.photoId);
  if (!result) return null;
  return {
    ...result,
    keypoint,
  };
}

export async function detectObjectFromBlob(
  blob: Blob,
  options: ObjectCropDetectOptions = {}
): Promise<ObjectCropDetectResult | null> {
  const bitmap = await loadBitmapFromBlob(blob);
  try {
    return await detectObjectFromBitmap(bitmap, options);
  } finally {
    bitmap.close();
  }
}

function isBitmapSource(
  value: unknown
): value is ImageBitmap | HTMLImageElement | HTMLCanvasElement | ImageData | OffscreenCanvas | Blob {
  return (
    value instanceof ImageBitmap ||
    value instanceof HTMLImageElement ||
    value instanceof HTMLCanvasElement ||
    value instanceof ImageData ||
    (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) ||
    value instanceof Blob
  );
}

export async function detectObjectFromImage(
  image: unknown,
  options: ObjectCropDetectOptions = {}
): Promise<ObjectCropDetectResult | null> {
  if (!isBitmapSource(image)) {
    throw new TypeError('detectObjectFromImage expected a drawable image source');
  }
  if (image instanceof ImageBitmap) {
    return detectObjectFromBitmap(image, options);
  }
  const bitmap = await createImageBitmap(image, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    return await detectObjectFromBitmap(bitmap, options);
  } finally {
    bitmap.close();
  }
}

export async function detectObjectFromUrl(
  url: string,
  options: ObjectCropDetectOptions = {}
): Promise<ObjectCropDetectResult | null> {
  const bitmap = await loadBitmapFromUrl(url);
  try {
    return await detectObjectFromBitmap(bitmap, {
      ...options,
      photoId: options.photoId ?? url,
    });
  } finally {
    bitmap.close();
  }
}

export async function preloadObjectCropRuntime(): Promise<void> {
  await ensureSamReady();
}

export async function preloadObjectCropImage(
  url: string,
  photoId?: string
): Promise<void> {
  await ensureSamReady();
  const bitmap = await loadBitmapFromUrl(url);
  try {
    await encodeSamImage(bitmap, photoId ?? url);
  } finally {
    bitmap.close();
  }
}

export function isObjectCropSupported(): boolean {
  return (
    typeof createImageBitmap !== 'undefined' && typeof Worker !== 'undefined'
  );
}
