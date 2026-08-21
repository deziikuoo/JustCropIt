/**
 * Image Processing Web Worker
 *
 * Handles CPU-intensive image operations off the main thread.
 * Optimized for mobile/Pixel devices with memory management and transferables.
 * Crop/flip/paste also bake a grid JPEG thumbnail in the same pass.
 */

/// <reference lib="webworker" />

import type {
  WorkerRequest,
  WorkerResponse,
  FlipParams,
  CropParams,
  PasteParams,
} from '../types/worker';
import {
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_EDGE_PX,
} from '../constants/optimization';
import { computeThumbnailDimensions } from '../utils/thumbnailGenerator';

const ctx: DedicatedWorkerGlobalScope = self as any;

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, imageData, mimeType, params } = event.data;

  try {
    if (type === 'ping') {
      const response: WorkerResponse = { id, type, success: true };
      ctx.postMessage(response);
      return;
    }

    if (!imageData || !mimeType) {
      throw new Error('Missing image data or mime type');
    }

    const bitmap = await decodeWithRetry(imageData, mimeType);

    try {
      let processed: { result: ArrayBuffer; thumbnail: ArrayBuffer };

      if (type === 'flip') {
        const p = params as FlipParams;
        const flips = {
          horizontal: p.direction === 'horizontal',
          vertical: p.direction === 'vertical',
        };
        processed = await processImage(bitmap, flips, 0, undefined, mimeType);
      } else if (type === 'crop') {
        const p = params as CropParams;
        // Batch Crop ignores flips in the current App.vue implementation
        const flips = { horizontal: false, vertical: false };
        processed = await processImage(
          bitmap,
          flips,
          p.rotation || 0,
          p.crop,
          mimeType
        );
      } else if (type === 'paste') {
        const p = params as PasteParams;
        processed = await processImage(
          bitmap,
          p.flips,
          p.rotation || 0,
          p.crop,
          mimeType
        );
      } else {
        throw new Error(`Unsupported operation: ${type}`);
      }

      const response: WorkerResponse = {
        id,
        type,
        success: true,
        result: processed.result,
        thumbnailBuffer: processed.thumbnail,
      };

      ctx.postMessage(response, [processed.result, processed.thumbnail]);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    console.error(`Worker error (${type}):`, error);
    const response: WorkerResponse = {
      id,
      type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(response);
  }
};

const DECODE_ATTEMPTS = 3;
const DECODE_RETRY_DELAY_MS = 200;

async function decodeWithRetry(
  imageData: ArrayBuffer,
  mimeType: string
): Promise<ImageBitmap> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DECODE_ATTEMPTS; attempt++) {
    try {
      return await createImageBitmap(new Blob([imageData], { type: mimeType }), {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
    } catch (error) {
      lastError = error;
      if (attempt < DECODE_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, DECODE_RETRY_DELAY_MS * attempt)
        );
      }
    }
  }

  const reason =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Failed to decode ${mimeType || 'image'} (${imageData.byteLength} bytes) after ${DECODE_ATTEMPTS} attempts: ${reason}`
  );
}

async function encodeThumbnailFromCanvas(
  source: OffscreenCanvas
): Promise<ArrayBuffer> {
  const dims = computeThumbnailDimensions(
    source.width,
    source.height,
    THUMBNAIL_MAX_EDGE_PX
  );
  const thumbCanvas = new OffscreenCanvas(dims.width, dims.height);
  const thumbCtx = thumbCanvas.getContext('2d');
  if (!thumbCtx) throw new Error('Failed to get thumbnail context');
  thumbCtx.drawImage(source, 0, 0, dims.width, dims.height);
  const blob = await thumbCanvas.convertToBlob({
    type: 'image/jpeg',
    quality: THUMBNAIL_JPEG_QUALITY,
  });
  return blob.arrayBuffer();
}

async function canvasToResultAndThumb(
  canvas: OffscreenCanvas,
  mimeType: string
): Promise<{ result: ArrayBuffer; thumbnail: ArrayBuffer }> {
  const [resultBlob, thumbnail] = await Promise.all([
    canvas.convertToBlob({ type: mimeType }),
    encodeThumbnailFromCanvas(canvas),
  ]);
  return {
    result: await resultBlob.arrayBuffer(),
    thumbnail,
  };
}

/**
 * Core image processing logic mirroring App.vue's applyFlipsRotationAndCrop.
 * Also bakes a grid JPEG thumbnail from the final canvas.
 */
async function processImage(
  bitmap: ImageBitmap,
  flips: { horizontal: boolean; vertical: boolean },
  rotation: number,
  crop: { x: number; y: number; width: number; height: number } | undefined,
  mimeType: string
): Promise<{ result: ArrayBuffer; thumbnail: ArrayBuffer }> {
  const imgWidth = bitmap.width;
  const imgHeight = bitmap.height;

  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const rotationRad = (normalizedRotation * Math.PI) / 180;

  const flipCanvas = new OffscreenCanvas(imgWidth, imgHeight);
  const flipCtx = flipCanvas.getContext('2d');
  if (!flipCtx) throw new Error('Failed to get flip context');

  if (flips.horizontal && flips.vertical) {
    flipCtx.scale(-1, -1);
    flipCtx.drawImage(bitmap, -imgWidth, -imgHeight);
  } else if (flips.horizontal) {
    flipCtx.scale(-1, 1);
    flipCtx.drawImage(bitmap, -imgWidth, 0);
  } else if (flips.vertical) {
    flipCtx.scale(1, -1);
    flipCtx.drawImage(bitmap, 0, -imgHeight);
  } else {
    flipCtx.drawImage(bitmap, 0, 0);
  }

  if (normalizedRotation === 0 && !crop) {
    return canvasToResultAndThumb(flipCanvas, mimeType);
  }

  let rotatedWidth: number;
  let rotatedHeight: number;
  let cropX = 0,
    cropY = 0,
    cropWidth = 0,
    cropHeight = 0;

  if (normalizedRotation === 90 || normalizedRotation === 270) {
    rotatedWidth = imgHeight;
    rotatedHeight = imgWidth;
  } else if (normalizedRotation === 0 || normalizedRotation === 180) {
    rotatedWidth = imgWidth;
    rotatedHeight = imgHeight;
  } else {
    const cos = Math.abs(Math.cos(rotationRad));
    const sin = Math.abs(Math.sin(rotationRad));
    rotatedWidth = Math.round(imgWidth * cos + imgHeight * sin);
    rotatedHeight = Math.round(imgWidth * sin + imgHeight * cos);
  }

  if (crop) {
    cropWidth = crop.width;
    cropHeight = crop.height;

    if (normalizedRotation === 90) {
      cropX = crop.y;
      cropY = imgWidth - crop.x - crop.width;
      cropWidth = crop.height;
      cropHeight = crop.width;
    } else if (normalizedRotation === 180) {
      cropX = imgWidth - crop.x - crop.width;
      cropY = imgHeight - crop.y - crop.height;
    } else if (normalizedRotation === 270) {
      cropX = imgHeight - crop.y - crop.height;
      cropY = crop.x;
      cropWidth = crop.height;
      cropHeight = crop.width;
    } else if (normalizedRotation === 0) {
      cropX = crop.x;
      cropY = crop.y;
    } else {
      const cos = Math.cos(rotationRad);
      const sin = Math.sin(rotationRad);
      const cx = crop.x + crop.width / 2 - imgWidth / 2;
      const cy = crop.y + crop.height / 2 - imgHeight / 2;
      const rcx = cx * cos - cy * sin;
      const rcy = cx * sin + cy * cos;
      cropX = rotatedWidth / 2 + rcx - cropWidth / 2;
      cropY = rotatedHeight / 2 + rcy - cropHeight / 2;
    }
  }

  const rotatedCanvas = new OffscreenCanvas(rotatedWidth, rotatedHeight);
  const rotatedCtx = rotatedCanvas.getContext('2d');
  if (!rotatedCtx) throw new Error('Failed to get rotated context');

  rotatedCtx.save();
  rotatedCtx.translate(rotatedWidth / 2, rotatedHeight / 2);
  rotatedCtx.rotate(rotationRad);
  rotatedCtx.drawImage(flipCanvas, -imgWidth / 2, -imgHeight / 2);
  rotatedCtx.restore();

  if (!crop) {
    return canvasToResultAndThumb(rotatedCanvas, mimeType);
  }

  const finalCanvas = new OffscreenCanvas(cropWidth, cropHeight);
  const finalCtx = finalCanvas.getContext('2d');
  if (!finalCtx) throw new Error('Failed to get final context');

  finalCtx.drawImage(
    rotatedCanvas,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight
  );

  return canvasToResultAndThumb(finalCanvas, mimeType);
}
