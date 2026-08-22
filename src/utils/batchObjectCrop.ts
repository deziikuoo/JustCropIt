/**
 * Per-photo crop-to-object for batch crop.
 */

import type { Ref } from 'vue';
import type { Photo } from '../types/photo';
import type { BatchObjectCropResult } from '../types/batchCrop';
import { getObjectCropDetectConcurrency } from '../constants/optimization';
import { isBatchAborted, type BatchProgressCallback } from './batchEditProgress';
import { detectObjectFromBlob } from './objectCrop';
import { runBatchCropEach, type PhotoCropJob } from './batchImageOps';
import { blobToFile } from './blobToFile';
import { updatePhoto, updatePhotosBatch } from './photoStorage';
import type { ApplyFlipsRotationAndCropFn } from './undoRedo/commands/BaseCommand';
import { CropCommand } from './undoRedo/commands/CropCommand';
import { mapWithConcurrency } from './concurrency';

export async function resolveObjectCrops(
  indices: number[],
  photos: Ref<Photo[]>,
  padPx: number,
  onProgress?: BatchProgressCallback,
  signal?: AbortSignal
): Promise<{ jobs: PhotoCropJob[]; skippedPhotoIds: string[] }> {
  const jobs: PhotoCropJob[] = [];
  const skippedPhotoIds: string[] = [];
  const total = indices.length;
  let completed = 0;

  await mapWithConcurrency(
    indices,
    getObjectCropDetectConcurrency(),
    async (index) => {
      if (isBatchAborted(signal)) return;
      const photo = photos.value[index];
      if (!photo?.id) {
        completed += 1;
        onProgress?.(completed, total);
        return;
      }

      try {
        const result = await detectObjectFromBlob(photo.original, {
          padPx,
          photoId: photo.id,
          autoSearch: false,
        });
        if (isBatchAborted(signal)) return;
        if (!result) {
          skippedPhotoIds.push(photo.id);
        } else {
          jobs.push({
            index,
            crop: {
              x: result.padded.x,
              y: result.padded.y,
              width: result.padded.width,
              height: result.padded.height,
            },
            rotation: photo.rotation ?? 0,
          });
        }
      } catch (error) {
        console.error('[ObjectCrop] detect failed', { photoId: photo.id, error });
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

export async function runBatchObjectCropPipeline(
  indices: number[],
  photos: Ref<Photo[]>,
  padPx: number,
  updatePhotosBatchFn: typeof updatePhotosBatch,
  applyFlipsRotationAndCrop: ApplyFlipsRotationAndCropFn,
  onProgress?: BatchProgressCallback,
  onPhase?: (label: string) => void,
  signal?: AbortSignal
): Promise<BatchObjectCropResult> {
  onPhase?.('Finding objects');
  onProgress?.(0, indices.length);

  const { jobs, skippedPhotoIds } = await resolveObjectCrops(
    indices,
    photos,
    padPx,
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
