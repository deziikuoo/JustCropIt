/**
 * Build portrait crop boxes from MediaPipe pose / face landmarks.
 */

import { FaceLandmarker } from '@mediapipe/tasks-vision';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  DETECTION_BBOX_PADDING_RATIO,
  DETECTION_CHEEKBONE_EAR_OFFSET_RATIO,
  DETECTION_EAR_HORIZONTAL_PAD_RATIO,
  DETECTION_EAR_MAX_IMAGE_WIDTH_RATIO,
  DETECTION_EAR_MIN_VISIBILITY,
  DETECTION_FACE_BOTTOM_EXTEND_RATIO,
  DETECTION_FACE_TOP_EXTEND_RATIO,
  DETECTION_FACE_WIDTH_CHEEK_MULTIPLIER,
  DETECTION_FACE_WIDTH_EYE_MULTIPLIER,
  DETECTION_LANDMARK_MIN_VISIBILITY,
  DETECTION_PORTRAIT_SHOULDER_PAD_RATIO,
  DETECTION_PROFILE_MIRROR_RATIO,
} from '../constants/optimization';
import type {
  BoundingBox,
  ImageDimensions,
  PortraitDebugOverlay,
  PortraitDebugPoint,
} from '../types/detection';
import { faceBboxToHeadNeckBbox } from './cropSuggestion';

export const POSE_NOSE = 0;
export const POSE_LEFT_EAR = 7;
export const POSE_RIGHT_EAR = 8;
export const POSE_LEFT_SHOULDER = 11;
export const POSE_RIGHT_SHOULDER = 12;
export const POSE_LEFT_ELBOW = 13;
export const POSE_RIGHT_ELBOW = 14;
export const POSE_LEFT_WRIST = 15;
export const POSE_RIGHT_WRIST = 16;
export const POSE_LEFT_HIP = 23;
export const POSE_RIGHT_HIP = 24;
export const POSE_LEFT_KNEE = 25;
export const POSE_RIGHT_KNEE = 26;
export const POSE_LEFT_ANKLE = 27;
export const POSE_RIGHT_ANKLE = 28;
export const POSE_LEFT_HEEL = 29;
export const POSE_RIGHT_HEEL = 30;
export const POSE_LEFT_FOOT = 31;
export const POSE_RIGHT_FOOT = 32;

const POSE_ALL_INDICES = Array.from({ length: 33 }, (_, i) => i);

const POSE_FOOT_INDICES = [
  POSE_LEFT_ANKLE,
  POSE_RIGHT_ANKLE,
  POSE_LEFT_HEEL,
  POSE_RIGHT_HEEL,
  POSE_LEFT_FOOT,
  POSE_RIGHT_FOOT,
];

const POSE_LOWER_INDICES = [
  POSE_LEFT_HIP,
  POSE_RIGHT_HIP,
  POSE_LEFT_KNEE,
  POSE_RIGHT_KNEE,
  ...POSE_FOOT_INDICES,
];

const FACE_CHIN = 152;
const FACE_FOREHEAD = 10;
const FACE_LEFT_EYE_OUTER = 33;
const FACE_RIGHT_EYE_OUTER = 263;
const FACE_LEFT_CHEEK_INNER = 123;
const FACE_RIGHT_CHEEK_INNER = 352;
const FACE_LEFT_EAR_POINT = 234;
const FACE_RIGHT_EAR_POINT = 454;
const FACE_NOSE_TIP = 1;

const FACE_LEFT_CHEEKBONE = [116, 123, 147, 213];
const FACE_RIGHT_CHEEKBONE = [345, 352, 376, 433];
/** Wider head-side set (temple) — last resort only. */
const FACE_LEFT_HEAD_SIDE = [234, 127, 162, 21, 54, 67, 109, 103, 93, 132, 58];
const FACE_RIGHT_HEAD_SIDE = [454, 356, 389, 251, 284, 297, 338, 323, 361, 288, 397];

interface Point {
  x: number;
  y: number;
}

interface HorizontalBounds {
  left: number;
  right: number;
}

