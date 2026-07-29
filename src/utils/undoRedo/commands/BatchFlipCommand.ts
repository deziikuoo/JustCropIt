import type { Ref } from 'vue';
import {
  BaseCommand,
  type ApplyFlipsRotationAndCropFn,
  type Photo,
} from './BaseCommand';
import type { PhotoState } from '../types';
import { updatePhoto, updatePhotosBatch } from '../../photoStorage';
import { runBatchFlip } from '../../batchImageOps';
import { blobToFile } from '../../blobToFile';
type BlobToFileFn = typeof blobToFile;

export class BatchFlipCommand extends BaseCommand {
  private indices: number[];
  private direction: 'horizontal' | 'vertical';
  private previousStates: Map<string, PhotoState> = new Map();
  private updatePhotosBatchFn: typeof updatePhotosBatch;
  private blobToFileFn: BlobToFileFn;

  constructor(
    indices: number[],
    direction: 'horizontal' | 'vertical',
    photos: Ref<Photo[]>,
    updatePhotoFn: typeof updatePhoto,
    updatePhotosBatchFn: typeof updatePhotosBatch,
    applyFlipsRotationAndCropFn: ApplyFlipsRotationAndCropFn,
    blobToFileFn: BlobToFileFn
  ) {
    super(photos, updatePhotoFn, applyFlipsRotationAndCropFn);
    this.indices = [...indices];
    this.direction = direction;
    this.updatePhotosBatchFn = updatePhotosBatchFn;
    this.blobToFileFn = blobToFileFn;
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

    const newCurrent = await this.regeneratePhotoFromState(photo, newState);
    await this.updatePhotoState(photo.id, newCurrent, newState);
  }

  async execute(): Promise<void> {
    this.capturePreviousStates();

    await runBatchFlip(
      this.indices,
      this.direction,
      this.photos,
      this.updatePhotosBatchFn,
      this.blobToFileFn,
      (index) => this.applyFlipToIndex(index)
    );
  }

  async undo(): Promise<void> {
    for (const photoId of this.getAffectedPhotoIds()) {
      const previousState = this.previousStates.get(photoId);
      if (!previousState) continue;

      const photo = this.findPhotoById(photoId);
      if (!photo?.id) continue;

      const newCurrent = await this.regeneratePhotoFromState(photo, previousState);
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
