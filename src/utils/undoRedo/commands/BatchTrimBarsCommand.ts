import type { Ref } from 'vue';
import {
  BaseCommand,
  type ApplyFlipsRotationAndCropFn,
  type Photo,
} from './BaseCommand';
import type { PhotoState } from '../types';
import { updatePhoto, updatePhotosBatch } from '../../photoStorage';
import type { BatchTrimBarsResult } from '../../../types/batchCrop';
import { runBatchTrimBarsPipeline } from '../../batchTrimBars';
import type { BatchProgressCallback } from '../../batchEditProgress';

export class BatchTrimBarsCommand extends BaseCommand {
  private indices: number[];
  private previousStates: Map<string, PhotoState> = new Map();
  private updatePhotosBatchFn: typeof updatePhotosBatch;
  private onProgress?: BatchProgressCallback;
  private onPhase?: (label: string) => void;
  private signal?: AbortSignal;
  result: BatchTrimBarsResult | null = null;

  constructor(
    indices: number[],
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
    this.result = await runBatchTrimBarsPipeline(
      this.indices,
      this.photos,
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
      this.indices.every((index) => this.photos.value[index]?.id !== undefined)
    );
  }

  getAffectedPhotoIds(): string[] {
    return this.indices
      .map((index) => this.photos.value[index]?.id)
      .filter((id): id is string => !!id);
  }

  getDescription(): string {
    return `Remove Letterboxing (${this.indices.length} photos)`;
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
