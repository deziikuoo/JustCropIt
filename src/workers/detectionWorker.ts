/**
 * Detection Worker — MediaPipe Face Detector (lazy init, session-cached).
 */

import './detectionWorkerPolyfills';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import type {
  DetectionWorkerRequest,
  DetectionWorkerResponse,
  BoundingBox,
} from '../types/detection';

const MODEL_FILE = 'blaze_face_full_range.tflite';

let faceDetector: FaceDetector | null = null;
let initError: string | null = null;
let lastModelLoadMs = 0;
const cancelledIds = new Set<string>();

function getAssetBase(): string {
  const base = import.meta.env.BASE_URL;
  return new URL(base, self.location.origin).href;
}

function getWasmPath(): string {
  return new URL('mediapipe/wasm', getAssetBase()).href.replace(/\/$/, '');
}

function getModelUrl(): string {
  return new URL(`mediapipe/models/${MODEL_FILE}`, getAssetBase()).href;
}

async function getFaceDetector(): Promise<FaceDetector> {
  if (faceDetector) return faceDetector;
  if (initError) {
    throw new Error(initError);
  }

  const loadStart = performance.now();
  try {
    const wasmPath = getWasmPath();
    const vision = await FilesetResolver.forVisionTasks(wasmPath);

    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: getModelUrl(),
        delegate: 'CPU',
      },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.3,
    });
    lastModelLoadMs = performance.now() - loadStart;
    return faceDetector;
  } catch (error) {
    initError = error instanceof Error ? error.message : String(error);
    console.error('[DetectionWorker] Init failed:', initError);
    throw error;
  }
}

async function detectFace(
  imageData: ArrayBuffer,
  mimeType: string
): Promise<{
  bbox: BoundingBox | null;
  inferenceMs: number;
  loadModelMs: number;
}> {
  const inferenceStart = performance.now();
  const bitmap = await createImageBitmap(
    new Blob([imageData], { type: mimeType }),
    { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }
  );

  try {
    const loadModelMs = faceDetector ? 0 : lastModelLoadMs;
    const detector = await getFaceDetector();
    const result = detector.detect(bitmap);
    const inferenceMs = performance.now() - inferenceStart;

    const detections = result.detections ?? [];
    if (detections.length === 0) {
      return { bbox: null, inferenceMs, loadModelMs };
    }

    const best = detections.reduce((a, b) => {
      const aScore = a.categories?.[0]?.score ?? 0;
      const bScore = b.categories?.[0]?.score ?? 0;
      return bScore > aScore ? b : a;
    });

    const box = best.boundingBox;
    if (!box) {
      return { bbox: null, inferenceMs, loadModelMs };
    }

    return {
      bbox: {
        x: box.originX,
        y: box.originY,
        width: box.width,
        height: box.height,
      },
      inferenceMs,
      loadModelMs,
    };
  } finally {
    bitmap.close();
  }
}

function respond(response: DetectionWorkerResponse): void {
  self.postMessage(response);
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

  if (request.type === 'detect') {
    if (!request.imageData || !request.mimeType) {
      respond({
        id: request.id,
        type: 'error',
        photoId: request.photoId,
        error: 'Missing image data',
      });
      return;
    }

    const buffer = request.imageData;
    cancelledIds.delete(request.id);

    try {
      const { bbox, inferenceMs, loadModelMs } = await detectFace(
        buffer,
        request.mimeType
      );

      if (cancelledIds.has(request.id)) {
        cancelledIds.delete(request.id);
        respond({
          id: request.id,
          type: 'cancelled',
          photoId: request.photoId,
        });
        return;
      }

      respond({
        id: request.id,
        type: 'success',
        photoId: request.photoId,
        bbox,
        loadModelMs: loadModelMs || undefined,
        inferenceMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[DetectionWorker] Detect failed:', message);
      respond({
        id: request.id,
        type: 'error',
        photoId: request.photoId,
        error: message,
      });
    }
  }
};
