/**
 * Mask → bounding box, pad, and auto-seed helpers for crop-to-object.
 */

import type { BoundingBox } from '../types/detection';
import {
  OBJECT_AUTO_SEED_GRID,
  OBJECT_AUTO_SEED_INSET,
  OBJECT_MASK_CONFIDENCE_THRESHOLD,
  OBJECT_MASK_MAX_AREA_RATIO,
  OBJECT_MASK_MIN_AREA_RATIO,
  OBJECT_MASK_GUIDED_CONFIDENCE_THRESHOLD,
  OBJECT_MASK_GUIDED_MAX_AREA_RATIO,
  OBJECT_MASK_GUIDED_MIN_AREA_RATIO,
  OBJECT_SCRIBBLE_MAX_POINTS,
  OBJECT_CROP_PAD_MAX,
  OBJECT_CROP_PAD_MIN,
} from '../constants/optimization';

export interface NormalizedKeypoint {
  x: number;
  y: number;
}

export interface ObjectMaskBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  areaRatio: number;
}

export interface ObjectMaskBoundsOptions {
  threshold?: number;
  minAreaRatio?: number;
  maxAreaRatio?: number;
}

export function isPlausibleObjectMaskArea(
  areaRatio: number,
  minAreaRatio = OBJECT_MASK_MIN_AREA_RATIO,
  maxAreaRatio = OBJECT_MASK_MAX_AREA_RATIO
): boolean {
  return areaRatio >= minAreaRatio && areaRatio <= maxAreaRatio;
}

export function downsampleScribble(
  points: NormalizedKeypoint[],
  maxPoints = OBJECT_SCRIBBLE_MAX_POINTS
): NormalizedKeypoint[] {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const sampled: NormalizedKeypoint[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    sampled.push(points[Math.round(i * step)]);
  }
  return sampled;
}

export function scribbleCentroid(points: NormalizedKeypoint[]): NormalizedKeypoint {
  if (points.length === 0) return { x: 0.5, y: 0.5 };
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned box from any two corners (LTR, RTL, up, or down). */
export function normalizeNormalizedBox(
  a: NormalizedKeypoint,
  b: NormalizedKeypoint
): NormalizedBox | null {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x, b.x);
  const maxY = Math.max(a.y, b.y);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 0.01 || height < 0.01) return null;
  return { x: minX, y: minY, width, height };
}

/** Axis-aligned box of a stroke or any two corners, in normalized 0–1 image space. */
export function scribbleNormalizedBox(
  points: NormalizedKeypoint[]
): NormalizedBox | null {
  if (points.length < 2) return null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 0.01 || height < 0.01) return null;
  return { x: minX, y: minY, width, height };
}

export function normalizedBoxToPixels(
  box: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number
): BoundingBox {
  const x = Math.round(box.x * imageWidth);
  const y = Math.round(box.y * imageHeight);
  const right = Math.round((box.x + box.width) * imageWidth);
  const bottom = Math.round((box.y + box.height) * imageHeight);
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.max(1, Math.min(imageWidth, right) - Math.max(0, x)),
    height: Math.max(1, Math.min(imageHeight, bottom) - Math.max(0, y)),
  };
}

export function boxCenter(box: { x: number; y: number; width: number; height: number }): NormalizedKeypoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function boxesOverlapWell(detected: BoundingBox, guide: BoundingBox): boolean {
  const interLeft = Math.max(detected.x, guide.x);
  const interTop = Math.max(detected.y, guide.y);
  const interRight = Math.min(detected.x + detected.width, guide.x + guide.width);
  const interBottom = Math.min(detected.y + detected.height, guide.y + guide.height);
  const interW = Math.max(0, interRight - interLeft);
  const interH = Math.max(0, interBottom - interTop);
  const interArea = interW * interH;
  const detectedArea = Math.max(1, detected.width * detected.height);
  const guideArea = Math.max(1, guide.width * guide.height);
  const iou = interArea / (detectedArea + guideArea - interArea);
  const detectedTooBig = detectedArea > guideArea * 2.2;
  const mostlyOutside = interArea / detectedArea < 0.35;
  return iou >= 0.18 && !detectedTooBig && !mostlyOutside;
}

export function clampObjectPadPx(padPx: number): number {
  if (!Number.isFinite(padPx)) return 0;
  return Math.round(Math.max(OBJECT_CROP_PAD_MIN, Math.min(OBJECT_CROP_PAD_MAX, padPx)));
}

