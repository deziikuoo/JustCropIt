/**
 * ArcFace-style face alignment to 112×112 CHW float32.
 */

import { IDENTITY_FACE_SIZE_PX } from '../constants/optimization';
import type { BoundingBox, DetectedFace, FaceKeypoint, ImageDimensions } from '../types/detection';

/** InsightFace / ArcFace 5-point template for 112×112 (left-of-image eye first). */
const ARCFACE_TEMPLATE: Array<[number, number]> = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

export function l2Normalize(values: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] * values[i];
  }
  const norm = Math.sqrt(sum);
  if (norm < 1e-12) return values;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    out[i] = values[i] / norm;
  }
  return out;
}

/**
 * Build 5 ArcFace landmarks from BlazeFace keypoints.
 * BlazeFace order: right eye, left eye, nose, mouth, right ear, left ear
 * (subject's right eye = left-of-image for a frontal face).
 */
export function blazeToArcFaceLandmarks(
  keypoints: FaceKeypoint[]
): Array<[number, number]> | null {
  if (keypoints.length < 4) return null;
  const rightEye = keypoints[0];
  const leftEye = keypoints[1];
  const nose = keypoints[2];
  const mouth = keypoints[3];
  const eyeDist = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);
  const half = Math.max(eyeDist * 0.28, 4);
  return [
    [rightEye.x, rightEye.y],
    [leftEye.x, leftEye.y],
    [nose.x, nose.y],
    [mouth.x - half, mouth.y],
    [mouth.x + half, mouth.y],
  ];
}

function estimateSimilarity(
  src: Array<[number, number]>,
  dst: Array<[number, number]>
): { a: number; b: number; tx: number; ty: number } {
  const n = Math.min(src.length, dst.length);
  let srcMeanX = 0;
  let srcMeanY = 0;
  let dstMeanX = 0;
  let dstMeanY = 0;
  for (let i = 0; i < n; i += 1) {
    srcMeanX += src[i][0];
    srcMeanY += src[i][1];
    dstMeanX += dst[i][0];
    dstMeanY += dst[i][1];
  }
  srcMeanX /= n;
  srcMeanY /= n;
  dstMeanX /= n;
  dstMeanY /= n;

  let numA = 0;
  let numB = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const sx = src[i][0] - srcMeanX;
    const sy = src[i][1] - srcMeanY;
    const dx = dst[i][0] - dstMeanX;
    const dy = dst[i][1] - dstMeanY;
    numA += sx * dx + sy * dy;
    numB += sx * dy - sy * dx;
    den += sx * sx + sy * sy;
  }
  if (den < 1e-12) {
    return { a: 1, b: 0, tx: dstMeanX - srcMeanX, ty: dstMeanY - srcMeanY };
  }
  const a = numA / den;
  const b = numB / den;
  const tx = dstMeanX - (a * srcMeanX - b * srcMeanY);
  const ty = dstMeanY - (b * srcMeanX + a * srcMeanY);
  return { a, b, tx, ty };
}

function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number
): number {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) {
    const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
    return data[(cy * width + cx) * 4 + channel];
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * width + x0) * 4 + channel;
  const i10 = (y0 * width + x1) * 4 + channel;
  const i01 = (y1 * width + x0) * 4 + channel;
  const i11 = (y1 * width + x1) * 4 + channel;
  const v00 = data[i00];
  const v10 = data[i10];
  const v01 = data[i01];
  const v11 = data[i11];
  return (
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy
  );
}

function rgbaToArcFaceChw(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  size: number,
  mapSrc: (dx: number, dy: number) => { x: number; y: number }
): Float32Array {
  const out = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      const { x, y } = mapSrc(dx, dy);
      const idx = dy * size + dx;
      for (let c = 0; c < 3; c += 1) {
        const value = sampleBilinear(data, width, height, x, y, c);
        out[c * plane + idx] = (value - 127.5) / 128;
      }
    }
  }
  return out;
}

function alignWithLandmarks(
  imageData: ImageData,
  landmarks: Array<[number, number]>,
  size: number
): Float32Array {
  const { a, b, tx, ty } = estimateSimilarity(ARCFACE_TEMPLATE, landmarks);
  // Inverse: template <- image maps source pixel for each destination
  // We estimated src=template, dst=landmarks so:
  // landmark = [a, -b; b, a] * template + [tx, ty]
  // Solve for template from landmark, or sample by mapping dest template coords to image.
  return rgbaToArcFaceChw(
    imageData.data,
    imageData.width,
    imageData.height,
    size,
    (dx, dy) => ({
      x: a * dx - b * dy + tx,
      y: b * dx + a * dy + ty,
    })
  );
}

function alignWithBBox(
  imageData: ImageData,
  bbox: BoundingBox,
  size: number
): Float32Array {
  const pad = 0.25;
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const side = Math.max(bbox.width, bbox.height) * (1 + pad * 2);
  const left = cx - side / 2;
  const top = cy - side / 2;
  const scale = side / size;
  return rgbaToArcFaceChw(
    imageData.data,
    imageData.width,
    imageData.height,
    size,
    (dx, dy) => ({
      x: left + (dx + 0.5) * scale,
      y: top + (dy + 0.5) * scale,
    })
  );
}

/**
 * Produce one ArcFace CHW float32 tensor (3×112×112) for a detected face.
 */
export function alignFaceToArcFaceTensor(
  imageData: ImageData,
  face: DetectedFace,
  size: number = IDENTITY_FACE_SIZE_PX
): Float32Array {
  const landmarks =
    face.keypoints && face.keypoints.length >= 4
      ? blazeToArcFaceLandmarks(face.keypoints)
      : null;
  if (landmarks) {
    return alignWithLandmarks(imageData, landmarks, size);
  }
  return alignWithBBox(imageData, face.bbox, size);
}

export async function bitmapToImageData(bitmap: ImageBitmap): Promise<ImageData> {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : (() => {
          const c = document.createElement('canvas');
          c.width = bitmap.width;
          c.height = bitmap.height;
          return c;
        })();
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2d context for face align');
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

export function scaleFaceKeypoints(
  face: DetectedFace,
  fromSize: ImageDimensions,
  toSize: ImageDimensions
): DetectedFace {
  const scaleX = toSize.width / fromSize.width;
  const scaleY = toSize.height / fromSize.height;
  return {
    score: face.score,
    bbox: {
      x: face.bbox.x * scaleX,
      y: face.bbox.y * scaleY,
      width: face.bbox.width * scaleX,
      height: face.bbox.height * scaleY,
    },
    keypoints: face.keypoints?.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    })),
  };
}
