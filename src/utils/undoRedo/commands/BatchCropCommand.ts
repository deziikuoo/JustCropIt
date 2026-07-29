import type { Ref } from 'vue';
import {
  BaseCommand,
  type ApplyFlipsRotationAndCropFn,
  type Photo,
} from './BaseCommand';
import type { PhotoState } from '../types';
import { updatePhoto, updatePhotosBatch } from '../../photoStorage';
import { runBatchCropRemaining } from '../../batchImageOps';
import { blobToFile } from '../../blobToFile';
import { CropCommand } from './CropCommand';

type BlobToFileFn = typeof blobToFile;
type BlobFromFileFn = (file: File) => Promise<Blob>;

export class BatchCropCommand extends BaseCommand {
  private indices: number[];
  private crop: { x: number; y: number; width: number; height: number };
  private rotation: number;
  private previousStates: Map<string, PhotoState> = new Map();
  private updatePhotosBatchFn: typeof updatePhotosBatch;
  private blobToFileFn: BlobToFileFn;
  private blobFromFileFn: BlobFromFileFn;

  constructor(
    indices: number[],
    crop: { x: number; y: number; width: number; height: number },
    rotation: number,
    photos: Ref<Photo[]>,
    updatePhotoFn: typeof updatePhoto,
    updatePhotosBatchFn: typeof updatePhotosBatch,
    applyFlipsRotationAndCropFn: ApplyFlipsRotationAndCropFn,
    blobToFileFn: BlobToFileFn,
    blobFromFileFn: BlobFromFileFn
  ) {
    super(photos, updatePhotoFn, applyFlipsRotationAndCropFn);
    this.indices = [...indices];
    this.crop = { ...crop };
    this.rotation = rotation;
    this.updatePhotosBatchFn = updatePhotosBatchFn;
    this.blobToFileFn = blobToFileFn;
    this.blobFromFileFn = blobFromFileFn;
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

  private async applyCropToIndex(index: number): Promise<void> {
    const photo = this.photos.value[index];
    if (!photo?.id) return;

    const command = new CropCommand(
      photo.id,
      this.crop,
      this.rotation,
      this.photos,
      this.updatePhotoFn,
      this.applyFlipsRotationAndCropFn
    );

    await command.execute();
  }

  async execute(): Promise<void> {
    this.capturePreviousStates();

    await runBatchCropRemaining(
      this.indices,
      this.crop,
      this.rotation,
      this.photos,
      this.updatePhotosBatchFn,
      this.blobToFileFn,
      this.blobFromFileFn,
      (index) => this.applyCropToIndex(index)
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
    return `Cropped ${this.indices.length} photo${this.indices.length === 1 ? '' : 's'}`;
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
