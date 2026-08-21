/**
 * Bidirectional neighbor face-box fill for This person batch crops.
 * Pure helpers — no I/O. Cosine threshold is never relaxed here.
 */

import {
  IDENTITY_NEIGHBOR_MAX_ASPECT_DELTA,
  IDENTITY_NEIGHBOR_MAX_CENTER_SHIFT_RATIO,
  IDENTITY_NEIGHBOR_MAX_SIZE_RATIO,
  IDENTITY_NEIGHBOR_MIN_FACE_EDGE_PX,
  IDENTITY_NEIGHBOR_MIN_SIZE_RATIO,
  IDENTITY_NEIGHBOR_WINDOW,
} from '../constants/optimization';
import type { BoundingBox, ImageDimensions } from '../types/detection';

export interface IdentityPass1Result {
  batchOrder: number;
  photoId: string;
  photoIndex: number;
  imageSize: ImageDimensions;
  /** ArcFace hit at >= IDENTITY_MATCH_MIN_COSINE */
  matchBbox: BoundingBox | null;
  /** All faces detected in Pass 1 (for neighbor gates). */
  candidateFaces: BoundingBox[];
  bestCosine?: number;
}

function bboxCenter(bbox: BoundingBox): { x: number; y: number } {
  return {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height / 2,
  };
}

function bboxArea(bbox: BoundingBox): number {
  return Math.max(1, bbox.width) * Math.max(1, bbox.height);
}

function aspectRatio(size: ImageDimensions): number {
  return size.width / Math.max(1, size.height);
}

/** Scale a pixel bbox from one image size into another via normalized coords. */
export function projectBbox(
  bbox: BoundingBox,
  fromSize: ImageDimensions,
  toSize: ImageDimensions
): BoundingBox {
  const nx = bbox.x / Math.max(1, fromSize.width);
  const ny = bbox.y / Math.max(1, fromSize.height);
  const nw = bbox.width / Math.max(1, fromSize.width);
  const nh = bbox.height / Math.max(1, fromSize.height);
  return {
    x: nx * toSize.width,
    y: ny * toSize.height,
    width: nw * toSize.width,
    height: nh * toSize.height,
  };
}

export function isPlausibleNeighborProjection(
  projected: BoundingBox,
  missSize: ImageDimensions,
  neighborSize: ImageDimensions,
  candidateFaces: BoundingBox[]
): { ok: boolean; hint: BoundingBox | null } {
  const aspectDelta = Math.abs(
    aspectRatio(missSize) - aspectRatio(neighborSize)
  );
  if (aspectDelta > IDENTITY_NEIGHBOR_MAX_ASPECT_DELTA) {
    return { ok: false, hint: null };
  }

  const minEdge = Math.min(projected.width, projected.height);
  if (minEdge < IDENTITY_NEIGHBOR_MIN_FACE_EDGE_PX) {
    return { ok: false, hint: null };
  }

  const projectedCenter = bboxCenter(projected);
  const minSide = Math.min(missSize.width, missSize.height);
  const maxShift = minSide * IDENTITY_NEIGHBOR_MAX_CENTER_SHIFT_RATIO;
  const projectedArea = bboxArea(projected);

  if (candidateFaces.length === 0) {
    // No detector hit — still allow projected box for portrait hint.
    return { ok: true, hint: projected };
  }

  let best: BoundingBox | null = null;
  let bestDist = Infinity;
  for (const face of candidateFaces) {
    const center = bboxCenter(face);
    const dist = Math.hypot(
      center.x - projectedCenter.x,
      center.y - projectedCenter.y
    );
    if (dist > maxShift) continue;
    const areaRatio = bboxArea(face) / projectedArea;
    if (
      areaRatio < IDENTITY_NEIGHBOR_MIN_SIZE_RATIO ||
      areaRatio > IDENTITY_NEIGHBOR_MAX_SIZE_RATIO
    ) {
      continue;
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = face;
    }
  }

  if (!best) return { ok: false, hint: null };
  return { ok: true, hint: best };
}

/**
 * For each Pass 1 miss, find nearest ArcFace match within ±window in batch order
 * and return a gated projected hint bbox.
 */
export function fillIdentityMisses(
  results: IdentityPass1Result[],
  window: number = IDENTITY_NEIGHBOR_WINDOW
): Map<string, BoundingBox> {
  const hints = new Map<string, BoundingBox>();
  const matchedByOrder = new Map<number, IdentityPass1Result>();
  for (const row of results) {
    if (row.matchBbox) matchedByOrder.set(row.batchOrder, row);
  }

  for (const miss of results) {
    if (miss.matchBbox) continue;

    let bestNeighbor: IdentityPass1Result | null = null;
    let bestGap = Infinity;
    for (const [order, neighbor] of matchedByOrder) {
      const gap = Math.abs(order - miss.batchOrder);
      if (gap === 0 || gap > window) continue;
      if (gap < bestGap) {
        bestGap = gap;
        bestNeighbor = neighbor;
      }
    }
    if (!bestNeighbor?.matchBbox) continue;

    const projected = projectBbox(
      bestNeighbor.matchBbox,
      bestNeighbor.imageSize,
      miss.imageSize
    );
    const gated = isPlausibleNeighborProjection(
      projected,
      miss.imageSize,
      bestNeighbor.imageSize,
      miss.candidateFaces
    );
    if (gated.ok && gated.hint) {
      hints.set(miss.photoId, gated.hint);
    }
  }

  return hints;
}
