/**
 * Main-thread MediaPipe Interactive Segmenter session (MagicTouch).
 */

import {
  InteractiveSegmenter,
  FilesetResolver,
  type RegionOfInterest,
} from '@mediapipe/tasks-vision';
import {
  OBJECT_MASK_GUIDED_CONFIDENCE_THRESHOLD,
  INTERACTIVE_SEGMENTER_MODEL_FILE,
} from '../constants/optimization';
import { getModelUrl, getWasmPath } from './mediapipeAssets';
import {
  boundsFromCategoryMask,
  boundsFromCategoryMaskAtSeed,
  boundsFromConfidenceMask,
  boundsFromConfidenceMaskAtSeed,
  guidedMaskBoundsOptions,
  scribbleCentroid,
  type NormalizedKeypoint,
  type ObjectMaskBoundsOptions,
  scaleMaskBounds,
} from './objectMaskCrop';

let interactiveSegmenter: InteractiveSegmenter | null = null;
let initPromise: Promise<InteractiveSegmenter> | null = null;
let initError: string | null = null;
let lastModelLoadMs = 0;
let visionFilesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null =
  null;

async function getVisionFileset() {
  if (!visionFilesetPromise) {
    visionFilesetPromise = FilesetResolver.forVisionTasks(getWasmPath());
  }
  return visionFilesetPromise;
}