export interface HorizontalResolveMeta {
  source: string;
  faceWidthPx: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isVisible(
  landmark: NormalizedLandmark | undefined,
  minVisibility = DETECTION_LANDMARK_MIN_VISIBILITY
): landmark is NormalizedLandmark {
  return landmark != null && (landmark.visibility ?? 1) >= minVisibility;
}

function isEarVisible(
  landmark: NormalizedLandmark | undefined
): landmark is NormalizedLandmark {
  return isVisible(landmark, DETECTION_EAR_MIN_VISIBILITY);
}

function toPixel(
  landmark: NormalizedLandmark,
  width: number,
  height: number
): Point {
  return { x: landmark.x * width, y: landmark.y * height };
}

function getFaceOvalIndices(): number[] {
  const indices = new Set<number>();
  for (const connection of FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) {
    indices.add(connection.start);
    indices.add(connection.end);
  }
  return [...indices];
}

function collectXs(
  faceLandmarks: NormalizedLandmark[],
  indices: number[],
  width: number
): number[] {
  return indices
    .map((index) => faceLandmarks[index])
    .filter((landmark): landmark is NormalizedLandmark => landmark != null)
    .map((landmark) => landmark.x * width);
}

function getFaceCenterX(
  faceLandmarks: NormalizedLandmark[] | undefined,
  poseLandmarks: NormalizedLandmark[] | undefined,
  imageWidth: number
): number {
  if (faceLandmarks) {
    const leftCheek = faceLandmarks[FACE_LEFT_CHEEK_INNER];
    const rightCheek = faceLandmarks[FACE_RIGHT_CHEEK_INNER];
    if (leftCheek && rightCheek) {
      return ((leftCheek.x + rightCheek.x) / 2) * imageWidth;
    }
    const nose = faceLandmarks[FACE_NOSE_TIP];
    if (nose) return nose.x * imageWidth;
  }

  const poseNose = poseLandmarks?.[POSE_NOSE];
  if (isVisible(poseNose)) return poseNose.x * imageWidth;

  return imageWidth / 2;
}

function getInterCheekSpan(
  faceLandmarks: NormalizedLandmark[] | undefined,
  imageWidth: number
): number | null {
  if (!faceLandmarks) return null;
  const left = faceLandmarks[FACE_LEFT_CHEEK_INNER];
  const right = faceLandmarks[FACE_RIGHT_CHEEK_INNER];
  if (!left || !right) return null;
  const span = (right.x - left.x) * imageWidth;
  return span > 0 ? span : null;
}

function getEyeToEyeSpan(
  faceLandmarks: NormalizedLandmark[] | undefined,
  imageWidth: number
): number | null {
  if (!faceLandmarks) return null;
  const left = faceLandmarks[FACE_LEFT_EYE_OUTER];
  const right = faceLandmarks[FACE_RIGHT_EYE_OUTER];
  if (!left || !right) return null;
  const span = (right.x - left.x) * imageWidth;
  return span > 0 ? span : null;
}

function getMaxFaceRelativeWidth(
  faceLandmarks: NormalizedLandmark[] | undefined,
  imageWidth: number
): number | null {
  const cheekSpan = getInterCheekSpan(faceLandmarks, imageWidth);
  const eyeSpan = getEyeToEyeSpan(faceLandmarks, imageWidth);
  const caps: number[] = [];

  if (cheekSpan != null) {
    caps.push(cheekSpan * DETECTION_FACE_WIDTH_CHEEK_MULTIPLIER);
  }
  if (eyeSpan != null) {
    caps.push(eyeSpan * DETECTION_FACE_WIDTH_EYE_MULTIPLIER);
  }

  if (caps.length === 0) return null;
  return Math.min(...caps);
}

function clampSpanToMaxWidth(
  left: number,
  right: number,
  maxWidth: number
): { left: number; right: number } {
  const span = right - left;
  if (span <= maxWidth) return { left, right };

  const center = (left + right) / 2;
  return { left: center - maxWidth / 2, right: center + maxWidth / 2 };
}

function sideBoundsFrom(
  faceLandmarks: NormalizedLandmark[] | undefined,
  leftIndices: number[],
  rightIndices: number[],
  imageWidth: number
): HorizontalBounds | null {
  if (!faceLandmarks) return null;

  const leftXs = collectXs(faceLandmarks, leftIndices, imageWidth);
  const rightXs = collectXs(faceLandmarks, rightIndices, imageWidth);
  if (leftXs.length === 0 || rightXs.length === 0) return null;

  const left = Math.min(...leftXs);
  const right = Math.max(...rightXs);
  return right > left ? { left, right } : null;
}

function applyProfileMirror(
  left: number,
  right: number,
  centerX: number,
  hasLeftSignal: boolean,
  hasRightSignal: boolean
): { left: number; right: number; mirrored: boolean } {
  if (hasLeftSignal && hasRightSignal) {
    return { left, right, mirrored: false };
  }

  if (hasLeftSignal && !hasRightSignal) {
    const halfSpan = (centerX - left) * DETECTION_PROFILE_MIRROR_RATIO;
    return { left, right: centerX + halfSpan, mirrored: true };
  }

  if (hasRightSignal && !hasLeftSignal) {
    const halfSpan = (right - centerX) * DETECTION_PROFILE_MIRROR_RATIO;
    return { left: centerX - halfSpan, right, mirrored: true };
  }

  return { left, right, mirrored: false };
}

function finalizeHorizontalBounds(
  left: number,
  right: number,
  imageWidth: number,
  maxSpan?: number,
  padRatio = DETECTION_EAR_HORIZONTAL_PAD_RATIO
): HorizontalBounds | null {
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
    return null;
  }

