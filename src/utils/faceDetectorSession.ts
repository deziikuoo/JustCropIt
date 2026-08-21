/**
 * Main-thread MediaPipe Face Detector (BlazeFace short-range only).
 * MediaPipe 0.10.x uses importScripts() which ES module workers cannot run;
 * initialization on the main document avoids that limitation.
 *
 * Tasks Face Detector is hardcoded for 896 anchors. Do not load
 * blaze_face_full_range.tflite here (2304 boxes → graph crash).
 */

import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import type { BoundingBox, DetectedFace } from '../types/detection';
import {
  FACE_DETECTOR_MODEL_FILE,
  IDENTITY_DETECT_TILE_COLS,
  IDENTITY_DETECT_TILE_OVERLAP,
  IDENTITY_DETECT_TILE_ROWS,
  IDENTITY_MAX_FACES,
  IDENTITY_SMALL_FACE_MIN_SIDE_RATIO,
} from '../constants/optimization';
import { getModelUrl, getWasmPath } from './mediapipeAssets';

let faceDetector: FaceDetector | null = null;
let initPromise: Promise<FaceDetector> | null = null;
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

export async function getFaceDetector(): Promise<FaceDetector> {
  if (faceDetector) return faceDetector;
  if (initError) throw new Error(initError);
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const loadStart = performance.now();
    try {
      const vision = await getVisionFileset();
      const detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: getModelUrl(FACE_DETECTOR_MODEL_FILE),
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.3,
      });
      lastModelLoadMs = performance.now() - loadStart;
      faceDetector = detector;
      return detector;
    } catch (error) {
      initError = error instanceof Error ? error.message : String(error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

export interface FaceDetectResult {
  bbox: BoundingBox | null;
  inferenceMs: number;
  loadModelMs: number;
}

function detectionsToFaces(
  detections: NonNullable<ReturnType<FaceDetector['detect']>['detections']>,
  imageWidth: number,
  imageHeight: number
): DetectedFace[] {
  const faces: DetectedFace[] = [];
  for (const detection of detections) {
    const box = detection.boundingBox;
    if (!box) continue;
    const keypoints =
      detection.keypoints?.length > 0
        ? detection.keypoints.map((point) => ({
            x: point.x * imageWidth,
            y: point.y * imageHeight,
          }))
        : undefined;
    faces.push({
      bbox: {
        x: box.originX,
        y: box.originY,
        width: box.width,
        height: box.height,
      },
      score: detection.categories?.[0]?.score ?? 0,
      keypoints,
    });
  }
  return faces.sort((a, b) => b.score - a.score).slice(0, IDENTITY_MAX_FACES);
}

function bboxIou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

export function nmsFaces(
  faces: DetectedFace[],
  iouThreshold = 0.4
): DetectedFace[] {
  const sorted = [...faces].sort((a, b) => b.score - a.score);
  const kept: DetectedFace[] = [];
  for (const face of sorted) {
    if (kept.every((other) => bboxIou(other.bbox, face.bbox) < iouThreshold)) {
      kept.push(face);
    }
    if (kept.length >= IDENTITY_MAX_FACES) break;
  }
  return kept;
}

interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlappingTiles(
  width: number,
  height: number,
  cols: number,
  rows: number,
  overlap: number
): TileRect[] {
  const tileW = Math.min(width, Math.ceil((width / cols) * (1 + overlap)));
  const tileH = Math.min(height, Math.ceil((height / rows) * (1 + overlap)));
  const tiles: TileRect[] = [];
  const xSpan = Math.max(1, width - tileW);
  const ySpan = Math.max(1, height - tileH);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x =
        cols === 1 ? 0 : Math.round((col * xSpan) / Math.max(1, cols - 1));
      const y =
        rows === 1 ? 0 : Math.round((row * ySpan) / Math.max(1, rows - 1));
      tiles.push({ x, y, width: tileW, height: tileH });
    }
  }
  return tiles;
}

function offsetFace(face: DetectedFace, dx: number, dy: number): DetectedFace {
  return {
    score: face.score,
    bbox: {
      x: face.bbox.x + dx,
      y: face.bbox.y + dy,
      width: face.bbox.width,
      height: face.bbox.height,
    },
    keypoints: face.keypoints?.map((point) => ({
      x: point.x + dx,
      y: point.y + dy,
    })),
  };
}

export async function detectFaceInBitmap(
  bitmap: ImageBitmap,
  options?: { closeBitmap?: boolean }
): Promise<FaceDetectResult> {
  const closeBitmap = options?.closeBitmap ?? true;
  const inferenceStart = performance.now();
  const loadModelMs = faceDetector ? 0 : lastModelLoadMs;

  try {
    const detector = await getFaceDetector();
    const result = detector.detect(bitmap);
    const inferenceMs = performance.now() - inferenceStart;
    const faces = detectionsToFaces(
      result.detections ?? [],
      bitmap.width,
      bitmap.height
    );
    return {
      bbox: faces[0]?.bbox ?? null,
      inferenceMs,
      loadModelMs,
    };
  } finally {
    if (closeBitmap) {
      bitmap.close();
    }
  }
}

