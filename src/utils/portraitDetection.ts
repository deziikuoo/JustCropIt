/**
 * Portrait detection — pose + face landmarks with face-detector fallback.
 */

import type {
  BoundingBox,
  PortraitDetectionMethod,
  ImageDimensions,
  PortraitDebugOverlay,
} from '../types/detection';
import { detectFaceInBitmap } from './faceDetectorSession';
import { detectFaceLandmarksInBitmap } from './faceLandmarkerSession';
import { detectPoseInBitmap } from './poseLandmarkerSession';
import {
  buildPortraitBboxFromFaceDetector,
  buildPortraitBboxFromFaceLandmarks,
  buildPortraitBboxFromPose,
  buildPortraitBboxFromPoseAndFace,
  buildPortraitDebugOverlay,
  canUseFaceLandmarks,
  canUsePoseLandmarks,
  resolveHorizontalMeta,
} from './portraitCropBuilder';

/** Safety clamp for face-detector fallback when no dense landmarks exist. */
function clampWidthToFaceBbox(
  bbox: BoundingBox,
  faceBbox: BoundingBox,
  imageSize: ImageDimensions
): BoundingBox {
  const maxWidth = faceBbox.width * 1.35;
  if (bbox.width <= maxWidth) return bbox;

  const cx = bbox.x + bbox.width / 2;
  let left = cx - maxWidth / 2;
  let right = cx + maxWidth / 2;

  if (left < 0) {
    right -= left;
    left = 0;
  }
  if (right > imageSize.width) {
    const overflow = right - imageSize.width;
    left -= overflow;
    right = imageSize.width;
    if (left < 0) left = 0;
  }

  return { x: left, y: bbox.y, width: right - left, height: bbox.height };
}

export interface PortraitDetectResult {
  bbox: BoundingBox | null;
  method: PortraitDetectionMethod | null;
  inferenceMs: number;
  loadModelMs: number;
  poseInferenceMs?: number;
  faceLandmarkInferenceMs?: number;
  faceDetectorInferenceMs?: number;
  debug?: PortraitDebugOverlay | null;
}

export async function detectPortraitInBitmap(
  bitmap: ImageBitmap
): Promise<PortraitDetectResult> {
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const imageSize = { width, height };

    const inferenceStart = performance.now();
    let loadModelMs = 0;

    const [poseResult, faceLandmarkResult] = await Promise.all([
      detectPoseInBitmap(bitmap),
      detectFaceLandmarksInBitmap(bitmap),
    ]);

    loadModelMs = poseResult.loadModelMs + faceLandmarkResult.loadModelMs;
    const poseInferenceMs = poseResult.inferenceMs;
    const faceLandmarkInferenceMs = faceLandmarkResult.inferenceMs;

    const poseLandmarks = poseResult.landmarks;
    const faceLandmarks = faceLandmarkResult.landmarks;

    const buildDebug = (bbox: BoundingBox | null): PortraitDebugOverlay =>
      buildPortraitDebugOverlay(
        imageSize,
        poseLandmarks,
        faceLandmarks,
        bbox,
        resolveHorizontalMeta(imageSize, poseLandmarks, faceLandmarks)
      );

    if (
      canUsePoseLandmarks(poseLandmarks) &&
      canUseFaceLandmarks(faceLandmarks) &&
      poseLandmarks &&
      faceLandmarks
    ) {
      const bbox = buildPortraitBboxFromPoseAndFace(
        imageSize,
        poseLandmarks,
        faceLandmarks
      );
      if (bbox) {
        return {
          bbox,
          method: 'pose+face',
          inferenceMs: performance.now() - inferenceStart,
          loadModelMs,
          poseInferenceMs,
          faceLandmarkInferenceMs,
          debug: buildDebug(bbox),
        };
      }
    }

    if (canUsePoseLandmarks(poseLandmarks) && poseLandmarks) {
      const bbox = buildPortraitBboxFromPose(
        imageSize,
        poseLandmarks,
        faceLandmarks ?? undefined
      );
      if (bbox) {
        return {
          bbox,
          method: 'pose',
          inferenceMs: performance.now() - inferenceStart,
          loadModelMs,
          poseInferenceMs,
          faceLandmarkInferenceMs,
          debug: buildDebug(bbox),
        };
      }
    }

    if (canUseFaceLandmarks(faceLandmarks) && faceLandmarks) {
      const bbox = buildPortraitBboxFromFaceLandmarks(imageSize, faceLandmarks);
      if (bbox) {
        return {
          bbox,
          method: 'face-landmark',
          inferenceMs: performance.now() - inferenceStart,
          loadModelMs,
          poseInferenceMs,
          faceLandmarkInferenceMs,
          debug: buildDebug(bbox),
        };
      }
    }

    const faceDetectResult = await detectFaceInBitmap(bitmap, {
      closeBitmap: false,
    });
    const faceDetectorInferenceMs = faceDetectResult.inferenceMs;
    loadModelMs += faceDetectResult.loadModelMs;

    if (!faceDetectResult.bbox) {
      return {
        bbox: null,
        method: null,
        inferenceMs: performance.now() - inferenceStart,
        loadModelMs,
        poseInferenceMs,
        faceLandmarkInferenceMs,
        faceDetectorInferenceMs,
        debug: buildPortraitDebugOverlay(
          imageSize,
          poseLandmarks,
          faceLandmarks,
          null,
          null
        ),
      };
    }

    const bbox = clampWidthToFaceBbox(
      buildPortraitBboxFromFaceDetector(faceDetectResult.bbox),
      faceDetectResult.bbox,
      imageSize
    );

    return {
      bbox,
      method: 'face-detector',
      inferenceMs: performance.now() - inferenceStart,
      loadModelMs,
      poseInferenceMs,
      faceLandmarkInferenceMs,
      faceDetectorInferenceMs,
      debug: buildPortraitDebugOverlay(
        imageSize,
        poseLandmarks,
        faceLandmarks,
        bbox,
        { source: 'face-detector', faceWidthPx: faceDetectResult.bbox.width * 1.35 }
      ),
    };
  } finally {
    bitmap.close();
  }
}
