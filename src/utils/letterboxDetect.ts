/**
 * Detect letterbox / pillarbox / windowbox padding (uniform near-black
 * bands added so a smaller photo fills a target aspect ratio).
 *
 * A line is a bar when almost every pixel is near-black. Night skies and
 * dark clothing fail that test because they still have brighter pixels.
 *
 * iPhone screenshot chrome (the white home-indicator pill) is ignored so
 * it cannot hide an otherwise black bottom safe area.
 */

import {
  LETTERBOX_BLACK_LIMIT,
  LETTERBOX_COVERAGE,
  LETTERBOX_HOME_BRIGHT_MIN,
  LETTERBOX_HOME_CENTER_SLACK_RATIO,
  LETTERBOX_HOME_CHROMA_MAX,
  LETTERBOX_HOME_FROM_BOTTOM_MIN_PX,
  LETTERBOX_HOME_FROM_BOTTOM_RATIO,
  LETTERBOX_HOME_MAX_WIDTH_RATIO,
  LETTERBOX_HOME_MIN_FILL,
  LETTERBOX_HOME_MIN_WIDTH_RATIO,
  LETTERBOX_MIN_CONTENT_PX,
  LETTERBOX_STRIP_PX,
} from '../constants/optimization';
import type { SuggestedCrop } from '../types/detection';

export interface LetterboxDetectOptions {
  blackLimit?: number;
  coverage?: number;
  minContentPx?: number;
  stripPx?: number;
}

export interface LetterboxBounds extends SuggestedCrop {
  trimmed: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

interface LineScanOptions {
  blackLimit: number;
  coverage: number;
}

function isNearBlack(r: number, g: number, b: number, a: number, limit: number): boolean {
  return a < 8 || Math.max(r, g, b) <= limit;
}

function lineIsBar(
  pixels: Uint8ClampedArray,
  count: number,
  strideBytes: number,
  start: number,
  options: LineScanOptions
): boolean {
  if (count <= 0) return false;
  let black = 0;
  let i = start;
  for (let n = 0; n < count; n += 1) {
    if (isNearBlack(pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3], options.blackLimit)) {
      black += 1;
    }
    i += strideBytes;
  }
  const maxNonBlack = Math.max(2, Math.ceil(count * (1 - options.coverage)));
  return count - black <= maxNonBlack;
}

function isHomeIndicatorPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 8) return false;
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  return maxc >= LETTERBOX_HOME_BRIGHT_MIN && maxc - minc <= LETTERBOX_HOME_CHROMA_MAX;
}

/**
 * iOS home indicator: a short, centered, near-white streak on an otherwise
 * black row. Colorful or full-width content is not treated as chrome.
 */
export function rowIsHomeIndicatorBar(
  imageData: ImageData,
  y: number,
  options: LineScanOptions
): boolean {
  if (y < 0 || y >= imageData.height) return false;

  const { width, data } = imageData;
  const rowStart = y * width * 4;
  let first = -1;
  let last = -1;
  let bright = 0;
  let otherNonBlack = 0;

  for (let x = 0; x < width; x += 1) {
    const i = rowStart + x * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (isNearBlack(r, g, b, a, options.blackLimit)) continue;
    if (isHomeIndicatorPixel(r, g, b, a)) {
      if (first < 0) first = x;
      last = x;
      bright += 1;
    } else {
      otherNonBlack += 1;
    }
  }

  if (first < 0 || last < first) return false;
  if (otherNonBlack > Math.max(6, Math.ceil(width * 0.012))) return false;

  const runWidth = last - first + 1;
  const minWidth = Math.max(16, Math.round(width * LETTERBOX_HOME_MIN_WIDTH_RATIO));
  const maxWidth = Math.round(width * LETTERBOX_HOME_MAX_WIDTH_RATIO);
  if (runWidth < minWidth || runWidth > maxWidth) return false;

  const runCenter = (first + last) / 2;
  const imageCenter = (width - 1) / 2;
  if (Math.abs(runCenter - imageCenter) > width * LETTERBOX_HOME_CENTER_SLACK_RATIO) {
    return false;
  }

  return bright / runWidth >= LETTERBOX_HOME_MIN_FILL;
}

