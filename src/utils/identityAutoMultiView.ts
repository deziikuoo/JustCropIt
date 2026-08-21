/**
 * Auto multi-view seeding for This person — sample faces across the batch
 * that match a seed face at IDENTITY_MATCH_MIN_COSINE.
 */

import type { Ref } from 'vue';
import type { Photo } from '../types/photo';
import type { BoundingBox, DetectedFace } from '../types/detection';
import type { IdentityReferenceFace } from '../types/batchCrop';
import {
  IDENTITY_AUTO_MULTIVIEW_SAMPLES,
  IDENTITY_DETECT_MAX_EDGE_PX,
  IDENTITY_MATCH_MIN_COSINE,
  IDENTITY_REF_GALLERY_MAX,
} from '../constants/optimization';
import { detectFacesInFile, embedFacesInFile } from './subjectDetection';
import { cosineSimilarity } from './faceIdentity';

export function sampleEvenlySpacedIndices(
  indices: number[],
  sampleCount: number
): number[] {
  if (indices.length === 0) return [];
  if (indices.length <= sampleCount) return [...indices];
  const out: number[] = [];
  const seen = new Set<number>();
  for (let s = 0; s < sampleCount; s += 1) {
    const t = sampleCount === 1 ? 0 : s / (sampleCount - 1);
    const idx =
      indices[
        Math.min(indices.length - 1, Math.round(t * (indices.length - 1)))
      ];
    if (!seen.has(idx)) {
      seen.add(idx);
      out.push(idx);
    }
  }
  return out;
}

/** Prefer 5 evenly spaced refs when possible; otherwise all frames (up to 4). */
export function autoReferenceSampleCount(frameCount: number): number {
  if (frameCount <= 0) return 0;
  if (frameCount >= IDENTITY_REF_GALLERY_MAX) return IDENTITY_REF_GALLERY_MAX;
  return frameCount;
}

function sampleBatchIndices(indices: number[], sampleCount: number): number[] {
  return sampleEvenlySpacedIndices(indices, sampleCount);
}

function faceArea(face: DetectedFace): number {
  return Math.max(1, face.bbox.width) * Math.max(1, face.bbox.height);
}

function largestFace(faces: DetectedFace[]): DetectedFace | null {
  if (faces.length === 0) return null;
  return faces.reduce((best, face) =>
    faceArea(face) > faceArea(best) ? face : best
  );
}

export function sameIdentityFaceApprox(
  a: IdentityReferenceFace,
  b: IdentityReferenceFace
): boolean {
  if (a.photoId !== b.photoId) return false;
  const dx = a.bbox.x + a.bbox.width / 2 - (b.bbox.x + b.bbox.width / 2);
  const dy = a.bbox.y + a.bbox.height / 2 - (b.bbox.y + b.bbox.height / 2);
  const dist = Math.hypot(dx, dy);
  const scale = Math.max(
    a.bbox.width,
    a.bbox.height,
    b.bbox.width,
    b.bbox.height
  );
  return dist < scale * 0.35;
}

function toRef(
  photo: Photo,
  photoIndex: number,
  face: DetectedFace
): IdentityReferenceFace | null {
  if (!photo.id) return null;
  return {
    photoId: photo.id,
    photoIndex,
    bbox: { ...face.bbox },
    keypoints: face.keypoints,
  };
}

/** Create a small object URL for a face crop thumbnail (caller must revoke). */
export async function createFaceCropObjectUrl(
  source: Blob | File,
  bbox: BoundingBox,
  size = 96
): Promise<string> {
  const bitmap = await createImageBitmap(source, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    const x = Math.max(0, Math.floor(bbox.x));
    const y = Math.max(0, Math.floor(bbox.y));
    const w = Math.max(1, Math.min(Math.floor(bbox.width), bitmap.width - x));
    const h = Math.max(1, Math.min(Math.floor(bbox.height), bitmap.height - y));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.drawImage(bitmap, x, y, w, h, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    );
    if (!blob) throw new Error('Failed to encode face thumb');
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close();
  }
}

/**
 * Build identity refs from explicit photo indices (largest face per photo).
 */
