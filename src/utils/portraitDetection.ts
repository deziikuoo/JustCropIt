/**
 * Portrait detection — pose + face landmarks with face-detector fallback.
 * Honors CropTarget so users pick full body, upper/lower body, head & shoulders, or head.
 */

import type {
  BoundingBox,
  CropTarget,
  PortraitDetectionMethod,
  PortraitDebugOverlay,
} from '../types/detection';
import { detectFaceInBitmap } from './faceDetectorSession';
import { detectFaceLandmarksInBitmap } from './faceLandmarkerSession';
import { detectPoseInBitmap } from './poseLandmarkerSession';
import { faceBboxToHeadNeckBbox } from './cropSuggestion';
import {
  buildFullBodyBboxFromPose,
  buildFullHeadBboxFromLandmarks,
  buildHeadAndShouldersBboxFromPose,
  buildLowerBodyBboxFromPose,
  buildPortraitBboxFromFaceDetector,
  buildPortraitBboxFromFaceLandmarks,
  buildPortraitDebugOverlay,
  buildUpperBodyBboxFromPose,
  canUseFaceLandmarks,
  canUseLowerBodyPose,
  canUsePoseLandmarks,
  resolveHorizontalMeta,
} from './portraitCropBuilder';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

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

interface LandmarkBundle {
  poseLandmarks: NormalizedLandmark[] | null;
  faceLandmarks: NormalizedLandmark[] | null;
  poseInferenceMs: number;
  faceLandmarkInferenceMs: number;
  loadModelMs: number;
}

async function loadLandmarks(
  bitmap: ImageBitmap,
  needPose: boolean,
  needFaceLandmarks: boolean
): Promise<LandmarkBundle> {
  let poseInferenceMs = 0;
  let faceLandmarkInferenceMs = 0;
  let poseLandmarks: NormalizedLandmark[] | null = null;
  let faceLandmarks: NormalizedLandmark[] | null = null;
  let loadModelMs = 0;

  const posePromise = needPose
    ? detectPoseInBitmap(bitmap)
    : Promise.resolve(null);
  const facePromise = needFaceLandmarks
    ? detectFaceLandmarksInBitmap(bitmap)
    : Promise.resolve(null);

  const [poseResult, faceLandmarkResult] = await Promise.all([
    posePromise,
    facePromise,
  ]);

  if (poseResult) {
    loadModelMs += poseResult.loadModelMs;
    poseInferenceMs = poseResult.inferenceMs;
    poseLandmarks = poseResult.landmarks;
  }
  if (faceLandmarkResult) {
    loadModelMs += faceLandmarkResult.loadModelMs;
    faceLandmarkInferenceMs = faceLandmarkResult.inferenceMs;
    faceLandmarks = faceLandmarkResult.landmarks;
  }

  return {
    poseLandmarks,
    faceLandmarks,
    poseInferenceMs,
    faceLandmarkInferenceMs,
    loadModelMs,
  };
}

function emptyResult(
  inferenceStart: number,
  loadModelMs: number,
  extras: Partial<PortraitDetectResult> = {}
): PortraitDetectResult {
  return {
    bbox: null,
    method: null,
    inferenceMs: performance.now() - inferenceStart,
    loadModelMs,
    ...extras,
  };
}