  let span = right - left;
  if (maxSpan != null && span > maxSpan) {
    const center = (left + right) / 2;
    left = center - maxSpan / 2;
    right = center + maxSpan / 2;
    span = maxSpan;
  }

  const pad = span * padRatio;
  return {
    left: clamp(left - pad, 0, imageWidth),
    right: clamp(right + pad, 0, imageWidth),
  };
}

/** Inner cheek line (123 / 352) — sits in front of the ears in the face mesh. */
function getInnerCheekBounds(
  faceLandmarks: NormalizedLandmark[] | undefined,
  imageWidth: number
): HorizontalBounds | null {
  if (!faceLandmarks) return null;
  const leftLm = faceLandmarks[FACE_LEFT_CHEEK_INNER];
  const rightLm = faceLandmarks[FACE_RIGHT_CHEEK_INNER];
  if (!leftLm || !rightLm) return null;

  const left = leftLm.x * imageWidth;
  const right = rightLm.x * imageWidth;
  return right > left ? { left, right } : null;
}

/**
 * Resolve horizontal bounds from inner cheeks + small ear offset.
 * Face-mesh ear points (234/454) and pose ears can sit behind the visible
 * ear — they are never used to widen the box, only to tighten when inset.
 */
function resolveHorizontalBounds(
  imageSize: ImageDimensions,
  poseLandmarks?: NormalizedLandmark[],
  faceLandmarks?: NormalizedLandmark[]
): (HorizontalBounds & HorizontalResolveMeta) | null {
  const { width } = imageSize;
  const imageSafetyMax = width * DETECTION_EAR_MAX_IMAGE_WIDTH_RATIO;
  const faceMaxWidth = getMaxFaceRelativeWidth(faceLandmarks, width);
  const maxSpan =
    faceMaxWidth != null
      ? Math.min(imageSafetyMax, faceMaxWidth)
      : imageSafetyMax;

  let left: number | null = null;
  let right: number | null = null;
  let source = 'none';
  let mirrored = false;

  const innerCheek = getInnerCheekBounds(faceLandmarks, width);
  const cheekbone = sideBoundsFrom(
    faceLandmarks,
    FACE_LEFT_CHEEKBONE,
    FACE_RIGHT_CHEEKBONE,
    width
  );
  const cheekBase = innerCheek ?? cheekbone;

  if (cheekBase) {
    const cheekSpan = cheekBase.right - cheekBase.left;
    const earOffset = cheekSpan * DETECTION_CHEEKBONE_EAR_OFFSET_RATIO;
    left = cheekBase.left - earOffset;
    right = cheekBase.right + earOffset;
    source = innerCheek ? 'inner-cheek+offset' : 'cheekbone+offset';
  }

  const tightenLeft = (earX: number) => {
    if (left == null) {
      left = earX;
      return;
    }
    // Only pull the left edge rightward (tighter); never expand past cheek+offset.
    if (earX > left) left = earX;
  };

  const tightenRight = (earX: number) => {
    if (right == null) {
      right = earX;
      return;
    }
    if (earX < right) right = earX;
  };

  const leftEarPoint = faceLandmarks?.[FACE_LEFT_EAR_POINT];
  const rightEarPoint = faceLandmarks?.[FACE_RIGHT_EAR_POINT];
  if (leftEarPoint) tightenLeft(leftEarPoint.x * width);
  if (rightEarPoint) tightenRight(rightEarPoint.x * width);

  const leftPoseEar = poseLandmarks?.[POSE_LEFT_EAR];
  const rightPoseEar = poseLandmarks?.[POSE_RIGHT_EAR];
  if (isEarVisible(leftPoseEar)) tightenLeft(leftPoseEar.x * width);
  if (isEarVisible(rightPoseEar)) tightenRight(rightPoseEar.x * width);

  const hasLeftSignal =
    innerCheek != null ||
    leftEarPoint != null ||
    isEarVisible(leftPoseEar);
  const hasRightSignal =
    innerCheek != null ||
    rightEarPoint != null ||
    isEarVisible(rightPoseEar);

  const centerX = getFaceCenterX(faceLandmarks, poseLandmarks, width);

  if (left != null && right != null) {
    const mirroredBounds = applyProfileMirror(
      left,
      right,
      centerX,
      hasLeftSignal,
      hasRightSignal
    );
    left = mirroredBounds.left;
    right = mirroredBounds.right;
    if (mirroredBounds.mirrored) {
      mirrored = true;
      source += '+mirror';
    }
  } else if ((left == null) !== (right == null)) {
    if (left != null && right == null) {
      const halfSpan = (centerX - left) * DETECTION_PROFILE_MIRROR_RATIO;
      right = centerX + halfSpan;
      source += '+mirror-fallback';
      mirrored = true;
    } else if (right != null && left == null) {
      const halfSpan = (right - centerX) * DETECTION_PROFILE_MIRROR_RATIO;
      left = centerX - halfSpan;
      source += '+mirror-fallback';
      mirrored = true;
    }
  }

  if (left == null || right == null) {
    const headSide = sideBoundsFrom(
      faceLandmarks,
      FACE_LEFT_HEAD_SIDE,
      FACE_RIGHT_HEAD_SIDE,
      width
    );
    if (headSide) {
      left = headSide.left;
      right = headSide.right;
      source = 'face-headside';
    }
  }

  if (left == null || right == null) return null;

  if (faceMaxWidth != null) {
    const clamped = clampSpanToMaxWidth(left, right, faceMaxWidth);
    left = clamped.left;
    right = clamped.right;
    source += '+faceClamp';
  }

  const span = right - left;
  if (typeof console !== 'undefined') {
    console.debug('[crop-suggest] width', {
      source,
      mirrored,
      spanRatio: Number((span / width).toFixed(3)),
      faceMaxWidthPx: faceMaxWidth != null ? Math.round(faceMaxWidth) : null,
    });
  }

  const finalized = finalizeHorizontalBounds(left, right, width, maxSpan);
  if (!finalized) return null;

  return {
    ...finalized,
    source,
    faceWidthPx: faceMaxWidth,
  };
}