function homeChromeZoneStart(imageHeight: number): number {
  return Math.max(
    0,
    imageHeight - Math.max(
      LETTERBOX_HOME_FROM_BOTTOM_MIN_PX,
      Math.round(imageHeight * LETTERBOX_HOME_FROM_BOTTOM_RATIO)
    )
  );
}

export function rowIsLetterboxBar(
  imageData: ImageData,
  localY: number,
  absoluteY: number,
  imageHeight: number,
  options: LineScanOptions,
  allowHomeChrome: boolean
): boolean {
  if (rowIsBlackBar(imageData, localY, options)) return true;
  if (!allowHomeChrome || absoluteY < homeChromeZoneStart(imageHeight)) {
    return false;
  }
  return rowIsHomeIndicatorBar(imageData, localY, options);
}

export function rowIsBlackBar(
  imageData: ImageData,
  y: number,
  options: LineScanOptions
): boolean {
  if (y < 0 || y >= imageData.height) return false;
  return lineIsBar(
    imageData.data,
    imageData.width,
    4,
    y * imageData.width * 4,
    options
  );
}

export function colIsBlackBar(
  imageData: ImageData,
  x: number,
  options: LineScanOptions
): boolean {
  if (x < 0 || x >= imageData.width) return false;
  return lineIsBar(
    imageData.data,
    imageData.height,
    imageData.width * 4,
    x * 4,
    options
  );
}

function isDrawableSource(source: unknown): source is CanvasImageSource {
  return (
    source instanceof HTMLImageElement ||
    source instanceof HTMLCanvasElement ||
    source instanceof HTMLVideoElement ||
    (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) ||
    source instanceof SVGImageElement ||
    (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame)
  );
}

function getSourceSize(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    return { width: source.width, height: source.height };
  }
  if (source instanceof HTMLCanvasElement) {
    return { width: source.width, height: source.height };
  }
  const sized = source as { width?: number; height?: number };
  return { width: sized.width ?? 0, height: sized.height ?? 0 };
}

function readStrip(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): ImageData {
  if (canvas.width !== sw) canvas.width = sw;
  if (canvas.height !== sh) canvas.height = sh;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return ctx.getImageData(0, 0, sw, sh);
}

function resolveOptions(options: LetterboxDetectOptions = {}): Required<LetterboxDetectOptions> {
  return {
    blackLimit: options.blackLimit ?? LETTERBOX_BLACK_LIMIT,
    coverage: options.coverage ?? LETTERBOX_COVERAGE,
    minContentPx: options.minContentPx ?? LETTERBOX_MIN_CONTENT_PX,
    stripPx: options.stripPx ?? LETTERBOX_STRIP_PX,
  };
}

/**
 * Scan ImageData already in memory (tests and full-frame callers).
 */
export function detectLetterboxBounds(
  imageData: ImageData,
  options: LetterboxDetectOptions = {}
): LetterboxBounds | null {
  const { width, height } = imageData;
  const resolved = resolveOptions(options);
  const lineOpts = { blackLimit: resolved.blackLimit, coverage: resolved.coverage };

  let top = 0;
  while (top < height && rowIsLetterboxBar(imageData, top, top, height, lineOpts, false)) {
    top += 1;
  }

  let bottom = height;
  while (
    bottom > top &&
    rowIsLetterboxBar(imageData, bottom - 1, bottom - 1, height, lineOpts, true)
  ) {
    bottom -= 1;
  }

  let left = 0;
  while (left < width && colIsBlackBar(imageData, left, lineOpts)) left += 1;

  let right = width;
  while (right > left && colIsBlackBar(imageData, right - 1, lineOpts)) right -= 1;

  return boundsFromEdges(left, top, right, bottom, width, height, resolved.minContentPx);
}

function boundsFromEdges(
  left: number,
  top: number,
  right: number,
  bottom: number,
  width: number,
  height: number,
  minContentPx: number
): LetterboxBounds | null {
  if (top === 0 && bottom === height && left === 0 && right === width) {
    return null;
  }

  const contentWidth = right - left;
  const contentHeight = bottom - top;
  if (contentWidth < minContentPx || contentHeight < minContentPx) {
    return null;
  }

  return {
    x: left,
    y: top,
    width: contentWidth,
    height: contentHeight,
    trimmed: {
      top,
      bottom: height - bottom,
      left,
      right: width - right,
    },
  };
}

