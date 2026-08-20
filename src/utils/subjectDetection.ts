/**
 * Subject detection orchestration — downscale then infer on main thread.
 */

import { DETECTION_INPUT_MAX_EDGE_PX } from '../constants/optimization';
import type {
  BoundingBox,
  CropTarget,
  DetectionStageTimings,
  DownscaledImagePayload,
  PortraitDebugOverlay,
} from '../types/detection';
import { scaleBoundingBox, scalePortraitDebugOverlay } from './cropSuggestion';
import { isFaceDetectionSupported } from './faceDetectorSession';
import { detectPortraitInBitmap } from './portraitDetection';

export async function downscaleImageFile(
  file: File,
  maxEdge: number = DETECTION_INPUT_MAX_EDGE_PX
): Promise<DownscaledImagePayload & { downscaleMs: number; previewBlob: Blob }> {
  const downscaleStart = performance.now();
  const bitmap = await createImageBitmap(file, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });

  try {
    const fullWidth = bitmap.width;
    const fullHeight = bitmap.height;
    const scale = Math.min(1, maxEdge / Math.max(fullWidth, fullHeight));
    const scaledWidth = Math.max(1, Math.round(fullWidth * scale));
    const scaledHeight = Math.max(1, Math.round(fullHeight * scale));

    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(scaledWidth, scaledHeight)
        : (() => {
            const c = document.createElement('canvas');
            c.width = scaledWidth;
            c.height = scaledHeight;
            return c;
          })();

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2d context for downscale');
    }

    ctx.drawImage(bitmap, 0, 0, scaledWidth, scaledHeight);

    const previewBlob =
      'convertToBlob' in canvas
        ? await (canvas as OffscreenCanvas).convertToBlob({
            type: 'image/jpeg',
            quality: 0.85,
          })
        : await new Promise<Blob>((resolve, reject) => {
            (canvas as HTMLCanvasElement).toBlob(
              (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
              'image/jpeg',
              0.85
            );
          });

    return {
      buffer: await previewBlob.arrayBuffer(),
      mimeType: 'image/jpeg',
      fullWidth,
      fullHeight,
      scaledWidth,
      scaledHeight,
      downscaleMs: performance.now() - downscaleStart,
      previewBlob,
    };
  } finally {
    bitmap.close();
  }
}

export interface DetectSubjectResult {
  bbox: BoundingBox | null;
  timings: DetectionStageTimings;
  workerUsed: boolean;
  error?: string;
  debug?: PortraitDebugOverlay | null;
}

export async function detectSubject(
  file: File,
  _photoId: string,
  target: CropTarget
): Promise<DetectSubjectResult> {
  const timings: DetectionStageTimings = {};

  if (!isFaceDetectionSupported()) {
    return {
      bbox: null,
      timings,
      workerUsed: false,
      error: 'Detection not supported in this browser',
    };
  }

  try {
    const downscaled = await downscaleImageFile(file);
    timings.downscaleMs = downscaled.downscaleMs;

    const inferenceBitmap = await createImageBitmap(downscaled.previewBlob, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });

    const portraitResult = await detectPortraitInBitmap(inferenceBitmap, target);

    timings.loadModelMs = portraitResult.loadModelMs;
    timings.inferenceMs = portraitResult.inferenceMs;
    timings.poseInferenceMs = portraitResult.poseInferenceMs;
    timings.faceLandmarkInferenceMs = portraitResult.faceLandmarkInferenceMs;
    timings.faceDetectorInferenceMs = portraitResult.faceDetectorInferenceMs;
    if (portraitResult.method) {
      timings.portraitMethod = portraitResult.method;
    }

    const scaledSize = {
      width: downscaled.scaledWidth,
      height: downscaled.scaledHeight,
    };
    const fullSize = {
      width: downscaled.fullWidth,
      height: downscaled.fullHeight,
    };

    console.log('[crop-suggest] portrait detection result', {
      method: portraitResult.method,
      bbox: portraitResult.bbox,
      scaledImage: scaledSize,
      bboxWidthRatio: portraitResult.bbox
        ? portraitResult.bbox.width / downscaled.scaledWidth
        : null,
      widthSource: portraitResult.debug?.widthSource ?? null,
      faceWidthPx: portraitResult.debug?.faceWidthPx ?? null,
    });

    const scaledDebug = portraitResult.debug
      ? scalePortraitDebugOverlay(portraitResult.debug, scaledSize, fullSize)
      : null;

    if (!portraitResult.bbox) {
      return { bbox: null, timings, workerUsed: false, debug: scaledDebug };
    }

    const scaled = scaleBoundingBox(portraitResult.bbox, scaledSize, fullSize);

    return { bbox: scaled, timings, workerUsed: false, debug: scaledDebug };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[subjectDetection] Portrait detection failed:', message);
    return { bbox: null, timings, workerUsed: false, error: message };
  }
}

export function isDetectionSupported(): boolean {
  return isFaceDetectionSupported();
}