function bboxFromExtents(
  left: number,
  top: number,
  right: number,
  bottom: number,
  imageSize: ImageDimensions,
  verticalPaddingRatio = DETECTION_BBOX_PADDING_RATIO
): BoundingBox | null {
  const padY = (bottom - top) * verticalPaddingRatio;
  top -= padY;
  bottom += padY;

  left = clamp(left, 0, imageSize.width);
  top = clamp(top, 0, imageSize.height);
  right = clamp(right, left, imageSize.width);
  bottom = clamp(bottom, top, imageSize.height);

  const width = right - left;
  const height = bottom - top;
  if (width < 10 || height < 10) return null;

  return { x: left, y: top, width, height };
}

export function canUsePoseLandmarks(
  landmarks: NormalizedLandmark[] | null | undefined
): boolean {
  if (!landmarks?.length) return false;
  if (!isVisible(landmarks[POSE_NOSE])) return false;

  const ears =
    Number(isEarVisible(landmarks[POSE_LEFT_EAR])) +
    Number(isEarVisible(landmarks[POSE_RIGHT_EAR]));
  const shoulders =
    Number(isVisible(landmarks[POSE_LEFT_SHOULDER])) +
    Number(isVisible(landmarks[POSE_RIGHT_SHOULDER]));

  return ears >= 1 || shoulders >= 1;
}

export function canUseFaceLandmarks(
  landmarks: NormalizedLandmark[] | null | undefined
): boolean {
  return (landmarks?.length ?? 0) > FACE_CHIN && landmarks![FACE_CHIN] != null;
}

function resolveVerticalTop(
  imageSize: ImageDimensions,
  poseLandmarks: NormalizedLandmark[],
  faceLandmarks?: NormalizedLandmark[]
): number | null {
  const { height } = imageSize;
  const chin = faceLandmarks?.[FACE_CHIN];
  const forehead = faceLandmarks?.[FACE_FOREHEAD];

  if (forehead && chin) {
    const foreheadY = forehead.y * height;
    const chinY = chin.y * height;
    const faceHeight = Math.max(chinY - foreheadY, height * 0.05);
    let top = foreheadY - faceHeight * DETECTION_FACE_TOP_EXTEND_RATIO;

    if (faceLandmarks) {
      const ovalTop = getFaceOvalIndices()
        .map((index) => faceLandmarks[index]?.y)
        .filter((y): y is number => y != null)
        .reduce((min, y) => Math.min(min, y), Number.POSITIVE_INFINITY);
      if (Number.isFinite(ovalTop)) {
        top = Math.min(top, ovalTop * height);
      }
    }

    return top;
  }

  const verticalPoints: number[] = [];
  for (const index of [POSE_NOSE, POSE_LEFT_EAR, POSE_RIGHT_EAR]) {
    const landmark = poseLandmarks[index];
    if (isVisible(landmark) || isEarVisible(landmark)) {
      verticalPoints.push(landmark.y * height);
    }
  }
  if (verticalPoints.length === 0) return null;

  let top = Math.min(...verticalPoints);
  if (forehead) {
    const foreheadY = forehead.y * height;
    const span = Math.max(...verticalPoints) - top;
    top = Math.min(top, foreheadY - span * DETECTION_FACE_TOP_EXTEND_RATIO);
  } else {
    const nose = poseLandmarks[POSE_NOSE];
    if (isVisible(nose)) {
      const noseY = nose.y * height;
      const span = Math.max(...verticalPoints) - top;
      top = Math.min(top, noseY - span * 0.55);
    }
  }

  return top;
}