export function padCropBox(
  box: BoundingBox,
  imageWidth: number,
  imageHeight: number,
  padPx: number
): BoundingBox {
  const pad = clampObjectPadPx(padPx);
  const x = Math.max(0, Math.round(box.x - pad));
  const y = Math.max(0, Math.round(box.y - pad));
  const right = Math.min(imageWidth, Math.round(box.x + box.width + pad));
  const bottom = Math.min(imageHeight, Math.round(box.y + box.height + pad));
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

export function maskAreaRatio(
  mask: Float32Array | Uint8Array,
  width: number,
  height: number,
  threshold = OBJECT_MASK_CONFIDENCE_THRESHOLD
): number {
  if (width <= 0 || height <= 0 || mask.length === 0) return 0;
  let foreground = 0;
  const total = width * height;
  if (mask instanceof Float32Array) {
    for (let i = 0; i < total; i += 1) {
      if (mask[i] >= threshold) foreground += 1;
    }
  } else {
    for (let i = 0; i < total; i += 1) {
      if (mask[i] > 0) foreground += 1;
    }
  }
  return foreground / total;
}

export function boundsFromConfidenceMask(
  mask: Float32Array,
  width: number,
  height: number,
  threshold = OBJECT_MASK_CONFIDENCE_THRESHOLD,
  areaBounds: Pick<ObjectMaskBoundsOptions, 'minAreaRatio' | 'maxAreaRatio'> = {}
): ObjectMaskBounds | null {
  if (width <= 0 || height <= 0) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let foreground = 0;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (mask[row + x] >= threshold) {
        foreground += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;

  const areaRatio = foreground / (width * height);
  const minArea = areaBounds.minAreaRatio ?? OBJECT_MASK_MIN_AREA_RATIO;
  const maxArea = areaBounds.maxAreaRatio ?? OBJECT_MASK_MAX_AREA_RATIO;
  if (!isPlausibleObjectMaskArea(areaRatio, minArea, maxArea)) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    areaRatio,
  };
}

export function boundsFromCategoryMask(
  mask: Uint8Array,
  width: number,
  height: number,
  areaBounds: Pick<ObjectMaskBoundsOptions, 'minAreaRatio' | 'maxAreaRatio'> = {}
): ObjectMaskBounds | null {
  if (width <= 0 || height <= 0) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let foreground = 0;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (mask[row + x] > 0) {
        foreground += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;

  const areaRatio = foreground / (width * height);
  const minArea = areaBounds.minAreaRatio ?? OBJECT_MASK_MIN_AREA_RATIO;
  const maxArea = areaBounds.maxAreaRatio ?? OBJECT_MASK_MAX_AREA_RATIO;
  if (!isPlausibleObjectMaskArea(areaRatio, minArea, maxArea)) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    areaRatio,
  };
}

export function guidedMaskBoundsOptions(): ObjectMaskBoundsOptions {
  return {
    threshold: OBJECT_MASK_GUIDED_CONFIDENCE_THRESHOLD,
    minAreaRatio: OBJECT_MASK_GUIDED_MIN_AREA_RATIO,
    maxAreaRatio: OBJECT_MASK_GUIDED_MAX_AREA_RATIO,
  };
}

function seedToMaskPixel(
  seed: NormalizedKeypoint,
  width: number,
  height: number
): { x: number; y: number; index: number } {
  const x = Math.min(width - 1, Math.max(0, Math.round(seed.x * (width - 1))));
  const y = Math.min(height - 1, Math.max(0, Math.round(seed.y * (height - 1))));
  return { x, y, index: y * width + x };
}

function findComponentStartIndex(
  mask: Float32Array | Uint8Array,
  width: number,
  height: number,
  seed: NormalizedKeypoint,
  threshold: number
): number | null {
  const { x: sx, y: sy, index: startIdx } = seedToMaskPixel(seed, width, height);
  const isFloat = mask instanceof Float32Array;
  const passes = (idx: number) =>
    isFloat ? mask[idx] >= threshold : mask[idx] > 0;

  if (passes(startIdx)) return startIdx;

  const maxRadius = Math.max(8, Math.round(Math.min(width, height) * 0.08));
  let bestIdx: number | null = null;
  let bestScore = -1;
  for (let r = 1; r <= maxRadius; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const idx = y * width + x;
        const score = isFloat ? mask[idx] : mask[idx] > 0 ? 1 : 0;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      }
    }
    if (bestIdx != null && (isFloat ? bestScore >= threshold : bestScore > 0)) {
      return bestIdx;
    }
  }
  return bestIdx;
}

function boundsFromComponentMask(
  component: Uint8Array,
  width: number,
  height: number,
  areaBounds: Pick<ObjectMaskBoundsOptions, 'minAreaRatio' | 'maxAreaRatio'> = {}
): ObjectMaskBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let foreground = 0;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (component[row + x] === 0) continue;
      foreground += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;

  const areaRatio = foreground / (width * height);
  const minArea = areaBounds.minAreaRatio ?? OBJECT_MASK_MIN_AREA_RATIO;
  const maxArea = areaBounds.maxAreaRatio ?? OBJECT_MASK_MAX_AREA_RATIO;
  if (!isPlausibleObjectMaskArea(areaRatio, minArea, maxArea)) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    areaRatio,
  };
}

