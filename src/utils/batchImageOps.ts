/**
 * Batch Image Operations Helpers
 * 
 * Per-operation helpers that dynamically choose between Web Workers and the main thread.
 * Used by App.vue handlers to keep logic clean and avoid redundant wrappers.
 */

import { type Ref } from 'vue';
import { imageWorkerPool } from './imageWorkerPool';
import { processInChunks } from './scheduler';
import { MAIN_THREAD_CHUNK_SIZE } from '../constants/optimization';
import type { FlipParams, CropParams, PasteParams, WorkerRequest } from '../types/worker';
import type { Photo } from '../types/photo';
import { applyDisplayInvalidation } from './thumbnailInvalidation';
import type { BatchProgressCallback } from './batchEditProgress';
import { isBatchAborted } from './batchEditProgress';
import { forEachWithConcurrency } from './concurrency';

export type { Photo };

interface CopiedSettings {
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
}

// Function types for dependencies injected from App.vue
type UpdatePhotosBatchFn = (
  updates: Array<{
    id: string;
    current: File;
    metadata: {
      flips: { horizontal: boolean; vertical: boolean };
      crop?: { x: number; y: number; width: number; height: number };
      rotation?: number;
    };
  }>
) => Promise<void>;

type BlobToFileFn = (blob: Blob, fileName: string, mimeType: string) => File;
type HandleFlipFn = (index: number, direction: "horizontal" | "vertical") => Promise<void>;
type FallbackFn = (index: number) => Promise<void>;

/**
 * Run batch flip operation, using workers if supported and beneficial.
 */
export async function runBatchFlip(
  indices: number[],
  direction: 'horizontal' | 'vertical',
  photos: Ref<Photo[]>,
  updatePhotosBatch: UpdatePhotosBatchFn,
  blobToFile: BlobToFileFn,
  mainThreadFallback: HandleFlipFn,
  onProgress?: BatchProgressCallback,
  signal?: AbortSignal
): Promise<{ workerUsed: boolean; cancelled: boolean }> {
  const total = indices.length;
  let completed = 0;
  const report = () => {
    completed += 1;
    onProgress?.(completed, total);
  };

  if (imageWorkerPool.shouldUseWorkers(indices.length)) {
    console.log(`[BatchFlip] Using Web Workers for ${indices.length} images`);
    
    const batchUpdates: Array<{
      id: string;
      current: File;
      metadata: {
        flips: { horizontal: boolean; vertical: boolean };
        crop?: { x: number; y: number; width: number; height: number };
        rotation?: number;
      };
    }> = [];

    await forEachWithConcurrency(indices, imageWorkerPool.getPoolSize(), async (index) => {
      if (isBatchAborted(signal)) {
        report();
        return;
      }

      const photo = photos.value[index];
      // Use current image for flip (incremental)
      const buffer = await photo.current.arrayBuffer();
      if (isBatchAborted(signal)) {
        report();
        return;
      }

      const params: FlipParams = { direction };
      
      const request: WorkerRequest = {
        id: `flip-${photo.id || index}-${Date.now()}`,
        type: 'flip',
        imageData: buffer,
        mimeType: photo.current.type,
        params
      };

      try {
        const response = await imageWorkerPool.submitTask(request, [buffer]);
        if (isBatchAborted(signal)) {
          return;
        }
        
        if (response.success && response.result) {
          const newFile = blobToFile(
            new Blob([response.result], { type: photo.current.type }),
            photo.current.name,
            photo.current.type
          );

          const newFlips = {
            ...photo.flips,
            [direction]: !photo.flips[direction]
          };
          
          photos.value[index] = applyDisplayInvalidation(photo, {
            current: newFile,
            flips: newFlips,
          });

          if (photo.id) {
            batchUpdates.push({
              id: photo.id,
              current: newFile,
              metadata: {
                flips: newFlips,
                crop: photo.crop,
                rotation: photo.rotation
              }
            });
          }
        } else {
          throw new Error(response.error || 'Worker returned failure');
        }
      } catch (err) {
        if (isBatchAborted(signal)) {
          return;
        }
        console.error(`[BatchFlip] Worker failed for index ${index}, falling back to main thread`, err);
        await mainThreadFallback(index, direction);
      } finally {
        report();
      }
    });

    if (!isBatchAborted(signal) && batchUpdates.length > 0) {
      await updatePhotosBatch(batchUpdates);
    }

    return { workerUsed: true, cancelled: isBatchAborted(signal) };
  } else {
    console.log(`[BatchFlip] Using Main Thread for ${indices.length} images`);
    await processInChunks(
      indices,
      async (index) => {
        if (isBatchAborted(signal)) return;
        await mainThreadFallback(index, direction);
        report();
      },
      MAIN_THREAD_CHUNK_SIZE
    );
    return { workerUsed: false, cancelled: isBatchAborted(signal) };
  }
}

/**
 * Run batch crop operation on remaining images.
 */
