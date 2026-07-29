/**
 * Main-thread MediaPipe Pose Landmarker session.
 */

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { getModelUrl, getWasmPath } from './mediapipeAssets';

const MODEL_FILE = 'pose_landmarker_lite.task';

let poseLandmarker: PoseLandmarker | null = null;
let initPromise: Promise<PoseLandmarker> | null = null;
let initError: string | null = null;
let lastModelLoadMs = 0;

export async function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (poseLandmarker) return poseLandmarker;
  if (initError) throw new Error(initError);
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const loadStart = performance.now();
    try {
      const vision = await FilesetResolver.forVisionTasks(getWasmPath());
      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: getModelUrl(MODEL_FILE),
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        numPoses: 1,
        minPoseDetectionConfidence: 0.4,
        minPosePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
        outputSegmentationMasks: false,
      });
      lastModelLoadMs = performance.now() - loadStart;
      poseLandmarker = landmarker;
      return landmarker;
    } catch (error) {
      initError = error instanceof Error ? error.message : String(error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

export interface PoseLandmarkDetectResult {
  landmarks: NormalizedLandmark[] | null;
  inferenceMs: number;
  loadModelMs: number;
}

export async function detectPoseInBitmap(
  bitmap: ImageBitmap
): Promise<PoseLandmarkDetectResult> {
  const inferenceStart = performance.now();
  const loadModelMs = poseLandmarker ? 0 : lastModelLoadMs;

  const landmarker = await getPoseLandmarker();
  const result = landmarker.detect(bitmap);
  const inferenceMs = performance.now() - inferenceStart;

  const landmarks = result.landmarks?.[0] ?? null;
  return { landmarks, inferenceMs, loadModelMs };
}

export function resetPoseLandmarkerSession(): void {
  if (poseLandmarker) {
    poseLandmarker.close();
    poseLandmarker = null;
  }
  initPromise = null;
  initError = null;
  lastModelLoadMs = 0;
}
