import type { Ref } from 'vue';
import {
  BaseCommand,
  type ApplyFlipsRotationAndCropFn,
  type Photo,
} from './BaseCommand';
import type { PhotoState } from '../types';
import { updatePhoto, updatePhotosBatch } from '../../photoStorage';
import type { BatchCropRecipe, BatchSmartCropResult } from '../../../types/batchCrop';
import { runBatchSmartCropPipeline } from '../../batchSmartCrop';
import type { BatchProgressCallback } from '../../batchEditProgress';

export class BatchFollowSubjectCommand extends BaseCommand {
  private indices: number[];
  private recipe: BatchCropRecipe;
  private referenceEmbeddings: Float32Array[] | null;
  private previousStates: Map<string, PhotoState> = new Map();
  private updatePhotosBatchFn: typeof updatePhotosBatch;
  private onProgress?: BatchProgressCallback;
  private onPhase?: (label: string) => void;
  private signal?: AbortSignal;
  result: BatchSmartCropResult | null = null;

  constructor(
    indices: number[],
    recipe: BatchCropRecipe,
    referenceEmbeddings: Float32Array[] | null,
    photos: Ref<Photo[]>,
    updatePhotoFn: typeof updatePhoto,
    updatePhotosBatchFn: typeof updatePhotosBatch,
    applyFlipsRotationAndCropFn: ApplyFlipsRotationAndCropFn,
    onProgress?: BatchProgressCallback,
    onPhase?: (label: string) => void,
    signal?: AbortSignal
  ) {
    super(photos, updatePhotoFn, applyFlipsRotationAndCropFn);
    this.indices = [...indices];
    this.recipe = {
      ...recipe,
      referenceFaces: recipe.referenceFaces
        ? recipe.referenceFaces.map((face) => ({
            ...face,
            bbox: { ...face.bbox },
            keypoints: face.keypoints,
          }))
        : undefined,
    };
    this.referenceEmbeddings = referenceEmbeddings;
    this.updatePhotosBatchFn = updatePhotosBatchFn;
    this.onProgress = onProgress;
    this.onPhase = onPhase;
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

  async execute(): Promise<void> {
    this.capturePreviousStates();
    this.result = await runBatchSmartCropPipeline(
      this.indices,
      this.photos,
      this.recipe,
      this.referenceEmbeddings,
      this.updatePhotosBatchFn,
      this.applyFlipsRotationAndCropFn,
      this.onProgress,
      this.onPhase,
      this.signal
    );
  }

  async undo(): Promise<void> {
    for (const photoId of this.getAffectedPhotoIds()) {
      const previousState = this.previousStates.get(photoId);
      if (!previousState) continue;
      const photo = this.findPhotoById(photoId);
      if (!photo?.id) continue;
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
      this.recipe.cropTarget != null &&
      this.indices.every((index) => this.photos.value[index]?.id !== undefined)
    );
  }

  getAffectedPhotoIds(): string[] {
    return this.indices
      .map((index) => this.photos.value[index]?.id)
      .filter((id): id is string => !!id);
  }

  getDescription(): string {
    const label =
      this.recipe.mode === 'this-person' ? 'Identity crop' : 'Follow subject';
    return `${label} (${this.indices.length} photos)`;
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