export async function runBatchCropRemaining(
  indices: number[],
  crop: { x: number; y: number; width: number; height: number },
  rotation: number,
  photos: Ref<Photo[]>,
  updatePhotosBatch: UpdatePhotosBatchFn,
  blobToFile: BlobToFileFn,
  mainThreadFallback: FallbackFn,
  onProgress?: BatchProgressCallback,
  signal?: AbortSignal
): Promise<{ workerUsed: boolean; cancelled: boolean }> {
  const total = indices.length;
  let completed = 0;
  const report = () => {
    completed += 1;
    onProgress?.(completed, total);
  };

  if (imageWorkerPool.shouldUseWorkers(indices.length)) {
    console.log(`[BatchCrop] Using Web Workers for ${indices.length} images`);

    const batchUpdates: Array<{
      id: string;
      current: File;
      metadata: {
        flips: { horizontal: boolean; vertical: boolean };
        crop?: { x: number; y: number; width: number; height: number };
        rotation?: number;
      };
    }> = [];

    await forEachWithConcurrency(indices, imageWorkerPool.getPoolSize(), async (index) => {
      if (isBatchAborted(signal)) {
        report();
        return;
      }

      const photo = photos.value[index];
      const buffer = await photo.original.arrayBuffer();
      if (isBatchAborted(signal)) {
        report();
        return;
      }

      const params: CropParams = { crop, rotation };

      const request: WorkerRequest = {
        id: `crop-${photo.id || index}-${Date.now()}`,
        type: 'crop',
        imageData: buffer,
        mimeType: photo.current.type,
        params
      };

      try {
        const response = await imageWorkerPool.submitTask(request, [buffer]);
        if (isBatchAborted(signal)) {
          return;
        }

        if (response.success && response.result) {
          const newFile = blobToFile(
            new Blob([response.result], { type: photo.current.type }),
            photo.current.name,
            photo.current.type
          );

          photos.value[index] = applyDisplayInvalidation(photo, {
            current: newFile,
            crop: { ...crop },
            rotation,
          });

          if (photo.id) {
            batchUpdates.push({
              id: photo.id,
              current: newFile,
              metadata: {
                flips: photo.flips,
                crop: { ...crop },
                rotation
              }
            });
          }
        } else {
          throw new Error(response.error || 'Worker returned failure');
        }
      } catch (err) {
        if (isBatchAborted(signal)) {
          return;
        }
        console.error(`[BatchCrop] Worker failed for index ${index}`, err);
        await mainThreadFallback(index);
      } finally {
        report();
      }
    });

    if (!isBatchAborted(signal) && batchUpdates.length > 0) {
      await updatePhotosBatch(batchUpdates);
    }

    return { workerUsed: true, cancelled: isBatchAborted(signal) };
  } else {
    console.log(`[BatchCrop] Using Main Thread for ${indices.length} images`);
    await processInChunks(
      indices,
      async (index) => {
        if (isBatchAborted(signal)) return;
        await mainThreadFallback(index);
        report();
      },
      MAIN_THREAD_CHUNK_SIZE
    );
    return { workerUsed: false, cancelled: isBatchAborted(signal) };
  }
}

/**
 * Run batch paste settings operation.
 */
export async function runBatchPaste(
  indicesToPaste: number[],
  settings: CopiedSettings,
  photos: Ref<Photo[]>,
  updatePhotosBatch: UpdatePhotosBatchFn,
  blobToFile: BlobToFileFn,
  mainThreadFallback: FallbackFn
): Promise<{ workerUsed: boolean }> {

  if (imageWorkerPool.shouldUseWorkers(indicesToPaste.length)) {
    console.log(`[BatchPaste] Using Web Workers for ${indicesToPaste.length} images`);

    const batchUpdates: Array<{
      id: string;
      current: File;
      metadata: {
        flips: { horizontal: boolean; vertical: boolean };
        crop?: { x: number; y: number; width: number; height: number };
        rotation?: number;
      };
    }> = [];

    await forEachWithConcurrency(indicesToPaste, imageWorkerPool.getPoolSize(), async (index) => {
      const photo = photos.value[index];
      
      // Check crop logic (same as original file)
      if (!settings.crop) {
        await mainThreadFallback(index);
        return;
      }

      // Crop is present, proceed with worker
      const buffer = await photo.original.arrayBuffer();
      const params: PasteParams = {
        flips: settings.flips,
        crop: settings.crop,
        rotation: settings.rotation
      };

      const request: WorkerRequest = {
        id: `paste-${photo.id || index}-${Date.now()}`,
        type: 'paste',
        imageData: buffer,
        mimeType: photo.current.type,
        params
      };

      try {
        const response = await imageWorkerPool.submitTask(request, [buffer]);

        if (response.success && response.result) {
          const newFile = blobToFile(
            new Blob([response.result], { type: photo.current.type }),
            photo.current.name,
            photo.current.type
          );

          photos.value[index] = applyDisplayInvalidation(photo, {
            current: newFile,
            flips: { ...settings.flips },
            crop: { ...settings.crop! },
            rotation: settings.rotation,
          });

          if (photo.id) {
            batchUpdates.push({
              id: photo.id,
              current: newFile,
              metadata: {
                flips: settings.flips,
                crop: settings.crop,
                rotation: settings.rotation
              }
            });
          }
        } else {
          throw new Error(response.error || 'Worker returned failure');
        }
      } catch (err) {
        console.error(`[BatchPaste] Worker failed for index ${index}`, err);
        await mainThreadFallback(index);
      }
    });

    if (batchUpdates.length > 0) {
      await updatePhotosBatch(batchUpdates);
    }

    return { workerUsed: true };
  } else {
    console.log(`[BatchPaste] Using Main Thread for ${indicesToPaste.length} images`);
    await processInChunks(
      indicesToPaste,
      (index) => mainThreadFallback(index),
      MAIN_THREAD_CHUNK_SIZE
    );
    return { workerUsed: false };
  }
}
