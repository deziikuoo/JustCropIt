/**
 * Subject detection orchestration — downscale on main, infer in detection worker.
 */

import {
  DETECTION_DEBUG_OVERLAY,
  DETECTION_INPUT_MAX_EDGE_PX,
  IDENTITY_DETECT_MAX_EDGE_PX,
} from '../constants/optimization';
import type {
  BoundingBox,
  CropTarget,
  DetectedFace,
  DetectionStageTimings,
  DownscaledImagePayload,
  PortraitDebugOverlay,
} from '../types/detection';
import { scaleBoundingBox, scalePortraitDebugOverlay } from './cropSuggestion';
import {
  detectAllFacesInBitmap,
  detectAllFacesInRoi,
  detectAllFacesMultiScale,
  getFaceDetector,
  isFaceDetectionSupported,
  padBboxAsRoi,
} from './faceDetectorSession';
import { detectPortraitInBitmap } from './portraitDetection';
import { detectionWorkerPool } from './detectionWorkerPool';
import { identityWorkerPool } from './identityWorkerPool';
import {
  alignFaceToArcFaceTensor,
  bitmapToImageData,
  scaleFaceKeypoints,
} from './faceAlign';

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
  imageSize?: { width: number; height: number };
}

function scaledHint(
  hint: BoundingBox | undefined,
  full: { width: number; height: number },
  scaled: { width: number; height: number }
): BoundingBox | undefined {
  if (!hint) return undefined;
  return scaleBoundingBox(hint, full, scaled);
}

async function detectPortraitOnMain(
  previewBlob: Blob,
  target: CropTarget,
  hintBbox?: BoundingBox
): Promise<DetectSubjectResult['timings'] & { bbox: BoundingBox | null; debug: PortraitDebugOverlay | null | undefined }> {
  const inferenceBitmap = await createImageBitmap(previewBlob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const portraitResult = await detectPortraitInBitmap(inferenceBitmap, target, {
    closeBitmap: true,
    hintBbox,
  });
  return {
    bbox: portraitResult.bbox,
    debug: portraitResult.debug,
    loadModelMs: portraitResult.loadModelMs,
    inferenceMs: portraitResult.inferenceMs,
    poseInferenceMs: portraitResult.poseInferenceMs,
    faceLandmarkInferenceMs: portraitResult.faceLandmarkInferenceMs,
    faceDetectorInferenceMs: portraitResult.faceDetectorInferenceMs,
    portraitMethod: portraitResult.method ?? undefined,
  };
}

export async function detectSubject(
  file: File,
  photoId: string,
  target: CropTarget,
  hintBbox?: BoundingBox
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

    const scaledSize = {
      width: downscaled.scaledWidth,
      height: downscaled.scaledHeight,
    };
    const fullSize = {
      width: downscaled.fullWidth,
      height: downscaled.fullHeight,
    };
    const hint = scaledHint(hintBbox, fullSize, scaledSize);

    let bboxScaled: BoundingBox | null = null;
    let debugScaled: PortraitDebugOverlay | null | undefined;
    let workerUsed = false;

    if (detectionWorkerPool.isSupported()) {
      try {
        const buffer = downscaled.buffer;
        const response = await detectionWorkerPool.submitTask(
          {
            type: 'portrait',
            photoId,
            imageData: buffer,
            mimeType: downscaled.mimeType,
            scaledWidth: downscaled.scaledWidth,
            scaledHeight: downscaled.scaledHeight,
            target,
            hintBbox: hint,
            includeDebug: DETECTION_DEBUG_OVERLAY,
          },
          [buffer]
        );
        workerUsed = true;
        bboxScaled = response.bbox ?? null;
        debugScaled = response.debug;
        timings.loadModelMs = response.loadModelMs;
        timings.inferenceMs = response.inferenceMs;
        timings.poseInferenceMs = response.poseInferenceMs;
        timings.faceLandmarkInferenceMs = response.faceLandmarkInferenceMs;
        timings.faceDetectorInferenceMs = response.faceDetectorInferenceMs;
        if (response.method) timings.portraitMethod = response.method;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('cancelled') || message.includes('terminated')) {
          return { bbox: null, timings, workerUsed: false, error: message };
        }
        const mainResult = await detectPortraitOnMain(
          downscaled.previewBlob,
          target,
          hint
        );
        bboxScaled = mainResult.bbox;
        debugScaled = mainResult.debug;
        timings.loadModelMs = mainResult.loadModelMs;
        timings.inferenceMs = mainResult.inferenceMs;
        timings.poseInferenceMs = mainResult.poseInferenceMs;
        timings.faceLandmarkInferenceMs = mainResult.faceLandmarkInferenceMs;
        timings.faceDetectorInferenceMs = mainResult.faceDetectorInferenceMs;
        timings.portraitMethod = mainResult.portraitMethod;
      }
    } else {
      const mainResult = await detectPortraitOnMain(
        downscaled.previewBlob,
        target,
        hint
      );
      bboxScaled = mainResult.bbox;
      debugScaled = mainResult.debug;
      timings.loadModelMs = mainResult.loadModelMs;
      timings.inferenceMs = mainResult.inferenceMs;
      timings.poseInferenceMs = mainResult.poseInferenceMs;
      timings.faceLandmarkInferenceMs = mainResult.faceLandmarkInferenceMs;
      timings.faceDetectorInferenceMs = mainResult.faceDetectorInferenceMs;
      timings.portraitMethod = mainResult.portraitMethod;
    }

    const scaledDebug = debugScaled
      ? scalePortraitDebugOverlay(debugScaled, scaledSize, fullSize)
      : null;

    if (!bboxScaled) {
      return {
        bbox: null,
        timings,
        workerUsed,
        debug: scaledDebug,
        imageSize: fullSize,
      };
    }

    return {
      bbox: scaleBoundingBox(bboxScaled, scaledSize, fullSize),
      timings,
      workerUsed,
      debug: scaledDebug,
      imageSize: fullSize,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[subjectDetection] Portrait detection failed:', message);
    return { bbox: null, timings, workerUsed: false, error: message };
  }
}

