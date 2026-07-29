/**
 * Convert detection bbox to crop coordinates (Phase 4).
 */

import {
  DETECTION_BBOX_PADDING_RATIO,
  DETECTION_FACE_BOTTOM_EXTEND_RATIO,
  DETECTION_FACE_SIDE_EXTEND_RATIO,
  DETECTION_FACE_TOP_EXTEND_RATIO,
} from '../constants/optimization';
import type {
  BoundingBox,
  ImageDimensions,
  PortraitDebugOverlay,
  SuggestedCrop,
} from '../types/detection';

export interface CropSuggestionOptions {
  paddingRatio?: number;
  aspectRatio?: number | null;
  minCropSize?: number;
}

export interface HeadNeckExpandOptions {
  topExtendRatio?: number;
  bottomExtendRatio?: number;
  sideExtendRatio?: number;
}

/**
 * Expand a face bbox into a head portrait region (crown, ears, collarbone).
 * Face detection covers cheeks-to-chin; asymmetric padding infers the rest.
 */
export function faceBboxToHeadNeckBbox(
  faceBbox: BoundingBox,
  options: HeadNeckExpandOptions = {}
): BoundingBox {
  const topExtend =
    options.topExtendRatio ?? DETECTION_FACE_TOP_EXTEND_RATIO;
  const bottomExtend =
    options.bottomExtendRatio ?? DETECTION_FACE_BOTTOM_EXTEND_RATIO;
  const sideExtend =
    options.sideExtendRatio ?? DETECTION_FACE_SIDE_EXTEND_RATIO;

  const { x, y, width, height } = faceBbox;

  return {
    x: x - width * sideExtend,
    y: y - height * topExtend,
    width: width * (1 + sideExtend * 2),
    height: height * (1 + topExtend + bottomExtend),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fitAspectRatio(
  x: number,
  y: number,
  width: number,
  height: number,
  aspectRatio: number,
  bounds: ImageDimensions
): SuggestedCrop {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  let w = width;
  let h = height;
  const currentRatio = w / h;

  if (currentRatio > aspectRatio) {
    w = h * aspectRatio;
  } else if (currentRatio < aspectRatio) {
    h = w / aspectRatio;
  }

  let left = centerX - w / 2;
  let top = centerY - h / 2;

  if (left < 0) left = 0;
  if (top < 0) top = 0;
  if (left + w > bounds.width) left = bounds.width - w;
  if (top + h > bounds.height) top = bounds.height - h;

  w = Math.min(w, bounds.width - left);
  h = Math.min(h, bounds.height - top);

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(w),
    height: Math.round(h),
  };
}

export function bboxToSuggestedCrop(
  bbox: BoundingBox,
  imageSize: ImageDimensions,
  options: CropSuggestionOptions = {}
): SuggestedCrop | null {
  const padding = options.paddingRatio ?? DETECTION_BBOX_PADDING_RATIO;
  const minSize = options.minCropSize ?? 10;

  let x = bbox.x - bbox.width * padding;
  let y = bbox.y - bbox.height * padding;
  let width = bbox.width * (1 + padding * 2);
  let height = bbox.height * (1 + padding * 2);

  x = clamp(x, 0, imageSize.width);
  y = clamp(y, 0, imageSize.height);
  width = clamp(width, minSize, imageSize.width - x);
  height = clamp(height, minSize, imageSize.height - y);

  if (width < minSize || height < minSize) {
    return null;
  }

  let crop: SuggestedCrop = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };

  if (options.aspectRatio != null && options.aspectRatio > 0) {
    crop = fitAspectRatio(
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      options.aspectRatio,
      imageSize
    );
  }

  if (crop.width < minSize || crop.height < minSize) {
    return null;
  }

  return crop;
}

export function scaleBoundingBox(
  bbox: BoundingBox,
  fromSize: ImageDimensions,
  toSize: ImageDimensions
): BoundingBox {
  const scaleX = toSize.width / fromSize.width;
  const scaleY = toSize.height / fromSize.height;
  return {
    x: bbox.x * scaleX,
    y: bbox.y * scaleY,
    width: bbox.width * scaleX,
    height: bbox.height * scaleY,
  };
}

export function scalePortraitDebugOverlay(
  overlay: PortraitDebugOverlay,
  fromSize: ImageDimensions,
  toSize: ImageDimensions
): PortraitDebugOverlay {
  const scaleX = toSize.width / fromSize.width;
  const scaleY = toSize.height / fromSize.height;

  return {
    ...overlay,
    imageSize: { ...toSize },
    faceWidthPx:
      overlay.faceWidthPx != null ? overlay.faceWidthPx * scaleX : null,
    points: overlay.points.map((point) => ({
      ...point,
      x: point.x * scaleX,
      y: point.y * scaleY,
    })),
    bbox: overlay.bbox
      ? scaleBoundingBox(overlay.bbox, fromSize, toSize)
      : null,
    appliedCrop: overlay.appliedCrop
      ? scaleBoundingBox(overlay.appliedCrop, fromSize, toSize)
      : null,
  };
}