export async function buildGalleryFromPhotoIndices(
  photoIndices: number[],
  photos: Ref<Photo[]>,
  options?: { signal?: AbortSignal }
): Promise<IdentityReferenceFace[]> {
  const gallery: IdentityReferenceFace[] = [];
  for (const photoIndex of photoIndices) {
    if (options?.signal?.aborted) break;
    if (gallery.length >= IDENTITY_REF_GALLERY_MAX) break;
    const photo = photos.value[photoIndex];
    if (!photo?.id) continue;
    const detected = await detectFacesInFile(photo.original, photo.id, {
      maxEdge: IDENTITY_DETECT_MAX_EDGE_PX,
      multiScale: true,
    });
    const face = largestFace(detected.faces);
    if (!face) continue;
    const ref = toRef(photo, photoIndex, face);
    if (!ref) continue;
    if (gallery.some((existing) => sameIdentityFaceApprox(existing, ref))) {
      continue;
    }
    gallery.push(ref);
  }
  return gallery;
}

/**
 * Build an initial reference gallery by sampling the batch and keeping faces
 * that match the seed at cosine >= 0.58.
 */
export async function buildAutoMultiViewGallery(
  batchIndices: number[],
  photos: Ref<Photo[]>,
  options?: {
    seedPhotoIndex?: number;
    seedFace?: DetectedFace | null;
    signal?: AbortSignal;
  }
): Promise<IdentityReferenceFace[]> {
  const samples = sampleBatchIndices(
    batchIndices,
    autoReferenceSampleCount(batchIndices.length) || IDENTITY_AUTO_MULTIVIEW_SAMPLES
  );
  if (samples.length === 0) return [];

  const seedPhotoIndex = options?.seedPhotoIndex ?? samples[0];
  const seedPhoto = photos.value[seedPhotoIndex];
  if (!seedPhoto?.id) return [];

  let seedFace = options?.seedFace ?? null;
  if (!seedFace) {
    const detected = await detectFacesInFile(seedPhoto.original, seedPhoto.id, {
      maxEdge: IDENTITY_DETECT_MAX_EDGE_PX,
      multiScale: true,
    });
    if (options?.signal?.aborted) return [];
    seedFace =
      detected.faces.length === 1
        ? detected.faces[0]
        : largestFace(detected.faces);
  }
  if (!seedFace) return [];

  const seedEmbedded = await embedFacesInFile(
    seedPhoto.original,
    seedPhoto.id,
    [seedFace]
  );
  if (options?.signal?.aborted) return [];
  const seedEmbedding = seedEmbedded.embeddings[0];
  if (!seedEmbedding?.length) return [];

  const gallery: IdentityReferenceFace[] = [];
  const seedRef = toRef(seedPhoto, seedPhotoIndex, seedFace);
  if (seedRef) gallery.push(seedRef);

  for (const photoIndex of samples) {
    if (options?.signal?.aborted) break;
    if (gallery.length >= IDENTITY_REF_GALLERY_MAX) break;
    if (photoIndex === seedPhotoIndex) continue;

    const photo = photos.value[photoIndex];
    if (!photo?.id) continue;

    const detected = await detectFacesInFile(photo.original, photo.id, {
      maxEdge: IDENTITY_DETECT_MAX_EDGE_PX,
      multiScale: true,
    });
    if (detected.faces.length === 0) continue;

    const embedded = await embedFacesInFile(
      photo.original,
      photo.id,
      detected.faces
    );
    let bestFace: DetectedFace | null = null;
    let bestScore = IDENTITY_MATCH_MIN_COSINE;
    for (let i = 0; i < detected.faces.length; i += 1) {
      const emb = embedded.embeddings[i];
      if (!emb?.length) continue;
      const score = cosineSimilarity(seedEmbedding, emb);
      if (score >= bestScore) {
        bestScore = score;
        bestFace = detected.faces[i];
      }
    }
    if (!bestFace) continue;
    const ref = toRef(photo, photoIndex, bestFace);
    if (!ref) continue;
    if (gallery.some((existing) => sameIdentityFaceApprox(existing, ref))) {
      continue;
    }
    gallery.push(ref);
  }

  return gallery.slice(0, IDENTITY_REF_GALLERY_MAX);
}

export function mergeIdentityReference(
  gallery: IdentityReferenceFace[],
  next: IdentityReferenceFace
): IdentityReferenceFace[] {
  const withoutDup = gallery.filter(
    (existing) => !sameIdentityFaceApprox(existing, next)
  );
  const merged = [...withoutDup, next];
  return merged.slice(-IDENTITY_REF_GALLERY_MAX);
}

export function toggleIdentityReference(
  gallery: IdentityReferenceFace[],
  next: IdentityReferenceFace
): IdentityReferenceFace[] {
  const existingIndex = gallery.findIndex((existing) =>
    sameIdentityFaceApprox(existing, next)
  );
  if (existingIndex >= 0) {
    return gallery.filter((_, i) => i !== existingIndex);
  }
  return mergeIdentityReference(gallery, next);
}