export async function getInteractiveSegmenter(): Promise<InteractiveSegmenter> {
  if (interactiveSegmenter) return interactiveSegmenter;
  if (initError) throw new Error(initError);
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const loadStart = performance.now();
    try {
      const vision = await getVisionFileset();
      const segmenter = await InteractiveSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: getModelUrl(INTERACTIVE_SEGMENTER_MODEL_FILE),
          delegate: 'CPU',
        },
        outputConfidenceMasks: true,
        outputCategoryMask: true,
      });
      lastModelLoadMs = performance.now() - loadStart;
      interactiveSegmenter = segmenter;
      return segmenter;
    } catch (error) {
      initError = error instanceof Error ? error.message : String(error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

export interface SegmentMaskPayload {
  maskWidth: number;
  maskHeight: number;
  confidenceMask: Float32Array;
  categoryMask?: Uint8Array;
  overlayThreshold: number;
  /** Foreground component tied to the user's mark (for overlay + crop). */
  componentMask?: Uint8Array;
  /** Mask is SAM's square letterboxed canvas, not photo aspect. */
  letterboxed?: boolean;
  /** SAM's ready-made mask bitmap (square letterboxed). */
  overlayBitmap?: ImageBitmap;
}

export interface SegmentAtRoiResult {
  bounds: ReturnType<typeof scaleMaskBounds> | null;
  areaRatio: number;
  keypoint: NormalizedKeypoint;
  mask: SegmentMaskPayload | null;
  loadModelMs: number;
  inferenceMs: number;
}

function copyMaskPayload(
  confidenceMask: Float32Array,
  maskWidth: number,
  maskHeight: number,
  overlayThreshold: number,
  categoryMask?: Uint8Array,
  componentMask?: Uint8Array
): SegmentMaskPayload {
  return {
    maskWidth,
    maskHeight,
    confidenceMask: confidenceMask.slice(),
    categoryMask: categoryMask?.slice(),
    overlayThreshold,
    componentMask: componentMask?.slice(),
  };
}

function resolveMaskOptions(guided: boolean): ObjectMaskBoundsOptions {
  if (!guided) return {};
  return guidedMaskBoundsOptions();
}

function parseSegmentResult(
  result: {
    confidenceMasks?: { getAsFloat32Array(): Float32Array; width: number; height: number }[];
    categoryMask?: { getAsUint8Array(): Uint8Array; width: number; height: number };
  },
  imageWidth: number,
  imageHeight: number,
  maskOptions: ObjectMaskBoundsOptions,
  seed?: NormalizedKeypoint,
  guided = false
): {
  bounds: ReturnType<typeof scaleMaskBounds> | null;
  areaRatio: number;
  mask: SegmentMaskPayload | null;
} {
  const threshold =
    maskOptions.threshold ?? OBJECT_MASK_GUIDED_CONFIDENCE_THRESHOLD;
  const areaBounds = {
    minAreaRatio: maskOptions.minAreaRatio,
    maxAreaRatio: maskOptions.maxAreaRatio,
  };

  const confidence = result.confidenceMasks?.[0];
  const category = result.categoryMask;

  if (guided && seed) {
    if (category) {
      const categoryData = category.getAsUint8Array();
      const categoryResult = boundsFromCategoryMaskAtSeed(
        categoryData,
        category.width,
        category.height,
        seed,
        areaBounds
      );
      if (categoryResult.bounds) {
        const floats =
          confidence?.getAsFloat32Array() ??
          (() => {
            const fallback = new Float32Array(category.width * category.height);
            for (let i = 0; i < categoryData.length; i += 1) {
              fallback[i] = categoryData[i] > 0 ? 1 : 0;
            }
            return fallback;
          })();
        return {
          bounds: scaleMaskBounds(
            categoryResult.bounds,
            category.width,
            category.height,
            imageWidth,
            imageHeight
          ),
          areaRatio: categoryResult.bounds.areaRatio,
          mask: copyMaskPayload(
            floats,
            category.width,
            category.height,
            threshold,
            categoryData,
            categoryResult.component ?? undefined
          ),
        };
      }
    }

    if (confidence) {
      const floats = confidence.getAsFloat32Array();
      const seeded = boundsFromConfidenceMaskAtSeed(
        floats,
        confidence.width,
        confidence.height,
        seed,
        threshold,
        areaBounds
      );
      if (seeded.bounds) {
        return {
          bounds: scaleMaskBounds(
            seeded.bounds,
            confidence.width,
            confidence.height,
            imageWidth,
            imageHeight
          ),
          areaRatio: seeded.bounds.areaRatio,
          mask: copyMaskPayload(
            floats,
            confidence.width,
            confidence.height,
            threshold,
            category?.getAsUint8Array(),
            seeded.component ?? undefined
          ),
        };
      }
    }
  }

  if (confidence) {
    const floats = confidence.getAsFloat32Array();
    const maskBounds = boundsFromConfidenceMask(
      floats,
      confidence.width,
      confidence.height,
      threshold,
      areaBounds
    );
    const bounds = maskBounds
      ? scaleMaskBounds(
          maskBounds,
          confidence.width,
          confidence.height,
          imageWidth,
          imageHeight
        )
      : null;
    return {
      bounds,
      areaRatio: maskBounds?.areaRatio ?? 0,
      mask: copyMaskPayload(
        floats,
        confidence.width,
        confidence.height,
        threshold,
        category?.getAsUint8Array()
      ),
    };
  }

  if (category) {
    const categoryData = category.getAsUint8Array();
    const maskBounds = boundsFromCategoryMask(
      categoryData,
      category.width,
      category.height,
      areaBounds
    );
    const bounds = maskBounds
      ? scaleMaskBounds(
          maskBounds,
          category.width,
          category.height,
          imageWidth,
          imageHeight
        )
      : null;
    const emptyFloat = new Float32Array(category.width * category.height);
    for (let i = 0; i < categoryData.length; i += 1) {
      emptyFloat[i] = categoryData[i] > 0 ? 1 : 0;
    }
    return {
      bounds,
      areaRatio: maskBounds?.areaRatio ?? 0,
      mask: copyMaskPayload(
        emptyFloat,
        category.width,
        category.height,
        0.5,
        categoryData
      ),
    };
  }

  return { bounds: null, areaRatio: 0, mask: null };
}

export async function segmentAtRoiInBitmap(
  bitmap: ImageBitmap,
  roi: RegionOfInterest,
  options: { guided?: boolean } = {}
): Promise<SegmentAtRoiResult> {
  const inferenceStart = performance.now();
  const loadModelMs = interactiveSegmenter ? 0 : lastModelLoadMs;
  const segmenter = await getInteractiveSegmenter();
  const guided = options.guided ?? Boolean(roi.scribble?.length);
  const maskOptions = resolveMaskOptions(guided);
  const keypoint =
    roi.keypoint ??
    (roi.scribble?.length ? scribbleCentroid(roi.scribble) : { x: 0.5, y: 0.5 });

  // MediaPipe rejects an ROI that includes both keypoint and scribble.
  const segmentRoi: RegionOfInterest = roi.scribble?.length
    ? { scribble: roi.scribble }
    : { keypoint: roi.keypoint ?? keypoint };

  return new Promise((resolve, reject) => {
    try {
      segmenter.segment(bitmap, segmentRoi, (result) => {
        try {
          const inferenceMs = performance.now() - inferenceStart;
          const parsed = parseSegmentResult(
            result,
            bitmap.width,
            bitmap.height,
            maskOptions,
            keypoint,
            guided
          );
          resolve({
            bounds: parsed.bounds,
            areaRatio: parsed.areaRatio,
            keypoint,
            mask: parsed.mask,
            loadModelMs,
            inferenceMs,
          });
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

export async function segmentAtKeypointInBitmap(
  bitmap: ImageBitmap,
  keypoint: NormalizedKeypoint,
  guided = false
): Promise<SegmentAtRoiResult> {
  return segmentAtRoiInBitmap(bitmap, { keypoint }, { guided });
}

export async function segmentAtScribbleInBitmap(
  bitmap: ImageBitmap,
  scribble: NormalizedKeypoint[]
): Promise<SegmentAtRoiResult> {
  return segmentAtRoiInBitmap(bitmap, { scribble }, { guided: true });
}

export function isInteractiveSegmenterSupported(): boolean {
  return typeof createImageBitmap !== 'undefined';
}

export async function preloadInteractiveSegmenterRuntime(): Promise<void> {
  await getInteractiveSegmenter();
}

export function resetInteractiveSegmenterSession(): void {
  if (interactiveSegmenter) {
    interactiveSegmenter.close();
    interactiveSegmenter = null;
  }
  initPromise = null;
  initError = null;
  lastModelLoadMs = 0;
}
