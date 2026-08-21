/**
 * Identity face embedding cache — session LRU + batch-scoped scratch.
 * Memory-only (never IndexedDB).
 */

import {
  IDENTITY_BATCH_SCRATCH_MAX,
  IDENTITY_CACHE_MAX_PHOTOS,
  IDENTITY_EMBEDDER_MODEL_ID,
} from '../constants/optimization';
import type { BoundingBox } from '../types/detection';

export interface CachedIdentityFace {
  bbox: BoundingBox;
  embedding: Float32Array;
}

interface CacheEntry {
  key: string;
  faces: CachedIdentityFace[];
  imageSize?: { width: number; height: number };
}

const sessionLru: CacheEntry[] = [];
/** In-flight This person batch: holds every photo for the current run. */
let batchScratch: Map<
  string,
  { faces: CachedIdentityFace[]; imageSize?: { width: number; height: number } }
> | null = null;

export function identityCacheKey(
  photoId: string,
  size: number,
  lastModified: number
): string {
  return `${photoId}:${size}:${lastModified}:${IDENTITY_EMBEDDER_MODEL_ID}`;
}

export function beginIdentityBatchScratch(): void {
  batchScratch = new Map();
}

export function clearIdentityBatchScratch(): void {
  batchScratch = null;
}

export function getCachedIdentityFaces(key: string): {
  faces: CachedIdentityFace[];
  imageSize?: { width: number; height: number };
} | null {
  const scratch = batchScratch?.get(key);
  if (scratch) return scratch;

  const index = sessionLru.findIndex((entry) => entry.key === key);
  if (index < 0) return null;
  const [entry] = sessionLru.splice(index, 1);
  sessionLru.push(entry);
  if (batchScratch && batchScratch.size < IDENTITY_BATCH_SCRATCH_MAX) {
    batchScratch.set(key, {
      faces: entry.faces,
      imageSize: entry.imageSize,
    });
  }
  return { faces: entry.faces, imageSize: entry.imageSize };
}

export function setCachedIdentityFaces(
  key: string,
  faces: CachedIdentityFace[],
  imageSize?: { width: number; height: number }
): void {
  if (batchScratch) {
    if (batchScratch.size < IDENTITY_BATCH_SCRATCH_MAX || batchScratch.has(key)) {
      batchScratch.set(key, { faces, imageSize });
    }
  }

  const existing = sessionLru.findIndex((entry) => entry.key === key);
  if (existing >= 0) {
    sessionLru.splice(existing, 1);
  }
  sessionLru.push({ key, faces, imageSize });
  while (sessionLru.length > IDENTITY_CACHE_MAX_PHOTOS) {
    sessionLru.shift();
  }
}

export function invalidateIdentityPhoto(photoId: string): void {
  const prefix = `${photoId}:`;
  for (let i = sessionLru.length - 1; i >= 0; i -= 1) {
    if (sessionLru[i].key.startsWith(prefix)) {
      sessionLru.splice(i, 1);
    }
  }
  if (batchScratch) {
    for (const key of [...batchScratch.keys()]) {
      if (key.startsWith(prefix)) batchScratch.delete(key);
    }
  }
}

export function clearIdentityCache(): void {
  sessionLru.length = 0;
  batchScratch = null;
}