function resolveVerticalBoundsFromPose(
  imageSize: ImageDimensions,
  poseLandmarks: NormalizedLandmark[],
  faceLandmarks?: NormalizedLandmark[]
): { top: number; bottom: number } | null {
  const { height } = imageSize;
  const top = resolveVerticalTop(imageSize, poseLandmarks, faceLandmarks);
  if (top == null) return null;

  let bottom = top + height * 0.1;
  const verticalPoints: number[] = [];
  for (const index of [POSE_NOSE, POSE_LEFT_EAR, POSE_RIGHT_EAR]) {
    const landmark = poseLandmarks[index];
    if (isVisible(landmark) || isEarVisible(landmark)) {
      verticalPoints.push(landmark.y * height);
    }
  }
  if (verticalPoints.length > 0) {
    bottom = Math.max(...verticalPoints);
  }

  const shoulders = [POSE_LEFT_SHOULDER, POSE_RIGHT_SHOULDER]
    .map((index) => poseLandmarks[index])
    .filter(isVisible)
    .map((landmark) => landmark.y * height);

  if (shoulders.length > 0) {
    const shoulderY = Math.max(...shoulders);
    bottom = shoulderY + (shoulderY - top) * DETECTION_PORTRAIT_SHOULDER_PAD_RATIO;
  } else if (faceLandmarks?.[FACE_CHIN]) {
    const chinY = faceLandmarks[FACE_CHIN].y * height;
    const faceHeight = chinY - top;
    bottom = chinY + faceHeight * DETECTION_FACE_BOTTOM_EXTEND_RATIO;
  }

  return { top, bottom };
}

function collectPosePixels(
  imageSize: ImageDimensions,
  poseLandmarks: NormalizedLandmark[],
  indices: number[],
  minVisibility = DETECTION_LANDMARK_MIN_VISIBILITY
): Point[] {
  const { width, height } = imageSize;
  return indices
    .map((index) => poseLandmarks[index])
    .filter(
      (landmark): landmark is NormalizedLandmark =>
        landmark != null && (landmark.visibility ?? 1) >= minVisibility
    )
    .map((landmark) => toPixel(landmark, width, height));
}

function horizontalFromPosePoints(
  points: Point[],
  imageSize: ImageDimensions,
  padRatio = 0.12
): { left: number; right: number } | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), imageSize.width * 0.08);
  const pad = span * padRatio;
  return {
    left: Math.min(...xs) - pad,
    right: Math.max(...xs) + pad,
  };
}

export function canUseLowerBodyPose(
  landmarks: NormalizedLandmark[] | null | undefined
): boolean {
  if (!landmarks?.length) return false;
  const hips =
    Number(isVisible(landmarks[POSE_LEFT_HIP])) +
    Number(isVisible(landmarks[POSE_RIGHT_HIP]));
  const feet =
    Number(isVisible(landmarks[POSE_LEFT_ANKLE])) +
    Number(isVisible(landmarks[POSE_RIGHT_ANKLE])) +
    Number(isVisible(landmarks[POSE_LEFT_FOOT])) +
    Number(isVisible(landmarks[POSE_RIGHT_FOOT])) +
    Number(isVisible(landmarks[POSE_LEFT_KNEE])) +
    Number(isVisible(landmarks[POSE_RIGHT_KNEE]));
  return hips >= 1 && feet >= 1;
}

