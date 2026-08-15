import type { Ref } from 'vue';
import {
  BaseCommand,
  type ApplyFlipsRotationAndCropFn,
  type Photo,
} from './BaseCommand';
import type { PhotoState } from '../types';
import {
  updatePhoto,
  updatePhotosBatch,
  updatePhotosMetadataBatch,
} from '../../photoStorage';
import { runBatchFlip } from '../../batchImageOps';
import { blobToFile } from '../../blobToFile';
import { usesDeferredFlips } from '../../editTransform';
import type { BatchProgressCallback } from '../../batchEditProgress';
import { isBatchAborted } from '../../batchEditProgress';

type BlobToFileFn = typeof blobToFile;

export class BatchFlipCommand extends BaseCommand {
  private indices: number[];
  private direction: 'horizontal' | 'vertical';
  private previousStates: Map<string, PhotoState> = new Map();
  private updatePhotosBatchFn: typeof updatePhotosBatch;
  private blobToFileFn: BlobToFileFn;
  private onProgress?: BatchProgressCallback;
  private signal?: AbortSignal;

  constructor(
    indices: number[],
    direction: 'horizontal' | 'vertical',
    photos: Ref<Photo[]>,
    updatePhotoFn: typeof updatePhoto,
    updatePhotosBatchFn: typeof updatePhotosBatch,
    applyFlipsRotationAndCropFn: ApplyFlipsRotationAndCropFn,
    blobToFileFn: BlobToFileFn,
    onProgress?: BatchProgressCallback,
    signal?: AbortSignal
  ) {
    super(photos, updatePhotoFn, applyFlipsRotationAndCropFn);
    this.indices = [...indices];
    this.direction = direction;
    this.updatePhotosBatchFn = updatePhotosBatchFn;
    this.blobToFileFn = blobToFileFn;
    this.onProgress = onProgress;
    this.signal = signal;
  }

  private capturePreviousStates(): void {
    this.previousStates.clear();
    for (const index of this.indices) {
      const photo = this.photos.value[index];
      if (photo?.id) {
        this.previousStates.set(photo.id, this.capturePhotoState(photo));
      }
    }
  }

  private async applyFlipToIndex(index: number): Promise<void> {
    const photo = this.photos.value[index];
    if (!photo?.id) return;

    const newFlips = {
      ...photo.flips,
      [this.direction]: !photo.flips[this.direction],
    };

    const newState: PhotoState = {
      flips: newFlips,
      crop: photo.crop,
      rotation: photo.rotation,
    };

    if (this.canUseDeferredFlipPath(photo)) {
      await this.updateFlipsMetadataOnly(photo.id, {
        flips: newFlips,
        crop: undefined,
        rotation: undefined,
      });
      return;
    }

    const newCurrent = await this.regeneratePhotoFromState(photo, newState);
    await this.updatePhotoState(photo.id, newCurrent, newState);
  }

  private async applyDeferredFlips(indices: number[]): Promise<void> {
    const metadataUpdates: Array<{
      id: string;
      metadata: {
        flips: { horizontal: boolean; vertical: boolean };
        crop?: { x: number; y: number; width: number; height: number };
        rotation?: number;
      };
    }> = [];

    for (const index of indices) {
      const photo = this.photos.value[index];
      if (!photo?.id) continue;

      const newFlips = {
        ...photo.flips,
        [this.direction]: !photo.flips[this.direction],
      };

      this.photos.value[index] = {
        ...photo,
        flips: newFlips,
        crop: undefined,
        rotation: undefined,
      };

      metadataUpdates.push({
        id: photo.id,
        metadata: {
          flips: newFlips,
          crop: undefined,
          rotation: undefined,
        },
      });
    }

    await updatePhotosMetadataBatch(metadataUpdates);
  }

  async execute(): Promise<void> {
    this.capturePreviousStates();

    const total = this.indices.length;
    this.onProgress?.(0, total);

    if (isBatchAborted(this.signal)) {
      this.onProgress?.(0, total);
      return;
    }

    const deferredIndices: number[] = [];
    const eagerIndices: number[] = [];

    for (const index of this.indices) {
      const photo = this.photos.value[index];
      if (!photo?.id) continue;
      if (usesDeferredFlips(photo)) {
        deferredIndices.push(index);
      } else {
        eagerIndices.push(index);
      }
    }

    if (deferredIndices.length > 0) {
      if (isBatchAborted(this.signal)) {
        this.onProgress?.(0, total);
        return;
      }
      await this.applyDeferredFlips(deferredIndices);
      this.onProgress?.(deferredIndices.length, total);
    }

    if (eagerIndices.length > 0 && !isBatchAborted(this.signal)) {
      const deferredDone = deferredIndices.length;
      await runBatchFlip(
        eagerIndices,
        this.direction,
        this.photos,
        this.updatePhotosBatchFn,
        this.blobToFileFn,
        (index) => this.applyFlipToIndex(index),
        (completed) => this.onProgress?.(deferredDone + completed, total),
        this.signal
      );
    }

    this.onProgress?.(
      isBatchAborted(this.signal)
        ? Math.min(total, deferredIndices.length)
        : total,
      total
    );
  }

  async undo(): Promise<void> {
    for (const photoId of this.getAffectedPhotoIds()) {
      const previousState = this.previousStates.get(photoId);
      if (!previousState) continue;

      const photo = this.findPhotoById(photoId);
      if (!photo?.id) continue;

      if (this.canUseDeferredFlipPath(photo, previousState)) {
        await this.updateFlipsMetadataOnly(photoId, previousState);
        continue;
      }

      const newCurrent = await this.regeneratePhotoFromState(
        photo,
        previousState
      );
      await this.updatePhotoState(photoId, newCurrent, previousState);
    }
  }

  validate(): boolean {
    return (
      this.indices.length > 0 &&
      this.indices.every((index) => {
        const photo = this.photos.value[index];
        return photo?.id !== undefined;
      })
    );
  }

  getAffectedPhotoIds(): string[] {
    return this.indices
      .map((index) => this.photos.value[index]?.id)
      .filter((id): id is string => !!id);
  }

  getDescription(): string {
    const label = this.direction === 'horizontal' ? 'horizontal' : 'vertical';
    return `Flip ${label} (${this.indices.length} photo${this.indices.length === 1 ? '' : 's'})`;
  }

  captureState(): Map<string, PhotoState> {
    const states = new Map<string, PhotoState>();
    for (const photoId of this.getAffectedPhotoIds()) {
      const photo = this.findPhotoById(photoId);
      if (photo) {
        states.set(photoId, this.capturePhotoState(photo));
      }
    }
    return states;
  }
}
