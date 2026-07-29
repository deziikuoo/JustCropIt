/**
 * Main-thread MediaPipe Face Detector session.
 * MediaPipe 0.10.x uses importScripts() which ES module workers cannot run;
 * initialization on the main document avoids that limitation.
 */

import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import type { BoundingBox } from '../types/detection';
import { getModelUrl, getWasmPath } from './mediapipeAssets';

const MODEL_FILE = 'blaze_face_short_range.tflite';

let faceDetector: FaceDetector | null = null;
let initPromise: Promise<FaceDetector> | null = null;
let initError: string | null = null;
let lastModelLoadMs = 0;

export async function getFaceDetector(): Promise<FaceDetector> {
  if (faceDetector) return faceDetector;
  if (initError) throw new Error(initError);
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const loadStart = performance.now();
    try {
      const vision = await FilesetResolver.forVisionTasks(getWasmPath());
      const detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: getModelUrl(MODEL_FILE),
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.3,
      });
      lastModelLoadMs = performance.now() - loadStart;
      faceDetector = detector;
      return detector;
    } catch (error) {
      initError = error instanceof Error ? error.message : String(error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

export interface FaceDetectResult {
  bbox: BoundingBox | null;
  inferenceMs: number;
  loadModelMs: number;
}

export async function detectFaceInBitmap(
  bitmap: ImageBitmap,
  options?: { closeBitmap?: boolean }
): Promise<FaceDetectResult> {
  const closeBitmap = options?.closeBitmap ?? true;
  const inferenceStart = performance.now();
  const loadModelMs = faceDetector ? 0 : lastModelLoadMs;

  try {
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
    if (closeBitmap) {
      bitmap.close();
    }
  }
}

export function isFaceDetectionSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof createImageBitmap !== 'undefined'
  );
}

export function resetFaceDetectorSession(): void {
  if (faceDetector) {
    faceDetector.close();
    faceDetector = null;
  }
  initPromise = null;
  initError = null;
  lastModelLoadMs = 0;
}