export function buildFullBodyBboxFromPose(
  imageSize: ImageDimensions,
  poseLandmarks: NormalizedLandmark[],
  faceLandmarks?: NormalizedLandmark[]
): BoundingBox | null {
  const RELAXED_VISIBILITY = 0.12;
  const points = collectPosePixels(
    imageSize,
    poseLandmarks,
    POSE_ALL_INDICES,
    RELAXED_VISIBILITY
  );
  if (points.length < 4) return null;

  const headTop =
    resolveVerticalTop(imageSize, poseLandmarks, faceLandmarks) ??
    Math.min(...points.map((p) => p.y));

  const footPoints = collectPosePixels(
    imageSize,
    poseLandmarks,
    POSE_FOOT_INDICES,
    RELAXED_VISIBILITY
  );
  const kneePoints = collectPosePixels(
    imageSize,
    poseLandmarks,
    [POSE_LEFT_KNEE, POSE_RIGHT_KNEE],
    RELAXED_VISIBILITY
  );
  const hipPoints = collectPosePixels(
    imageSize,
    poseLandmarks,
    [POSE_LEFT_HIP, POSE_RIGHT_HIP],
    RELAXED_VISIBILITY
  );

  let bottom: number;
  if (footPoints.length > 0) {
    bottom = Math.max(...footPoints.map((p) => p.y));
  } else if (kneePoints.length > 0 && hipPoints.length > 0) {
    const hipY = Math.max(...hipPoints.map((p) => p.y));
    const kneeY = Math.max(...kneePoints.map((p) => p.y));
    const thigh = Math.max(kneeY - hipY, imageSize.height * 0.08);
    bottom = kneeY + thigh;
  } else {
    bottom = Math.max(...points.map((p) => p.y));
  }

  const bodyHeight = Math.max(bottom - headTop, imageSize.height * 0.2);
  const top = headTop - bodyHeight * 0.08;
  bottom += bodyHeight * 0.06;

  const xs = points.map((p) => p.x);
  let left = Math.min(...xs);
  let right = Math.max(...xs);
  const rawWidth = right - left;
  const minWidth = bodyHeight * 0.32;
  const padX = Math.max(rawWidth * 0.16, (minWidth - rawWidth) / 2);
  left -= padX;
  right += padX;

  return bboxFromExtents(left, top, right, bottom, imageSize, 0);
}

export function buildUpperBodyBboxFromPose(
  imageSize: ImageDimensions,
  poseLandmarks: NormalizedLandmark[],
  faceLandmarks?: NormalizedLandmark[]
): BoundingBox | null {
  const RELAXED = 0.12;
  const top = resolveVerticalTop(imageSize, poseLandmarks, faceLandmarks);
  const hips = collectPosePixels(
    imageSize,
    poseLandmarks,
    [POSE_LEFT_HIP, POSE_RIGHT_HIP],
    RELAXED
  );
  if (top == null || hips.length === 0) return null;

  const elbows = collectPosePixels(
    imageSize,
    poseLandmarks,
    [POSE_LEFT_ELBOW, POSE_RIGHT_ELBOW],
    RELAXED
  );
  const shoulders = collectPosePixels(
    imageSize,
    poseLandmarks,
    [POSE_LEFT_SHOULDER, POSE_RIGHT_SHOULDER],
    RELAXED
  );

  const hipY = Math.max(...hips.map((p) => p.y));
  const elbowBottom =
    elbows.length > 0 ? Math.max(...elbows.map((p) => p.y)) : hipY;
  const bottom =
    Math.max(hipY, elbowBottom) + (hipY - top) * 0.08;

  const bodyPoints = [...hips, ...shoulders, ...elbows];
  const horizontal = horizontalFromPosePoints(bodyPoints, imageSize, 0.14);
  if (!horizontal) return null;

  return bboxFromExtents(
    horizontal.left,
    top,
    horizontal.right,
    bottom,
    imageSize,
    0.03
  );
}

export function buildLowerBodyBboxFromPose(
  imageSize: ImageDimensions,
  poseLandmarks: NormalizedLandmark[]
): BoundingBox | null {
  if (!canUseLowerBodyPose(poseLandmarks)) return null;

  const points = collectPosePixels(imageSize, poseLandmarks, POSE_LOWER_INDICES);
  if (points.length < 2) return null;

  const hips = collectPosePixels(imageSize, poseLandmarks, [
    POSE_LEFT_HIP,
    POSE_RIGHT_HIP,
  ]);
  const top = hips.length > 0 ? Math.min(...hips.map((p) => p.y)) : Math.min(...points.map((p) => p.y));
  const bottom = Math.max(...points.map((p) => p.y));
  const horizontal = horizontalFromPosePoints(points, imageSize, 0.16);
  if (!horizontal) return null;

  return bboxFromExtents(horizontal.left, top, horizontal.right, bottom, imageSize, 0.08);
}

