/**
 * Per-photo subject-aware batch crop (follow subject / this person).
 */

import type { Ref } from 'vue';
import type { Photo } from '../types/photo';
import type { BatchCropRecipe, BatchSmartCropResult } from '../types/batchCrop';
import type { BoundingBox, CropTarget, DetectedFace } from '../types/detection';
import {
  IDENTITY_DEBUG_LOGS,
  IDENTITY_DETECT_MAX_EDGE_PX,
  IDENTITY_KEYFRAME_STRIDE,
  IDENTITY_MATCH_MIN_COSINE,
  IDENTITY_ROI_PAD_RATIO,
  IDENTITY_TRACK_MAX_ROI_SKIPS,
} from '../constants/optimization';
import { isBatchAborted, type BatchProgressCallback } from './batchEditProgress';
import { bboxToSuggestedCrop } from './cropSuggestion';
import {
  detectFacesInFile,
  detectSubject,
  embedFacesInFile,
} from './subjectDetection';
import {
  beginIdentityBatchScratch,
  clearIdentityBatchScratch,
  getCachedIdentityFaces,
  identityCacheKey,
  setCachedIdentityFaces,
} from './identityCache';
import { pickBestMatchIndexVsGallery } from './faceIdentity';
import {
  fillIdentityMisses,
  isPlausibleNeighborProjection,
  projectBbox,
  type IdentityPass1Result,
} from './identityNeighbors';
import { padBboxAsRoi } from './faceDetectorSession';
import { runBatchCropEach, type PhotoCropJob } from './batchImageOps';
import { blobToFile } from './blobToFile';
import { updatePhoto, updatePhotosBatch } from './photoStorage';
import type { ApplyFlipsRotationAndCropFn } from './undoRedo/commands/BaseCommand';
import { CropCommand } from './undoRedo/commands/CropCommand';

async function getIdentityFaces(
  photo: Photo,
  photoId: string,
  options?: { multiScale?: boolean }
): Promise<{
  faces: Array<{ bbox: BoundingBox; embedding: Float32Array }>;
  imageSize: { width: number; height: number } | null;
  loadModelMs?: number;
  inferenceMs?: number;
}> {
  const key = identityCacheKey(
    photoId,
    photo.original.size,
    photo.original.lastModified
  );
  const cached = getCachedIdentityFaces(key);
  if (cached) {
    return {
      faces: cached.faces,
      imageSize: cached.imageSize ?? null,
    };
  }

  const detected = await detectFacesInFile(photo.original, photoId, {
    maxEdge: IDENTITY_DETECT_MAX_EDGE_PX,
    multiScale: options?.multiScale ?? false,
  });
  const imageSize = detected.imageSize ?? null;
  if (detected.faces.length === 0) {
    setCachedIdentityFaces(key, [], imageSize ?? undefined);
    return { faces: [], imageSize };
  }

  const embedded = await embedFacesInFile(
    photo.original,
    photoId,
    detected.faces
  );
  const faces = detected.faces.map((face: DetectedFace, index) => ({
    bbox: face.bbox,
    embedding: embedded.embeddings[index] ?? new Float32Array(),
  }));
  setCachedIdentityFaces(key, faces, imageSize ?? undefined);
  return {
    faces,
    imageSize,
    loadModelMs: embedded.loadModelMs,
    inferenceMs: embedded.inferenceMs,
  };
}

