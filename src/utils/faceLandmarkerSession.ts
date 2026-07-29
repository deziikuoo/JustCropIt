/**
 * Main-thread MediaPipe Face Landmarker session.
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { getModelUrl, getWasmPath } from './mediapipeAssets';

const MODEL_FILE = 'face_landmarker.task';

let faceLandmarker: FaceLandmarker | null = null;
let initPromise: Promise<FaceLandmarker> | null = null;
let initError: string | null = null;
let lastModelLoadMs = 0;

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (faceLandmarker) return faceLandmarker;
  if (initError) throw new Error(initError);
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const loadStart = performance.now();
    try {
      const vision = await FilesetResolver.forVisionTasks(getWasmPath());
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: getModelUrl(MODEL_FILE),
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        numFaces: 1,
        minFaceDetectionConfidence: 0.3,
        minFacePresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      lastModelLoadMs = performance.now() - loadStart;
      faceLandmarker = landmarker;
      return landmarker;
    } catch (error) {
      initError = error instanceof Error ? error.message : String(error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

export interface FaceLandmarkDetectResult {
  landmarks: NormalizedLandmark[] | null;
  inferenceMs: number;
  loadModelMs: number;
}

export async function detectFaceLandmarksInBitmap(
  bitmap: ImageBitmap
): Promise<FaceLandmarkDetectResult> {
  const inferenceStart = performance.now();
  const loadModelMs = faceLandmarker ? 0 : lastModelLoadMs;

  const landmarker = await getFaceLandmarker();
  const result = landmarker.detect(bitmap);
  const inferenceMs = performance.now() - inferenceStart;

  const landmarks = result.faceLandmarks?.[0] ?? null;
  return { landmarks, inferenceMs, loadModelMs };
}

export function resetFaceLandmarkerSession(): void {
  if (faceLandmarker) {
    faceLandmarker.close();
    faceLandmarker = null;
  }
  initPromise = null;
  initError = null;
  lastModelLoadMs = 0;
}
