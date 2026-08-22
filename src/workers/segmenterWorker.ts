/**
 * Segmenter Worker — off-main-thread MagicTouch inference when supported.
 */

import './detectionWorkerPolyfills';
import type { SegmentWorkerRequest, SegmentWorkerResponse } from '../types/segmentWorker';
import {
  segmentAtRoiInBitmap,
  preloadInteractiveSegmenterRuntime,
} from '../utils/interactiveSegmenterSession';
import { downsampleScribble } from '../utils/objectMaskCrop';

const cancelledIds = new Set<string>();

function respond(response: SegmentWorkerResponse): void {
  self.postMessage(response);
}

async function bitmapFromRequest(
  request: SegmentWorkerRequest
): Promise<ImageBitmap> {
  if (!request.imageData || !request.mimeType) {
    throw new Error('Missing image data');
  }
  return createImageBitmap(new Blob([request.imageData], { type: request.mimeType }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
}

self.onmessage = async (event: MessageEvent<SegmentWorkerRequest>) => {
  const request = event.data;

  if (request.type === 'ping') {
    respond({ id: request.id, type: 'pong' });
    return;
  }

  if (request.type === 'cancel') {
    cancelledIds.add(request.id);
    return;
  }

  if (request.type === 'warmup') {
    try {
      await preloadInteractiveSegmenterRuntime();
      respond({ id: request.id, type: 'success' });
    } catch (error) {
      respond({
        id: request.id,
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (request.type !== 'segment') {
    respond({ id: request.id, type: 'error', error: 'Unknown request type' });
    return;
  }

  if (!request.keypoint && !request.scribble?.length) {
    respond({ id: request.id, type: 'error', error: 'Missing ROI' });
    return;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await bitmapFromRequest(request);
    if (cancelledIds.has(request.id)) {
      respond({ id: request.id, type: 'cancelled' });
      return;
    }

    const roi = request.scribble?.length
      ? { scribble: downsampleScribble(request.scribble) }
      : { keypoint: request.keypoint! };

    const result = await segmentAtRoiInBitmap(bitmap, roi, {
      guided: request.guided ?? Boolean(request.scribble?.length),
    });

    if (cancelledIds.has(request.id)) {
      respond({ id: request.id, type: 'cancelled' });
      return;
    }

    respond({
      id: request.id,
      type: 'success',
      photoId: request.photoId,
      bounds: result.bounds,
      areaRatio: result.areaRatio,
      keypoint: result.keypoint,
      mask: result.mask,
      loadModelMs: result.loadModelMs,
      inferenceMs: result.inferenceMs,
      imageWidth: bitmap.width,
      imageHeight: bitmap.height,
    });
  } catch (error) {
    respond({
      id: request.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    cancelledIds.delete(request.id);
    bitmap?.close();
  }
};