export async function detectAllFacesInBitmap(
  bitmap: ImageBitmap,
  options?: { closeBitmap?: boolean }
): Promise<{
  faces: DetectedFace[];
  inferenceMs: number;
  loadModelMs: number;
}> {
  const closeBitmap = options?.closeBitmap ?? true;
  const inferenceStart = performance.now();
  const loadModelMs = faceDetector ? 0 : lastModelLoadMs;

  try {
    const detector = await getFaceDetector();
    const result = detector.detect(bitmap);
    return {
      faces: detectionsToFaces(
        result.detections ?? [],
        bitmap.width,
        bitmap.height
      ),
      inferenceMs: performance.now() - inferenceStart,
      loadModelMs,
    };
  } finally {
    if (closeBitmap) {
      bitmap.close();
    }
  }
}

/** Clamp and expand a bbox by `padRatio` (e.g. 1.8 → ~1.8× face box). */
export function padBboxAsRoi(
  bbox: BoundingBox,
  imageWidth: number,
  imageHeight: number,
  padRatio: number
): BoundingBox {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const w = Math.max(1, bbox.width * padRatio);
  const h = Math.max(1, bbox.height * padRatio);
  let x = cx - w / 2;
  let y = cy - h / 2;
  let width = w;
  let height = h;
  if (x < 0) {
    width += x;
    x = 0;
  }
  if (y < 0) {
    height += y;
    y = 0;
  }
  if (x + width > imageWidth) width = imageWidth - x;
  if (y + height > imageHeight) height = imageHeight - y;
  return {
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y)),
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
}

/**
 * Detect faces only inside a padded ROI (no tiles). Used for identity
 * in-between frames between ArcFace keyframes.
 */
export async function detectAllFacesInRoi(
  bitmap: ImageBitmap,
  roi: BoundingBox,
  options?: { closeBitmap?: boolean }
): Promise<{
  faces: DetectedFace[];
  inferenceMs: number;
  loadModelMs: number;
}> {
  const closeBitmap = options?.closeBitmap ?? true;
  const clamped = padBboxAsRoi(roi, bitmap.width, bitmap.height, 1);
  try {
    if (
      clamped.width < 8 ||
      clamped.height < 8 ||
      clamped.width >= bitmap.width * 0.98
    ) {
      // Degenerate / nearly full-frame — fall back to full detect (no tiles).
      return detectAllFacesInBitmap(bitmap, { closeBitmap: false });
    }
    const crop = await createImageBitmap(
      bitmap,
      clamped.x,
      clamped.y,
      clamped.width,
      clamped.height
    );
    try {
      const result = await detectAllFacesInBitmap(crop, { closeBitmap: false });
      return {
        faces: result.faces.map((face) =>
          offsetFace(face, clamped.x, clamped.y)
        ),
        inferenceMs: result.inferenceMs,
        loadModelMs: result.loadModelMs,
      };
    } finally {
      crop.close();
    }
  } finally {
    if (closeBitmap) {
      bitmap.close();
    }
  }
}

/**
 * Short-range detect on the full frame, then overlapping tiles when faces
 * are missing or small. Tiles make a mid-shot face occupy more of the
 * detector's fixed internal input.
 */
export async function detectAllFacesMultiScale(
  bitmap: ImageBitmap,
  options?: { closeBitmap?: boolean }
): Promise<{
  faces: DetectedFace[];
  inferenceMs: number;
  loadModelMs: number;
}> {
  const closeBitmap = options?.closeBitmap ?? true;
  try {
    const full = await detectAllFacesInBitmap(bitmap, { closeBitmap: false });
    const minSide = Math.min(bitmap.width, bitmap.height);
    const largest = full.faces.reduce(
      (max, face) =>
        Math.max(max, Math.min(face.bbox.width, face.bbox.height)),
      0
    );
    const needTiles =
      minSide >= 400 &&
      (full.faces.length === 0 ||
        largest < minSide * IDENTITY_SMALL_FACE_MIN_SIDE_RATIO);

    if (!needTiles) return full;

    const tiles = overlappingTiles(
      bitmap.width,
      bitmap.height,
      IDENTITY_DETECT_TILE_COLS,
      IDENTITY_DETECT_TILE_ROWS,
      IDENTITY_DETECT_TILE_OVERLAP
    );
    const extra: DetectedFace[] = [];
    let inferenceMs = full.inferenceMs;

    for (const tile of tiles) {
      const crop = await createImageBitmap(
        bitmap,
        tile.x,
        tile.y,
        tile.width,
        tile.height
      );
      try {
        const result = await detectAllFacesInBitmap(crop, { closeBitmap: false });
        inferenceMs += result.inferenceMs;
        for (const face of result.faces) {
          extra.push(offsetFace(face, tile.x, tile.y));
        }
      } finally {
        crop.close();
      }
    }

    return {
      faces: nmsFaces([...full.faces, ...extra]),
      inferenceMs,
      loadModelMs: full.loadModelMs,
    };
  } finally {
    if (closeBitmap) {
      bitmap.close();
    }
  }
}

export function isFaceDetectionSupported(): boolean {
  return typeof createImageBitmap !== 'undefined';
}

export function resetFaceDetectorSession(): void {
  if (faceDetector) {
    faceDetector.close();
    faceDetector = null;
  }
  initPromise = null;
  initError = null;
  lastModelLoadMs = 0;
  visionFilesetPromise = null;
}