/**
 * Scan only edge strips so a 4K decode does not need a full-frame canvas.
 */
export function detectLetterboxFromSource(
  source: CanvasImageSource,
  options: LetterboxDetectOptions = {}
): LetterboxBounds | null {
  if (!isDrawableSource(source)) {
    throw new TypeError('Letterbox detect needs a drawable image source');
  }
  const { width, height } = getSourceSize(source);
  if (width < 2 || height < 2) return null;

  const resolved = resolveOptions(options);
  const lineOpts = { blackLimit: resolved.blackLimit, coverage: resolved.coverage };
  const strip = Math.max(1, resolved.stripPx);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const top = scanTop(ctx, canvas, source, width, height, strip, lineOpts);
  const bottom = scanBottom(ctx, canvas, source, width, height, top, strip, lineOpts);
  const left = scanLeft(ctx, canvas, source, width, height, strip, lineOpts);
  const right = scanRight(ctx, canvas, source, width, height, left, strip, lineOpts);

  canvas.width = 0;
  canvas.height = 0;

  return boundsFromEdges(left, top, right, bottom, width, height, resolved.minContentPx);
}

function scanTop(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
  strip: number,
  lineOpts: LineScanOptions
): number {
  let y = 0;
  while (y < height) {
    const stripH = Math.min(strip, height - y);
    const imageData = readStrip(ctx, canvas, source, 0, y, width, stripH);
    for (let row = 0; row < stripH; row += 1) {
      if (!rowIsLetterboxBar(imageData, row, y + row, height, lineOpts, false)) {
        return y + row;
      }
    }
    y += stripH;
  }
  return height;
}

function scanBottom(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
  minY: number,
  strip: number,
  lineOpts: LineScanOptions
): number {
  let y = height;
  while (y > minY) {
    const stripH = Math.min(strip, y - minY);
    const sy = y - stripH;
    const imageData = readStrip(ctx, canvas, source, 0, sy, width, stripH);
    for (let row = stripH - 1; row >= 0; row -= 1) {
      if (!rowIsLetterboxBar(imageData, row, sy + row, height, lineOpts, true)) {
        return sy + row + 1;
      }
    }
    y -= stripH;
  }
  return minY;
}

function scanLeft(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
  strip: number,
  lineOpts: LineScanOptions
): number {
  let x = 0;
  while (x < width) {
    const stripW = Math.min(strip, width - x);
    const imageData = readStrip(ctx, canvas, source, x, 0, stripW, height);
    for (let col = 0; col < stripW; col += 1) {
      if (!colIsBlackBar(imageData, col, lineOpts)) return x + col;
    }
    x += stripW;
  }
  return width;
}

function scanRight(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
  minX: number,
  strip: number,
  lineOpts: LineScanOptions
): number {
  let x = width;
  while (x > minX) {
    const stripW = Math.min(strip, x - minX);
    const sx = x - stripW;
    const imageData = readStrip(ctx, canvas, source, sx, 0, stripW, height);
    for (let col = stripW - 1; col >= 0; col -= 1) {
      if (!colIsBlackBar(imageData, col, lineOpts)) return sx + col + 1;
    }
    x -= stripW;
  }
  return minX;
}

export function detectLetterboxFromImage(
  image: HTMLImageElement,
  options: LetterboxDetectOptions = {}
): LetterboxBounds | null {
  return detectLetterboxFromSource(image, options);
}

export async function detectLetterboxFromBlob(
  blob: Blob,
  options: LetterboxDetectOptions = {}
): Promise<LetterboxBounds | null> {
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    return detectLetterboxFromSource(bitmap, options);
  } finally {
    bitmap.close();
  }
}

export async function detectLetterboxFromUrl(
  src: string,
  options: LetterboxDetectOptions = {}
): Promise<LetterboxBounds | null> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to load image (${response.status})`);
  }
  return detectLetterboxFromBlob(await response.blob(), options);
}