async function resolveImageSize(
  photo: Photo,
  known: { width: number; height: number } | null
): Promise<{ width: number; height: number }> {
  if (known) return known;
  const bitmap = await createImageBitmap(photo.original, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

async function tryRoiTrack(
  photo: Photo,
  lastMatch: {
    bbox: BoundingBox;
    imageSize: { width: number; height: number };
  },
  imageSize: { width: number; height: number }
): Promise<{
  ok: boolean;
  hint: BoundingBox | null;
  candidateFaces: BoundingBox[];
}> {
  const projected = projectBbox(
    lastMatch.bbox,
    lastMatch.imageSize,
    imageSize
  );
  const roi = padBboxAsRoi(
    projected,
    imageSize.width,
    imageSize.height,
    IDENTITY_ROI_PAD_RATIO
  );
  const detected = await detectFacesInFile(photo.original, photo.id!, {
    maxEdge: IDENTITY_DETECT_MAX_EDGE_PX,
    multiScale: false,
    roi,
  });
  const candidateFaces = detected.faces.map((face) => face.bbox);
  if (candidateFaces.length === 0) {
    return { ok: false, hint: null, candidateFaces };
  }
  const gated = isPlausibleNeighborProjection(
    projected,
    imageSize,
    lastMatch.imageSize,
    candidateFaces
  );
  return {
    ok: gated.ok,
    hint: gated.hint,
    candidateFaces,
  };
}

async function runThisPersonPass1(
  indices: number[],
  photos: Ref<Photo[]>,
  referenceEmbeddings: Float32Array[],
  onProgress?: BatchProgressCallback,
  signal?: AbortSignal
): Promise<{
  results: IdentityPass1Result[];
  identityLoadModelMs: number;
  identityInferenceMs: number;
  keyframeCount: number;
  roiSkipCount: number;
  promotedCount: number;
  softMissCount: number;
}> {
  const results: IdentityPass1Result[] = [];
  let identityLoadModelMs = 0;
  let identityInferenceMs = 0;
  let keyframeCount = 0;
  let roiSkipCount = 0;
  let promotedCount = 0;
  let softMissCount = 0;
  const total = indices.length;

  let lastMatch: {
    bbox: BoundingBox;
    imageSize: { width: number; height: number };
  } | null = null;
  let forceKeyframe = true;
  let healthyTrack = false;
  let consecutiveRoiSkips = 0;

  for (let i = 0; i < indices.length; i += 1) {
    if (isBatchAborted(signal)) break;
    const photoIndex = indices[i];
    const photo = photos.value[photoIndex];
    if (!photo?.id) {
      onProgress?.(i + 1, total);
      continue;
    }

    const isFirst = i === 0;
    const isLast = i === indices.length - 1;
    const onColdStride = i % IDENTITY_KEYFRAME_STRIDE === 0;
    let runKeyframe =
      forceKeyframe || isFirst || isLast || !lastMatch;
    if (!runKeyframe && lastMatch) {
      if (healthyTrack) {
        if (consecutiveRoiSkips >= IDENTITY_TRACK_MAX_ROI_SKIPS) {
          runKeyframe = true;
        }
      } else if (onColdStride) {
        runKeyframe = true;
      }
    }
    let path: 'keyframe' | 'roi-skip' | 'promoted' | 'soft-miss' = 'keyframe';

    let matchBbox: BoundingBox | null = null;
    let candidateFaces: BoundingBox[] = [];
    let bestCosine = 0;
    let imageSize: { width: number; height: number };

    if (!runKeyframe && lastMatch) {
      imageSize = await resolveImageSize(photo, null);
      const gated = await tryRoiTrack(photo, lastMatch, imageSize);
      candidateFaces = gated.candidateFaces;
      if (gated.ok && gated.hint) {
        matchBbox = gated.hint;
        path = 'roi-skip';
        roiSkipCount += 1;
        consecutiveRoiSkips += 1;
        forceKeyframe = false;
        lastMatch = { bbox: gated.hint, imageSize };
        if (IDENTITY_DEBUG_LOGS) {
          console.debug('[identity]', {
            photoId: photo.id,
            path,
            faces: candidateFaces.length,
            consecutiveRoiSkips,
          });
        }
        results.push({
          batchOrder: i,
          photoId: photo.id,
          photoIndex,
          imageSize,
          matchBbox,
          candidateFaces,
          bestCosine: 0,
        });
        onProgress?.(i + 1, total);
        continue;
      }
      runKeyframe = true;
      path = 'promoted';
      promotedCount += 1;
      consecutiveRoiSkips = 0;
      healthyTrack = false;
    }

    if (runKeyframe) {
      if (path !== 'promoted') path = 'keyframe';
      keyframeCount += 1;

      const {
        faces,
        imageSize: detectedSize,
        loadModelMs,
        inferenceMs,
      } = await getIdentityFaces(photo, photo.id, { multiScale: true });
      identityLoadModelMs += loadModelMs ?? 0;
      identityInferenceMs += inferenceMs ?? 0;

      imageSize = await resolveImageSize(photo, detectedSize);
      candidateFaces = faces.map((face) => face.bbox);
      const embeddings = faces.map((face) => face.embedding);
      const { index: matchIndex, bestCosine: galleryBest } =
        pickBestMatchIndexVsGallery(
          referenceEmbeddings,
          embeddings,
          IDENTITY_MATCH_MIN_COSINE
        );
      bestCosine = galleryBest;
      matchBbox = matchIndex >= 0 ? faces[matchIndex].bbox : null;

      if (matchBbox) {
        lastMatch = { bbox: matchBbox, imageSize };
        forceKeyframe = false;
        healthyTrack = true;
        consecutiveRoiSkips = 0;
      } else if (lastMatch && healthyTrack) {
        // Soft verification miss: keep track if ROI + spatial gate still hold.
        const soft = await tryRoiTrack(photo, lastMatch, imageSize);
        candidateFaces =
          soft.candidateFaces.length > 0
            ? soft.candidateFaces
            : candidateFaces;
        if (soft.ok && soft.hint) {
          matchBbox = soft.hint;
          lastMatch = { bbox: soft.hint, imageSize };
          forceKeyframe = false;
          consecutiveRoiSkips = 0;
          softMissCount += 1;
          path = 'soft-miss';
        } else {
          forceKeyframe = true;
          healthyTrack = false;
          lastMatch = null;
          consecutiveRoiSkips = 0;
        }
      } else {
        forceKeyframe = true;
        healthyTrack = false;
        consecutiveRoiSkips = 0;
      }

      if (IDENTITY_DEBUG_LOGS) {
        console.debug('[identity]', {
          photoId: photo.id,
          path,
          faces: faces.length,
          bestCosine: Number(bestCosine.toFixed(3)),
          matched: matchIndex >= 0,
          softMiss: path === 'soft-miss',
        });
      }

      results.push({
        batchOrder: i,
        photoId: photo.id,
        photoIndex,
        imageSize,
        matchBbox,
        candidateFaces,
        bestCosine,
      });
      onProgress?.(i + 1, total);
    }
  }

  return {
    results,
    identityLoadModelMs,
    identityInferenceMs,
    keyframeCount,
    roiSkipCount,
    promotedCount,
    softMissCount,
  };
}

async function bakeJobsFromHints(
  entries: Array<{
    photoIndex: number;
    photoId: string;
    hint: BoundingBox;
    neighborUsed: boolean;
  }>,
  photos: Ref<Photo[]>,
  target: CropTarget,
  aspectRatio: number | null,
  rotation: number,
  onProgress?: BatchProgressCallback,
  signal?: AbortSignal
): Promise<{
  jobs: PhotoCropJob[];
  skippedPhotoIds: string[];
  detectWorkerUsed: boolean;
  matchedCount: number;
  neighborFilledCount: number;
}> {
  const jobs: PhotoCropJob[] = [];
  const skippedPhotoIds: string[] = [];
  let detectWorkerUsed = false;
  let matchedCount = 0;
  let neighborFilledCount = 0;
  const total = entries.length;

  for (let i = 0; i < entries.length; i += 1) {
    if (isBatchAborted(signal)) break;
    const entry = entries[i];
    const photo = photos.value[entry.photoIndex];
    if (!photo?.id) {
      onProgress?.(i + 1, total);
      continue;
    }

    const result = await detectSubject(
      photo.original,
      photo.id,
      target,
      entry.hint
    );
    if (result.workerUsed) detectWorkerUsed = true;

    const imageSize = result.imageSize;
    if (!result.bbox || !imageSize) {
      skippedPhotoIds.push(photo.id);
      onProgress?.(i + 1, total);
      continue;
    }

    const suggested = bboxToSuggestedCrop(result.bbox, imageSize, {
      aspectRatio,
    });
    if (!suggested) {
      skippedPhotoIds.push(photo.id);
      onProgress?.(i + 1, total);
      continue;
    }

    if (entry.neighborUsed) neighborFilledCount += 1;
    else matchedCount += 1;

    if (IDENTITY_DEBUG_LOGS && entry.neighborUsed) {
      console.debug('[identity] neighbor fill', { photoId: photo.id });
    }

    jobs.push({
      index: entry.photoIndex,
      crop: suggested,
      rotation,
    });
    onProgress?.(i + 1, total);
  }

  return {
    jobs,
    skippedPhotoIds,
    detectWorkerUsed,
    matchedCount,
    neighborFilledCount,
  };
}

export async function resolveBatchSmartCrops(
  indices: number[],
  photos: Ref<Photo[]>,
  recipe: BatchCropRecipe,
  referenceEmbeddings: Float32Array[] | null,
  onProgress?: BatchProgressCallback,
  onPhase?: (label: string) => void,
  signal?: AbortSignal
): Promise<{
  jobs: PhotoCropJob[];
  skippedPhotoIds: string[];
  detectWorkerUsed: boolean;
  identityLoadModelMs: number;
  identityInferenceMs: number;
  matchedCount: number;
  neighborFilledCount: number;
}> {
  const target = recipe.cropTarget as CropTarget;

  if (
    recipe.mode === 'this-person' &&
    referenceEmbeddings &&
    referenceEmbeddings.length > 0
  ) {
    beginIdentityBatchScratch();
    try {
      onPhase?.('Matching faces');
      const {
        results,
        identityLoadModelMs,
        identityInferenceMs,
        keyframeCount,
        roiSkipCount,
        promotedCount,
        softMissCount,
      } = await runThisPersonPass1(
        indices,
        photos,
        referenceEmbeddings,
        onProgress,
        signal
      );

      if (IDENTITY_DEBUG_LOGS) {
        console.debug('[identity] pass1 summary', {
          keyframeCount,
          roiSkipCount,
          promotedCount,
          softMissCount,
          refCount: referenceEmbeddings.length,
          total: results.length,
        });
      }

      if (isBatchAborted(signal)) {
        return {
          jobs: [],
          skippedPhotoIds: results
            .filter((r) => !r.matchBbox)
            .map((r) => r.photoId),
          detectWorkerUsed: false,
          identityLoadModelMs,
          identityInferenceMs,
          matchedCount: 0,
          neighborFilledCount: 0,
        };
      }

      onPhase?.('Filling gaps');
      const neighborHints = fillIdentityMisses(results);

      const entries: Array<{
        photoIndex: number;
        photoId: string;
        hint: BoundingBox;
        neighborUsed: boolean;
      }> = [];
      const skippedPhotoIds: string[] = [];

      for (const row of results) {
        if (row.matchBbox) {
          entries.push({
            photoIndex: row.photoIndex,
            photoId: row.photoId,
            hint: row.matchBbox,
            neighborUsed: false,
          });
          continue;
        }
        const neighbor = neighborHints.get(row.photoId);
        if (neighbor) {
          entries.push({
            photoIndex: row.photoIndex,
            photoId: row.photoId,
            hint: neighbor,
            neighborUsed: true,
          });
        } else {
          skippedPhotoIds.push(row.photoId);
        }
      }

      onPhase?.('Finding subject');
      const baked = await bakeJobsFromHints(
        entries,
        photos,
        target,
        recipe.aspectRatio,
        recipe.rotation,
        onProgress,
        signal
      );

      return {
        jobs: baked.jobs,
        skippedPhotoIds: [...skippedPhotoIds, ...baked.skippedPhotoIds],
        detectWorkerUsed: baked.detectWorkerUsed,
        identityLoadModelMs,
        identityInferenceMs,
        matchedCount: baked.matchedCount,
        neighborFilledCount: baked.neighborFilledCount,
      };
    } finally {
      clearIdentityBatchScratch();
    }
  }

  // Follow subject (and any non-identity path)
  const jobs: PhotoCropJob[] = [];
  const skippedPhotoIds: string[] = [];
  let detectWorkerUsed = false;
  const total = indices.length;

  for (let i = 0; i < indices.length; i += 1) {
    if (isBatchAborted(signal)) break;
    const index = indices[i];
    const photo = photos.value[index];
    if (!photo?.id) {
      onProgress?.(i + 1, total);
      continue;
    }

    const result = await detectSubject(photo.original, photo.id, target);
    if (result.workerUsed) detectWorkerUsed = true;

    const imageSize = result.imageSize;
    if (!result.bbox || !imageSize) {
      skippedPhotoIds.push(photo.id);
      onProgress?.(i + 1, total);
      continue;
    }

    const suggested = bboxToSuggestedCrop(result.bbox, imageSize, {
      aspectRatio: recipe.aspectRatio,
    });
    if (!suggested) {
      skippedPhotoIds.push(photo.id);
      onProgress?.(i + 1, total);
      continue;
    }

    jobs.push({
      index,
      crop: suggested,
      rotation: recipe.rotation,
    });
    onProgress?.(i + 1, total);
  }

  return {
    jobs,
    skippedPhotoIds,
    detectWorkerUsed,
    identityLoadModelMs: 0,
    identityInferenceMs: 0,
    matchedCount: jobs.length,
    neighborFilledCount: 0,
  };
}

export async function runBatchSmartCropPipeline(
  indices: number[],
  photos: Ref<Photo[]>,
  recipe: BatchCropRecipe,
  referenceEmbeddings: Float32Array[] | null,
  updatePhotosBatchFn: typeof updatePhotosBatch,
  applyFlipsRotationAndCrop: ApplyFlipsRotationAndCropFn,
  onProgress?: BatchProgressCallback,
  onPhase?: (label: string) => void,
  signal?: AbortSignal
): Promise<BatchSmartCropResult> {
  const {
    jobs,
    skippedPhotoIds,
    detectWorkerUsed,
    identityLoadModelMs,
    identityInferenceMs,
    matchedCount,
    neighborFilledCount,
  } = await resolveBatchSmartCrops(
    indices,
    photos,
    recipe,
    referenceEmbeddings,
    onProgress,
    onPhase,
    signal
  );

  if (isBatchAborted(signal) || jobs.length === 0) {
    return {
      croppedCount: 0,
      skippedCount: skippedPhotoIds.length,
      skippedPhotoIds,
      workerUsed: detectWorkerUsed,
      cancelled: isBatchAborted(signal),
      identityLoadModelMs,
      identityInferenceMs,
      matchedCount,
      neighborFilledCount,
    };
  }

  onPhase?.('Cropping');
  onProgress?.(0, jobs.length);

  const bake = await runBatchCropEach(
    jobs,
    photos,
    updatePhotosBatchFn,
    blobToFile,
    async (index, crop, rotation) => {
      const photo = photos.value[index];
      if (!photo?.id) return;
      const command = new CropCommand(
        photo.id,
        crop,
        rotation,
        photos,
        updatePhoto,
        applyFlipsRotationAndCrop
      );
      await command.execute();
    },
    onProgress,
    signal
  );

  return {
    croppedCount: jobs.length,
    skippedCount: skippedPhotoIds.length,
    skippedPhotoIds,
    workerUsed: detectWorkerUsed || bake.workerUsed,
    cancelled: bake.cancelled,
    identityLoadModelMs,
    identityInferenceMs,
    matchedCount,
    neighborFilledCount,
  };
}