export async function detectFacesInFile(
  file: File,
  _photoId: string,
  options?: {
    maxEdge?: number;
    /** Overlapping tiles for small / mid-shot faces (This person keyframes). */
    multiScale?: boolean;
    /**
     * Full-image pixel ROI (before downscale). When set, detect only inside
     * this crop (no tiles). Coordinates are in original image space.
     */
    roi?: BoundingBox;
  }
): Promise<{
  faces: DetectedFace[];
  workerUsed: boolean;
  imageSize?: { width: number; height: number };
  error?: string;
}> {
  if (!isFaceDetectionSupported()) {
    return { faces: [], workerUsed: false, error: 'Detection not supported' };
  }

  const maxEdge = options?.maxEdge ?? IDENTITY_DETECT_MAX_EDGE_PX;
  const multiScale = options?.multiScale ?? false;
  const roi = options?.roi;

  const downscaled = await downscaleImageFile(file, maxEdge);
  const scaledSize = {
    width: downscaled.scaledWidth,
    height: downscaled.scaledHeight,
  };
  const fullSize = {
    width: downscaled.fullWidth,
    height: downscaled.fullHeight,
  };

  const scaleFaces = (faces: DetectedFace[]): DetectedFace[] =>
    faces.map((face) => scaleFaceKeypoints(face, scaledSize, fullSize));

  // Face Detector WASM uses importScripts — must run on the main document.
  const bitmap = await createImageBitmap(downscaled.previewBlob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    let result;
    if (roi) {
      const scaleX = scaledSize.width / Math.max(1, fullSize.width);
      const scaleY = scaledSize.height / Math.max(1, fullSize.height);
      const scaledRoi = padBboxAsRoi(
        {
          x: roi.x * scaleX,
          y: roi.y * scaleY,
          width: roi.width * scaleX,
          height: roi.height * scaleY,
        },
        scaledSize.width,
        scaledSize.height,
        1
      );
      result = await detectAllFacesInRoi(bitmap, scaledRoi, {
        closeBitmap: false,
      });
    } else if (multiScale) {
      result = await detectAllFacesMultiScale(bitmap, { closeBitmap: false });
    } else {
      result = await detectAllFacesInBitmap(bitmap, { closeBitmap: false });
    }
    return {
      faces: scaleFaces(result.faces),
      workerUsed: false,
      imageSize: fullSize,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[subjectDetection] Face detect failed:', message);
    return { faces: [], workerUsed: false, imageSize: fullSize, error: message };
  } finally {
    bitmap.close();
  }
}

export async function embedFacesInFile(
  file: File,
  photoId: string,
  faces: DetectedFace[]
): Promise<{
  embeddings: Float32Array[];
  workerUsed: boolean;
  loadModelMs?: number;
  inferenceMs?: number;
  error?: string;
}> {
  if (faces.length === 0) {
    return { embeddings: [], workerUsed: false };
  }

  if (!identityWorkerPool.isSupported()) {
    return {
      embeddings: [],
      workerUsed: false,
      error:
        identityWorkerPool.getLastError() ??
        'Face matching is not available in this browser',
    };
  }

  try {
    const bitmap = await createImageBitmap(file, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    try {
      const imageData = await bitmapToImageData(bitmap);
      const tensors = faces.map((face) =>
        alignFaceToArcFaceTensor(imageData, face)
      );
      const result = await identityWorkerPool.embed(tensors, photoId);
      return {
        embeddings: result.embeddings,
        workerUsed: true,
        loadModelMs: result.loadModelMs,
        inferenceMs: result.inferenceMs,
      };
    } finally {
      bitmap.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[subjectDetection] Identity embed failed:', message);
    return { embeddings: [], workerUsed: false, error: message };
  }
}

export async function preloadDetectionRuntime(): Promise<void> {
  if (!detectionWorkerPool.isSupported()) return;
  try {
    await detectionWorkerPool.warmup();
  } catch (error) {
    console.warn('[subjectDetection] Detection warmup failed:', error);
  }
}

export async function preloadIdentityRuntime(): Promise<void> {
  if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new Error('Face matching is not available in this browser');
  }
  identityWorkerPool.resetLoadFailure();
  try {
    await Promise.all([
      identityWorkerPool.warmup(),
      getFaceDetector().catch(() => null),
    ]);
  } catch (error) {
    console.warn('[subjectDetection] Identity warmup failed:', error);
    throw error;
  }
}

export function isIdentityRuntimeAvailable(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof createImageBitmap !== 'undefined' &&
    identityWorkerPool.isSupported()
  );
}

export function isDetectionSupported(): boolean {
  return isFaceDetectionSupported();
}