/** Keep only the foreground blob connected to the user's mark (ignores background bleed). */
export function extractComponentAtSeed(
  mask: Float32Array | Uint8Array,
  width: number,
  height: number,
  seed: NormalizedKeypoint,
  threshold: number,
  areaBounds: Pick<ObjectMaskBoundsOptions, 'minAreaRatio' | 'maxAreaRatio'> = {}
): { component: Uint8Array; bounds: ObjectMaskBounds | null } | null {
  if (width <= 0 || height <= 0) return null;

  const startIdx = findComponentStartIndex(mask, width, height, seed, threshold);
  if (startIdx == null) return null;

  const isFloat = mask instanceof Float32Array;
  const passes = (idx: number) =>
    isFloat ? mask[idx] >= threshold : mask[idx] > 0;

  const total = width * height;
  const component = new Uint8Array(total);
  const queue: number[] = [startIdx];
  component[startIdx] = 1;

  while (queue.length > 0) {
    const idx = queue.pop()!;
    const x = idx % width;
    const y = (idx - x) / width;

    if (x > 0) {
      const n = idx - 1;
      if (!component[n] && passes(n)) {
        component[n] = 1;
        queue.push(n);
      }
    }
    if (x < width - 1) {
      const n = idx + 1;
      if (!component[n] && passes(n)) {
        component[n] = 1;
        queue.push(n);
      }
    }
    if (y > 0) {
      const n = idx - width;
      if (!component[n] && passes(n)) {
        component[n] = 1;
        queue.push(n);
      }
    }
    if (y < height - 1) {
      const n = idx + width;
      if (!component[n] && passes(n)) {
        component[n] = 1;
        queue.push(n);
      }
    }
  }

  const bounds = boundsFromComponentMask(component, width, height, areaBounds);
  return { component, bounds };
}

export function boundsFromConfidenceMaskAtSeed(
  mask: Float32Array,
  width: number,
  height: number,
  seed: NormalizedKeypoint,
  threshold = OBJECT_MASK_CONFIDENCE_THRESHOLD,
  areaBounds: Pick<ObjectMaskBoundsOptions, 'minAreaRatio' | 'maxAreaRatio'> = {}
): { bounds: ObjectMaskBounds | null; component: Uint8Array | null } {
  const extracted = extractComponentAtSeed(mask, width, height, seed, threshold, areaBounds);
  if (!extracted) return { bounds: null, component: null };
  return { bounds: extracted.bounds, component: extracted.component };
}

export function boundsFromCategoryMaskAtSeed(
  mask: Uint8Array,
  width: number,
  height: number,
  seed: NormalizedKeypoint,
  areaBounds: Pick<ObjectMaskBoundsOptions, 'minAreaRatio' | 'maxAreaRatio'> = {}
): { bounds: ObjectMaskBounds | null; component: Uint8Array | null } {
  const extracted = extractComponentAtSeed(mask, width, height, seed, 0.5, areaBounds);
  if (!extracted) return { bounds: null, component: null };
  return { bounds: extracted.bounds, component: extracted.component };
}

export function scaleMaskBounds(
  bounds: ObjectMaskBounds,
  maskWidth: number,
  maskHeight: number,
  imageWidth: number,
  imageHeight: number
): BoundingBox {
  const scaleX = imageWidth / maskWidth;
  const scaleY = imageHeight / maskHeight;
  return {
    x: Math.round(bounds.x * scaleX),
    y: Math.round(bounds.y * scaleY),
    width: Math.max(1, Math.round(bounds.width * scaleX)),
    height: Math.max(1, Math.round(bounds.height * scaleY)),
  };
}

/** Normalized keypoints for auto object detection (center first). */
export function generateAutoSeedKeypoints(): NormalizedKeypoint[] {
  const seeds: NormalizedKeypoint[] = [{ x: 0.5, y: 0.5 }];
  const grid = OBJECT_AUTO_SEED_GRID;
  const inset = OBJECT_AUTO_SEED_INSET;
  const span = 1 - inset * 2;
  if (grid <= 1) return seeds;

  for (let row = 0; row < grid; row += 1) {
    for (let col = 0; col < grid; col += 1) {
      if (row === Math.floor(grid / 2) && col === Math.floor(grid / 2)) continue;
      seeds.push({
        x: inset + (span * col) / (grid - 1),
        y: inset + (span * row) / (grid - 1),
      });
    }
  }
  return seeds;
}

export function buildMaskOverlayRgba(
  mask: Float32Array,
  width: number,
  height: number,
  threshold = OBJECT_MASK_CONFIDENCE_THRESHOLD,
  component?: Uint8Array | null
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const span = Math.max(0.05, 1 - Math.min(1, threshold));

  for (let i = 0; i < width * height; i += 1) {
    if (component) {
      if (component[i] === 0) continue;
      const o = i * 4;
      rgba[o] = 56;
      rgba[o + 1] = 189;
      rgba[o + 2] = 248;
      rgba[o + 3] = 150;
      continue;
    }
    const confidence = mask[i];
    if (confidence <= threshold) continue;

    const t = Math.min(1, (confidence - threshold) / span);
    const alpha = Math.round(90 + t * 110);
    const o = i * 4;
    rgba[o] = 56;
    rgba[o + 1] = 189;
    rgba[o + 2] = 248;
    rgba[o + 3] = alpha;
  }
  return rgba;
}