export function buildHeadAndShouldersBboxFromPose(
  imageSize: ImageDimensions,
  poseLandmarks: NormalizedLandmark[],
  faceLandmarks?: NormalizedLandmark[]
): BoundingBox | null {
  const RELAXED = 0.15;
  const shoulders = collectPosePixels(
    imageSize,
    poseLandmarks,
    [POSE_LEFT_SHOULDER, POSE_RIGHT_SHOULDER],
    RELAXED
  );
  if (shoulders.length === 0) return null;

  const top = resolveVerticalTop(imageSize, poseLandmarks, faceLandmarks);
  if (top == null) return null;

  const shoulderY = Math.max(...shoulders.map((p) => p.y));
  const headToShoulder = Math.max(shoulderY - top, imageSize.height * 0.12);

  // MediaPipe joints sit inside the visual shoulder; pad out to the deltoid.
  let left: number;
  let right: number;
  if (shoulders.length === 2) {
    const span = Math.abs(shoulders[0].x - shoulders[1].x);
    const pad = Math.max(span * 0.22, imageSize.width * 0.04);
    left = Math.min(shoulders[0].x, shoulders[1].x) - pad;
    right = Math.max(shoulders[0].x, shoulders[1].x) + pad;
  } else {
    const shoulder = shoulders[0];
    const nose = poseLandmarks[POSE_NOSE];
    const centerX =
      nose != null ? nose.x * imageSize.width : shoulder.x;
    const half = Math.max(Math.abs(shoulder.x - centerX), imageSize.width * 0.16);
    const pad = half * 0.28;
    left = Math.min(shoulder.x, centerX - half) - pad;
    right = Math.max(shoulder.x, centerX + half) + pad;
  }

  const paddedTop = top - headToShoulder * 0.1;
  const bottom = shoulderY + headToShoulder * 0.38;

  return bboxFromExtents(left, paddedTop, right, bottom, imageSize, 0.02);
}

export function buildPortraitBboxFromPose(
  imageSize: ImageDimensions,
  poseLandmarks: NormalizedLandmark[],
  faceLandmarks?: NormalizedLandmark[]
): BoundingBox | null {
  const horizontal = resolveHorizontalBounds(
    imageSize,
    poseLandmarks,
    faceLandmarks
  );
  const vertical = resolveVerticalBoundsFromPose(
    imageSize,
    poseLandmarks,
    faceLandmarks
  );

  if (!horizontal || !vertical) return null;

  return bboxFromExtents(
    horizontal.left,
    vertical.top,
    horizontal.right,
    vertical.bottom,
    imageSize
  );
}

export function buildPortraitBboxFromPoseAndFace(
  imageSize: ImageDimensions,
  poseLandmarks: NormalizedLandmark[],
  faceLandmarks: NormalizedLandmark[]
): BoundingBox | null {
  return buildPortraitBboxFromPose(imageSize, poseLandmarks, faceLandmarks);
}

export function buildFullHeadBboxFromLandmarks(
  imageSize: ImageDimensions,
  faceLandmarks?: NormalizedLandmark[] | null,
  poseLandmarks?: NormalizedLandmark[] | null
): BoundingBox | null {
  const { width, height } = imageSize;
  const ovalPoints =
    faceLandmarks && canUseFaceLandmarks(faceLandmarks)
      ? getFaceOvalIndices()
          .map((index) => faceLandmarks[index])
          .filter((landmark): landmark is NormalizedLandmark => landmark != null)
          .map((landmark) => toPixel(landmark, width, height))
      : [];

  const earPoints = collectPosePixels(
    imageSize,
    poseLandmarks ?? [],
    [POSE_LEFT_EAR, POSE_RIGHT_EAR],
    DETECTION_EAR_MIN_VISIBILITY
  );
  if (faceLandmarks) {
    for (const index of [FACE_LEFT_EAR_POINT, FACE_RIGHT_EAR_POINT]) {
      const landmark = faceLandmarks[index];
      if (landmark) earPoints.push(toPixel(landmark, width, height));
    }
  }

  const horizontal =
    resolveHorizontalBounds(
      imageSize,
      poseLandmarks ?? undefined,
      faceLandmarks ?? undefined
    ) ?? horizontalFromPosePoints([...ovalPoints, ...earPoints], imageSize, 0.1);

  if (!horizontal && ovalPoints.length < 4 && earPoints.length < 2) {
    return null;
  }

  const top =
    resolveVerticalTop(
      imageSize,
      poseLandmarks ?? [],
      faceLandmarks ?? undefined
    ) ??
    (ovalPoints.length > 0 ? Math.min(...ovalPoints.map((p) => p.y)) : null);
  if (top == null || !horizontal) return null;

  let chinY: number | null = null;
  const chin = faceLandmarks?.[FACE_CHIN];
  if (chin) chinY = chin.y * height;
  const ovalBottom =
    ovalPoints.length > 0 ? Math.max(...ovalPoints.map((p) => p.y)) : null;
  const bottomAnchor = Math.max(chinY ?? 0, ovalBottom ?? 0, top + height * 0.08);
  const faceHeight = Math.max(bottomAnchor - top, height * 0.08);

  // Crown / hair above forehead; stop at the jaw rather than the neck.
  const paddedTop = top - faceHeight * 0.18;
  const paddedBottom = bottomAnchor + faceHeight * 0.1;
  const earPad = Math.max((horizontal.right - horizontal.left) * 0.08, width * 0.02);

  return bboxFromExtents(
    horizontal.left - earPad,
    paddedTop,
    horizontal.right + earPad,
    paddedBottom,
    imageSize,
    0.02
  );
}

