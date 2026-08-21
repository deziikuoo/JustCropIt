/**
 * Detection Worker — MediaPipe portrait and multi-face detection.
 */

import './detectionWorkerPolyfills';
import type {
  DetectionWorkerRequest,
  DetectionWorkerResponse,
} from '../types/detection';
import { DETECTION_DEBUG_OVERLAY } from '../constants/optimization';
import { detectPortraitInBitmap } from '../utils/portraitDetection';
import { getPoseLandmarker } from '../utils/poseLandmarkerSession';
import { getFaceLandmarker } from '../utils/faceLandmarkerSession';

const cancelledIds = new Set<string>();

function respond(response: DetectionWorkerResponse): void {
  self.postMessage(response);
}

async function bitmapFromRequest(
  request: DetectionWorkerRequest
): Promise<ImageBitmap> {
  if (!request.imageData || !request.mimeType) {
    throw new Error('Missing image data');
  }
  return createImageBitmap(new Blob([request.imageData], { type: request.mimeType }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
}

async function handlePortrait(
  request: DetectionWorkerRequest
): Promise<DetectionWorkerResponse> {
  if (!request.target) {
    throw new Error('Missing crop target');
  }
  const bitmap = await bitmapFromRequest(request);
  const result = await detectPortraitInBitmap(bitmap, request.target, {
    closeBitmap: true,
    hintBbox: request.hintBbox,
  });
  return {
    id: request.id,
    type: 'success',
    photoId: request.photoId,
    bbox: result.bbox,
    method: result.method,
    loadModelMs: result.loadModelMs || undefined,
    inferenceMs: result.inferenceMs,
    poseInferenceMs: result.poseInferenceMs,
    faceLandmarkInferenceMs: result.faceLandmarkInferenceMs,
    faceDetectorInferenceMs: result.faceDetectorInferenceMs,
    debug:
      request.includeDebug && DETECTION_DEBUG_OVERLAY ? result.debug : undefined,
  };
}

async function handleWarmup(): Promise<void> {
  // Face Detector must stay on the main thread (Tasks WASM uses importScripts).
  await Promise.all([
    getPoseLandmarker().catch(() => null),
    getFaceLandmarker().catch(() => null),
  ]);
}

self.onmessage = async (event: MessageEvent<DetectionWorkerRequest>) => {
  const request = event.data;

  if (request.type === 'ping') {
    respond({ id: request.id, type: 'pong' });
    return;
  }

  if (request.type === 'cancel') {
    cancelledIds.add(request.id);
    return;
  }

  cancelledIds.delete(request.id);

  try {
    if (request.type === 'warmup') {
      await handleWarmup();
      if (cancelledIds.has(request.id)) {
        cancelledIds.delete(request.id);
        respond({ id: request.id, type: 'cancelled', photoId: request.photoId });
        return;
      }
      respond({ id: request.id, type: 'success', photoId: request.photoId });
      return;
    }

    let response: DetectionWorkerResponse;
    if (request.type === 'portrait' || request.type === 'detect') {
      response = await handlePortrait(request);
    } else if (request.type === 'detectFaces') {
      throw new Error(
        'Face detection runs on the main thread (MediaPipe Tasks cannot importScripts in a module worker)'
      );
    } else {
      throw new Error(`Unknown detection request: ${request.type}`);
    }

    if (cancelledIds.has(request.id)) {
      cancelledIds.delete(request.id);
      respond({
        id: request.id,
        type: 'cancelled',
        photoId: request.photoId,
      });
      return;
    }

    respond(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[DetectionWorker] Failed:', message);
    respond({
      id: request.id,
      type: 'error',
      photoId: request.photoId,
      error: message,
    });
  }
};