export async function detectPortraitInBitmap(
  bitmap: ImageBitmap,
  target: CropTarget
): Promise<PortraitDetectResult> {
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const imageSize = { width, height };
    const inferenceStart = performance.now();

    const needPose = true;
    const needFaceLandmarks =
      target === 'head' ||
      target === 'head-shoulders' ||
      target === 'upper-body' ||
      target === 'full-body';

    const landmarks = await loadLandmarks(bitmap, needPose, needFaceLandmarks);
    let { loadModelMs } = landmarks;
    const {
      poseLandmarks,
      faceLandmarks,
      poseInferenceMs,
      faceLandmarkInferenceMs,
    } = landmarks;

    const buildDebug = (bbox: BoundingBox | null): PortraitDebugOverlay =>
      buildPortraitDebugOverlay(
        imageSize,
        poseLandmarks,
        faceLandmarks,
        bbox,
        resolveHorizontalMeta(imageSize, poseLandmarks, faceLandmarks)
      );

    const timingBase = {
      poseInferenceMs: needPose ? poseInferenceMs : undefined,
      faceLandmarkInferenceMs: needFaceLandmarks
        ? faceLandmarkInferenceMs
        : undefined,
    };

    const done = (
      bbox: BoundingBox | null,
      method: PortraitDetectionMethod | null,
      extra: Partial<PortraitDetectResult> = {}
    ): PortraitDetectResult => ({
      bbox,
      method,
      inferenceMs: performance.now() - inferenceStart,
      loadModelMs,
      ...timingBase,
      debug: bbox ? buildDebug(bbox) : buildDebug(null),
      ...extra,
    });

    if (target === 'head') {
      const headBox = buildFullHeadBboxFromLandmarks(
        imageSize,
        faceLandmarks,
        poseLandmarks
      );
      if (headBox) {
        return done(
          headBox,
          canUseFaceLandmarks(faceLandmarks) ? 'face-landmark' : 'pose'
        );
      }

      const faceDetectResult = await detectFaceInBitmap(bitmap, {
        closeBitmap: false,
      });
      loadModelMs += faceDetectResult.loadModelMs;
      if (!faceDetectResult.bbox) {
        return emptyResult(inferenceStart, loadModelMs, {
          ...timingBase,
          faceDetectorInferenceMs: faceDetectResult.inferenceMs,
          debug: buildDebug(null),
        });
      }

      const bbox = faceBboxToHeadNeckBbox(faceDetectResult.bbox, {
        topExtendRatio: 0.5,
        bottomExtendRatio: 0.12,
        sideExtendRatio: 0.22,
      });
      return done(bbox, 'face-detector', {
        faceDetectorInferenceMs: faceDetectResult.inferenceMs,
      });
    }

    if (target === 'head-shoulders') {
      if (poseLandmarks) {
        const bbox = buildHeadAndShouldersBboxFromPose(
          imageSize,
          poseLandmarks,
          faceLandmarks ?? undefined
        );
        if (bbox) return done(bbox, 'pose');
      }

      if (canUseFaceLandmarks(faceLandmarks) && faceLandmarks) {
        const faceBox = buildPortraitBboxFromFaceLandmarks(imageSize, faceLandmarks);
        if (faceBox) {
          const bbox = {
            x: faceBox.x - faceBox.width * 0.35,
            y: faceBox.y - faceBox.height * 0.08,
            width: faceBox.width * 1.7,
            height: faceBox.height * 1.55,
          };
          return done(bbox, 'face-landmark');
        }
      }

      const faceDetectResult = await detectFaceInBitmap(bitmap, {
        closeBitmap: false,
      });
      loadModelMs += faceDetectResult.loadModelMs;
      if (!faceDetectResult.bbox) {
        return emptyResult(inferenceStart, loadModelMs, {
          ...timingBase,
          faceDetectorInferenceMs: faceDetectResult.inferenceMs,
          debug: buildDebug(null),
        });
      }

      const bbox = buildPortraitBboxFromFaceDetector(faceDetectResult.bbox);
      const expanded = {
        x: bbox.x - bbox.width * 0.28,
        y: bbox.y,
        width: bbox.width * 1.56,
        height: bbox.height * 1.2,
      };
      return done(expanded, 'face-detector', {
        faceDetectorInferenceMs: faceDetectResult.inferenceMs,
      });
    }

    if (target === 'full-body') {
      if (poseLandmarks) {
        const bbox = buildFullBodyBboxFromPose(
          imageSize,
          poseLandmarks,
          faceLandmarks ?? undefined
        );
        if (bbox) return done(bbox, 'pose');
      }
      return emptyResult(inferenceStart, loadModelMs, {
        ...timingBase,
        debug: buildDebug(null),
      });
    }

    if (target === 'upper-body') {
      if (canUsePoseLandmarks(poseLandmarks) && poseLandmarks) {
        const bbox = buildUpperBodyBboxFromPose(
          imageSize,
          poseLandmarks,
          faceLandmarks ?? undefined
        );
        if (bbox) return done(bbox, 'pose');
      }
      return emptyResult(inferenceStart, loadModelMs, {
        ...timingBase,
        debug: buildDebug(null),
      });
    }

    if (target === 'lower-body') {
      if (canUseLowerBodyPose(poseLandmarks) && poseLandmarks) {
        const bbox = buildLowerBodyBboxFromPose(imageSize, poseLandmarks);
        if (bbox) return done(bbox, 'pose');
      }
      return emptyResult(inferenceStart, loadModelMs, {
        ...timingBase,
        debug: buildDebug(null),
      });
    }

    return emptyResult(inferenceStart, loadModelMs, {
      ...timingBase,
      debug: buildDebug(null),
    });
  } finally {
    bitmap.close();
  }
}
