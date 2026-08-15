import type { Photo } from '../../types/photo';
import type { PasteParams, WorkerRequest } from '../../types/worker';
import { imageWorkerPool } from '../imageWorkerPool';
import { hasPendingFlipBake } from '../editTransform';

/**
 * Bake deferred flips from original into an ArrayBuffer for export/download.
 * Uses the image worker pool when available; falls back to OffscreenCanvas/canvas.
 */
export async function bakeDeferredFlipsForExport(
  photo: Photo
): Promise<{ buffer: ArrayBuffer; mimeType: string; workerUsed: boolean }> {
  if (!hasPendingFlipBake(photo)) {
    const buffer = await photo.current.arrayBuffer();
    return {
      buffer,
      mimeType: photo.current.type || 'image/jpeg',
      workerUsed: false,
    };
  }

  const mimeType = photo.original.type || photo.current.type || 'image/jpeg';
  const params: PasteParams = {
    flips: { ...photo.flips },
    rotation: 0,
    // omit crop — worker returns flipped full frame
  };

  if (imageWorkerPool.isWorkerSupported()) {
    try {
      const buffer = await photo.original.arrayBuffer();
      const request: WorkerRequest = {
        id: `export-flip-${photo.id ?? photo.original.name}-${Date.now()}`,
        type: 'paste',
        imageData: buffer,
        mimeType,
        params,
      };
      const response = await imageWorkerPool.submitTask(request, [buffer]);
      if (response.success && response.result) {
        return {
          buffer: response.result,
          mimeType,
          workerUsed: true,
        };
      }
      console.warn(
        '[Export] Worker bake failed, falling back to main thread',
        response.error
      );
    } catch (err) {
      console.warn('[Export] Worker bake threw, falling back to main thread', err);
    }
  }

  const baked = await bakeFlipsOnMainThread(photo.original, photo.flips, mimeType);
  return { buffer: baked, mimeType, workerUsed: false };
}

async function bakeFlipsOnMainThread(
  file: File,
  flips: { horizontal: boolean; vertical: boolean },
  mimeType: string
): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(file);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), {
            width,
            height,
          });

    const ctx = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) {
      throw new Error('Failed to get canvas context for flip bake');
    }

    if (flips.horizontal && flips.vertical) {
      ctx.scale(-1, -1);
      ctx.drawImage(bitmap, -width, -height);
    } else if (flips.horizontal) {
      ctx.scale(-1, 1);
      ctx.drawImage(bitmap, -width, 0);
    } else if (flips.vertical) {
      ctx.scale(1, -1);
      ctx.drawImage(bitmap, 0, -height);
    } else {
      ctx.drawImage(bitmap, 0, 0);
    }

    if ('convertToBlob' in canvas) {
      const blob = await (canvas as OffscreenCanvas).convertToBlob({
        type: mimeType,
      });
      return blob.arrayBuffer();
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      (canvas as HTMLCanvasElement).toBlob(resolve, mimeType);
    });
    if (!blob) {
      throw new Error('Failed to encode flipped image');
    }
    return blob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}