export function buildPortraitBboxFromFaceLandmarks(
  imageSize: ImageDimensions,
  faceLandmarks: NormalizedLandmark[]
): BoundingBox | null {
  const { width, height } = imageSize;
  const horizontal = resolveHorizontalBounds(imageSize, undefined, faceLandmarks);

  const ovalPoints = getFaceOvalIndices()
    .map((index) => faceLandmarks[index])
    .filter((landmark): landmark is NormalizedLandmark => landmark != null)
    .map((landmark) => toPixel(landmark, width, height));

  if (!horizontal || ovalPoints.length < 4) return null;

  let top =
    resolveVerticalTop(imageSize, [], faceLandmarks) ??
    Math.min(...ovalPoints.map((p) => p.y));
  let bottom = Math.max(...ovalPoints.map((p) => p.y));

  const chin = faceLandmarks[FACE_CHIN];
  if (chin) {
    const chinY = chin.y * height;
    const faceHeight = chinY - top;
    bottom = chinY + faceHeight * DETECTION_FACE_BOTTOM_EXTEND_RATIO;
  }

  return bboxFromExtents(
    horizontal.left,
    top,
    horizontal.right,
    bottom,
    imageSize
  );
}

export function buildPortraitBboxFromFaceDetector(
  faceBbox: BoundingBox
): BoundingBox {
  return faceBboxToHeadNeckBbox(faceBbox);
}

export function buildPortraitDebugOverlay(
  imageSize: ImageDimensions,
  poseLandmarks: NormalizedLandmark[] | null | undefined,
  faceLandmarks: NormalizedLandmark[] | null | undefined,
  bbox: BoundingBox | null,
  meta?: HorizontalResolveMeta | null
): PortraitDebugOverlay {
  const { width, height } = imageSize;
  const points: PortraitDebugPoint[] = [];

  const addFacePoint = (
    index: number,
    label: string,
    kind: PortraitDebugPoint['kind']
  ) => {
    const landmark = faceLandmarks?.[index];
    if (!landmark) return;
    points.push({
      x: landmark.x * width,
      y: landmark.y * height,
      label,
      kind,
    });
  };

  addFacePoint(FACE_LEFT_EAR_POINT, '234', 'face-ear');
  addFacePoint(FACE_RIGHT_EAR_POINT, '454', 'face-ear');
  addFacePoint(FACE_LEFT_CHEEK_INNER, '123', 'face-cheek');
  addFacePoint(FACE_RIGHT_CHEEK_INNER, '352', 'face-cheek');
  addFacePoint(FACE_LEFT_EYE_OUTER, '33', 'face-eye');
  addFacePoint(FACE_RIGHT_EYE_OUTER, '263', 'face-eye');

  const addPoseEar = (index: number, label: string) => {
    const landmark = poseLandmarks?.[index];
    if (!isEarVisible(landmark)) return;
    points.push({
      x: landmark.x * width,
      y: landmark.y * height,
      label,
      kind: 'pose-ear',
    });
  };

  addPoseEar(POSE_LEFT_EAR, 'poseL');
  addPoseEar(POSE_RIGHT_EAR, 'poseR');

  return {
    points,
    bbox,
    appliedCrop: null,
    widthSource: meta?.source ?? null,
    faceWidthPx: meta?.faceWidthPx ?? null,
    imageSize: { ...imageSize },
  };
}

/** Re-resolve horizontal meta for debug overlay without rebuilding the full bbox. */
export function resolveHorizontalMeta(
  imageSize: ImageDimensions,
  poseLandmarks?: NormalizedLandmark[] | null,
  faceLandmarks?: NormalizedLandmark[] | null
): HorizontalResolveMeta | null {
  const result = resolveHorizontalBounds(
    imageSize,
    poseLandmarks ?? undefined,
    faceLandmarks ?? undefined
  );
  if (!result) return null;
  return { source: result.source, faceWidthPx: result.faceWidthPx };
}
