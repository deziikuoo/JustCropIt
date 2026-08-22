/**
 * Per-photo letterbox / pillarbox trim for batch crop.
 */

import type { Ref } from 'vue';
import type { Photo } from '../types/photo';
import type { BatchTrimBarsResult } from '../types/batchCrop';
import { getLetterboxDetectConcurrency } from '../constants/optimization';
import { isBatchAborted, type BatchProgressCallback } from './batchEditProgress';
import { detectLetterboxFromBlob } from './letterboxDetect';
import { runBatchCropEach, type PhotoCropJob } from './batchImageOps';
import { blobToFile } from './blobToFile';
import { updatePhoto, updatePhotosBatch } from './photoStorage';
import type { ApplyFlipsRotationAndCropFn } from './undoRedo/commands/BaseCommand';
import { CropCommand } from './undoRedo/commands/CropCommand';
import { mapWithConcurrency } from './concurrency';

export async function resolveTrimBarCrops(
  indices: number[],
  photos: Ref<Photo[]>,
  onProgress?: BatchProgressCallback,
  signal?: AbortSignal
): Promise<{ jobs: PhotoCropJob[]; skippedPhotoIds: string[] }> {
  const jobs: PhotoCropJob[] = [];
  const skippedPhotoIds: string[] = [];
  const total = indices.length;
  let completed = 0;

  await mapWithConcurrency(
    indices,
    getLetterboxDetectConcurrency(),
    async (index) => {
      if (isBatchAborted(signal)) return;
      const photo = photos.value[index];
      if (!photo?.id) {
        completed += 1;
        onProgress?.(completed, total);
        return;
      }

      try {
        const bounds = await detectLetterboxFromBlob(photo.original);
        if (isBatchAborted(signal)) return;
        if (!bounds) {
          skippedPhotoIds.push(photo.id);
        } else {
          jobs.push({
            index,
            crop: {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            },
            rotation: photo.rotation ?? 0,
          });
        }
      } catch (error) {
        console.error('[TrimBars] detect failed', { photoId: photo.id, error });
        skippedPhotoIds.push(photo.id);
      } finally {
        completed += 1;
        onProgress?.(completed, total);
      }
    }
  );

  jobs.sort((a, b) => a.index - b.index);
  return { jobs, skippedPhotoIds };
}

export async function runBatchTrimBarsPipeline(
  indices: number[],
  photos: Ref<Photo[]>,
  updatePhotosBatchFn: typeof updatePhotosBatch,
  applyFlipsRotationAndCrop: ApplyFlipsRotationAndCropFn,
  onProgress?: BatchProgressCallback,
  onPhase?: (label: string) => void,
  signal?: AbortSignal
): Promise<BatchTrimBarsResult> {
  onPhase?.('Finding black bars');
  onProgress?.(0, indices.length);

  const { jobs, skippedPhotoIds } = await resolveTrimBarCrops(
    indices,
    photos,
    onProgress,
    signal
  );

  if (isBatchAborted(signal) || jobs.length === 0) {
    return {
      croppedCount: 0,
      skippedCount: skippedPhotoIds.length,
      skippedPhotoIds,
      cancelled: isBatchAborted(signal),
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
    cancelled: bake.cancelled,
  };
}
