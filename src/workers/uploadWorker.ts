/**
 * Upload Ingest Web Worker
 * Single-pass EXIF orientation normalize + thumbnail encode.
 */

/// <reference lib="webworker" />

import type { UploadWorkerRequest, UploadWorkerResponse } from '../types/import';
import {
  drawOrientedImage,
  getOrientedDimensions,
  needsOrientationNormalize,
} from '../utils/import/exifOrientation';
import { computeThumbnailDimensions } from '../utils/thumbnailGenerator';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function computeThumbDimensions(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  return computeThumbnailDimensions(width, height, maxEdge);
}

async function canvasToJpeg(
  canvas: OffscreenCanvas,
  quality: number
): Promise<Blob> {
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

function outputMimeType(sourceMime: string): string {
  const normalized = sourceMime.toLowerCase();
  if (normalized === 'image/webp') return 'image/webp';
  return 'image/jpeg';
}

async function processThumbnail(
  imageData: ArrayBuffer,
  mimeType: string,
  thumbnailMaxEdge: number,
  thumbnailQuality: number
): Promise<{ thumbnailBuffer: ArrayBuffer; width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([imageData], { type: mimeType }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });

  try {
    const thumbDims = computeThumbDimensions(
      bitmap.width,
      bitmap.height,
      thumbnailMaxEdge
    );
    const thumbCanvas = new OffscreenCanvas(thumbDims.width, thumbDims.height);
    const thumbCtx = thumbCanvas.getContext('2d');
    if (!thumbCtx) throw new Error('Failed to get thumbnail context');

    thumbCtx.drawImage(bitmap, 0, 0, thumbDims.width, thumbDims.height);
    const thumbnailBlob = await canvasToJpeg(thumbCanvas, thumbnailQuality);
    const thumbnailBuffer = await thumbnailBlob.arrayBuffer();

    return {
      thumbnailBuffer,
      width: thumbDims.width,
      height: thumbDims.height,
    };
  } finally {
    bitmap.close();
  }
}

async function processStripExif(
  imageData: ArrayBuffer,
  mimeType: string,
  jpegQuality: number
): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(new Blob([imageData], { type: mimeType }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get strip context');

    ctx.drawImage(bitmap, 0, 0);

    const outputMime = outputMimeType(mimeType);
    const blob = await canvas.convertToBlob({
      type: outputMime,
      quality: outputMime === 'image/jpeg' ? jpegQuality : undefined,
    });

    return blob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}

async function processIngest(
  imageData: ArrayBuffer,
  mimeType: string,
  orientation: number,
  thumbnailMaxEdge: number,
  thumbnailQuality: number,
  normalizedJpegQuality: number
): Promise<{
  normalizedBuffer: ArrayBuffer;
  thumbnailBuffer: ArrayBuffer;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(new Blob([imageData], { type: mimeType }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });

  try {
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const mustNormalize = needsOrientationNormalize(orientation);

    let normalizedWidth: number;
    let normalizedHeight: number;
    let normalizedCanvas: OffscreenCanvas;

    if (mustNormalize) {
      const dims = getOrientedDimensions(sourceWidth, sourceHeight, orientation);
      normalizedWidth = dims.width;
      normalizedHeight = dims.height;
      normalizedCanvas = new OffscreenCanvas(normalizedWidth, normalizedHeight);
      const normCtx = normalizedCanvas.getContext('2d');
      if (!normCtx) throw new Error('Failed to get normalize context');
      drawOrientedImage(
        normCtx,
        bitmap,
        sourceWidth,
        sourceHeight,
        orientation
      );
    } else {
      normalizedWidth = sourceWidth;
      normalizedHeight = sourceHeight;
      normalizedCanvas = new OffscreenCanvas(normalizedWidth, normalizedHeight);
      const normCtx = normalizedCanvas.getContext('2d');
      if (!normCtx) throw new Error('Failed to get copy context');
      normCtx.drawImage(bitmap, 0, 0);
    }

    const normalizedBlob = await canvasToJpeg(
      normalizedCanvas,
      normalizedJpegQuality
    );
    const normalizedBuffer = await normalizedBlob.arrayBuffer();

    const thumbDims = computeThumbDimensions(
      normalizedWidth,
      normalizedHeight,
      thumbnailMaxEdge
    );
    const thumbCanvas = new OffscreenCanvas(thumbDims.width, thumbDims.height);
    const thumbCtx = thumbCanvas.getContext('2d');
    if (!thumbCtx) throw new Error('Failed to get thumbnail context');

    thumbCtx.drawImage(
      normalizedCanvas,
      0,
      0,
      normalizedWidth,
      normalizedHeight,
      0,
      0,
      thumbDims.width,
      thumbDims.height
    );

    const thumbnailBlob = await canvasToJpeg(thumbCanvas, thumbnailQuality);
    const thumbnailBuffer = await thumbnailBlob.arrayBuffer();

    return {
      normalizedBuffer,
      thumbnailBuffer,
      width: normalizedWidth,
      height: normalizedHeight,
    };
  } finally {
    bitmap.close();
  }
}

ctx.onmessage = async (event: MessageEvent<UploadWorkerRequest>) => {
  const {
    id,
    type,
    imageData,
    mimeType,
    orientation = 1,
    thumbnailMaxEdge = 400,
    thumbnailQuality = 0.82,
    normalizedJpegQuality = 0.92,
  } = event.data;

  try {
    if (type === 'ping') {
      const response: UploadWorkerResponse = { id, type, success: true };
      ctx.postMessage(response);
      return;
    }

    if (!imageData || !mimeType) {
      throw new Error('Missing image data or mime type');
    }

    if (type === 'stripExif') {
      const jpegQuality = event.data.jpegQuality ?? 0.92;
      const strippedBuffer = await processStripExif(
        imageData,
        mimeType,
        jpegQuality
      );

      const response: UploadWorkerResponse = {
        id,
        type: 'stripExif',
        success: true,
        strippedBuffer,
      };

      ctx.postMessage(response, [strippedBuffer]);
      return;
    }

    if (type === 'thumbnail') {
      const result = await processThumbnail(
        imageData,
        mimeType,
        thumbnailMaxEdge,
        thumbnailQuality
      );

      const response: UploadWorkerResponse = {
        id,
        type: 'thumbnail',
        success: true,
        thumbnailBuffer: result.thumbnailBuffer,
        width: result.width,
        height: result.height,
      };

      ctx.postMessage(response, [result.thumbnailBuffer]);
      return;
    }

    const result = await processIngest(
      imageData,
      mimeType,
      orientation,
      thumbnailMaxEdge,
      thumbnailQuality,
      normalizedJpegQuality
    );

    const response: UploadWorkerResponse = {
      id,
      type: 'ingest',
      success: true,
      normalizedBuffer: result.normalizedBuffer,
      thumbnailBuffer: result.thumbnailBuffer,
      width: result.width,
      height: result.height,
    };

    ctx.postMessage(response, [
      result.normalizedBuffer,
      result.thumbnailBuffer,
    ]);
  } catch (error) {
    const response: UploadWorkerResponse = {
      id,
      type: type === 'ping' ? 'ping' : type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(response);
  }
};
