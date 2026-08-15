/**
 * Image Processing Web Worker
 * 
 * Handles CPU-intensive image operations off the main thread.
 * Optimized for mobile/Pixel devices with memory management and transferables.
 */

/// <reference lib="webworker" />

import type { WorkerRequest, WorkerResponse, FlipParams, CropParams, PasteParams } from '../types/worker';

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

    let resultBuffer: ArrayBuffer;

    const bitmap = await decodeWithRetry(imageData, mimeType);

    try {
      if (type === 'flip') {
        const p = params as FlipParams;
        const flips = { 
          horizontal: p.direction === 'horizontal', 
          vertical: p.direction === 'vertical' 
        };
        resultBuffer = await processImage(bitmap, flips, 0, undefined, mimeType);
      } else if (type === 'crop') {
        const p = params as CropParams;
        // Batch Crop ignores flips in the current App.vue implementation (uses applyRotationAndCrop)
        const flips = { horizontal: false, vertical: false };
        resultBuffer = await processImage(bitmap, flips, p.rotation || 0, p.crop, mimeType);
      } else if (type === 'paste') {
        const p = params as PasteParams;
        resultBuffer = await processImage(bitmap, p.flips, p.rotation || 0, p.crop, mimeType);
      } else {
        throw new Error(`Unsupported operation: ${type}`);
      }

      // Send success response with result buffer in transfer list (Zero-Copy)
      const response: WorkerResponse = {
        id,
        type,
        success: true,
        result: resultBuffer
      };
      
      ctx.postMessage(response, [resultBuffer]);

    } finally {
      // CRITICAL: Explicitly close the bitmap to free GPU memory immediately
      bitmap.close();
    }

  } catch (error) {
    console.error(`Worker error (${type}):`, error);
    const response: WorkerResponse = {
      id,
      type,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    ctx.postMessage(response);
  }
};

const DECODE_ATTEMPTS = 3;
const DECODE_RETRY_DELAY_MS = 200;

/**
 * `createImageBitmap` throws InvalidStateError when the browser cannot allocate
 * for the decode, not just when the bytes are bad. Retrying after a short pause
 * gives concurrent decodes time to release memory.
 */
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
        await new Promise((resolve) => setTimeout(resolve, DECODE_RETRY_DELAY_MS * attempt));
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Failed to decode ${mimeType || 'image'} (${imageData.byteLength} bytes) after ${DECODE_ATTEMPTS} attempts: ${reason}`
  );
}

/**
 * Core image processing logic mirroring App.vue's applyFlipsRotationAndCrop
 */
async function processImage(
  bitmap: ImageBitmap,
  flips: { horizontal: boolean; vertical: boolean },
  rotation: number,
  crop: { x: number; y: number; width: number; height: number } | undefined,
  mimeType: string
): Promise<ArrayBuffer> {
  const imgWidth = bitmap.width;
  const imgHeight = bitmap.height;

  // Normalize rotation
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const rotationRad = (normalizedRotation * Math.PI) / 180;

  // Step 1: Apply flips
  // We can use a temporary canvas for flips if we need to rotate/crop afterwards.
  // Or we can combine transformations if possible. 
  // App.vue uses separate canvases for clarity and correctness with the coordinate logic.
  // We'll mirror that structure for 1:1 parity.

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

  // If no rotation and no crop, we are done
  if (normalizedRotation === 0 && !crop) {
    const blob = await flipCanvas.convertToBlob({ type: mimeType });
    return await blob.arrayBuffer();
  }

  // Step 2: Apply rotation
  let rotatedWidth: number;
  let rotatedHeight: number;
  let cropX = 0, cropY = 0, cropWidth = 0, cropHeight = 0;

  // Determine dimensions after rotation
  if (normalizedRotation === 90 || normalizedRotation === 270) {
    rotatedWidth = imgHeight;
    rotatedHeight = imgWidth;
  } else {
    rotatedWidth = imgWidth;
    rotatedHeight = imgHeight;
  }

  // Prepare crop coordinates transform if crop exists
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
    } else {
      cropX = crop.x;
      cropY = crop.y;
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

  // If no crop, return rotated
  if (!crop) {
    const blob = await rotatedCanvas.convertToBlob({ type: mimeType });
    return await blob.arrayBuffer();
  }

  // Step 3: Apply crop
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

  const blob = await finalCanvas.convertToBlob({ type: mimeType });
  return await blob.arrayBuffer();
}
