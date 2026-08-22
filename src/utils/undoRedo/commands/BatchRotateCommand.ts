import type { Ref } from "vue";
import {
  BaseCommand,
  type ApplyFlipsRotationAndCropFn,
  type Photo,
} from "./BaseCommand";
import type { PhotoState } from "../types";
import { updatePhoto } from "../../photoStorage";
import { isBatchAborted, type BatchProgressCallback } from "../../batchEditProgress";

function normalizeRotation(degrees: number): number | undefined {
  const n = ((degrees % 360) + 360) % 360;
  return n === 0 ? undefined : n;
}

export class BatchRotateCommand extends BaseCommand {
  private indices: number[];
  private angle: 90 | -90;
  private previousStates: Map<string, PhotoState> = new Map();
  private onProgress?: BatchProgressCallback;
  private signal?: AbortSignal;

  constructor(
    indices: number[],
    angle: 90 | -90,
    photos: Ref<Photo[]>,
    updatePhotoFn: typeof updatePhoto,
    applyFlipsRotationAndCropFn: ApplyFlipsRotationAndCropFn,
    onProgress?: BatchProgressCallback,
    signal?: AbortSignal
  ) {
    super(photos, updatePhotoFn, applyFlipsRotationAndCropFn);
    this.indices = [...indices];
    this.angle = angle;
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

  private async applyRotateToIndex(index: number): Promise<void> {
    const photo = this.photos.value[index];
    if (!photo?.id) return;

    const newState: PhotoState = {
      flips: { ...photo.flips },
      crop: photo.crop ? { ...photo.crop } : undefined,
      rotation: normalizeRotation((photo.rotation || 0) + this.angle),
    };

    const newCurrent = await this.regeneratePhotoFromState(photo, newState);
    await this.updatePhotoState(photo.id, newCurrent, newState);
  }

  async execute(): Promise<void> {
    this.capturePreviousStates();

    const total = this.indices.length;
    this.onProgress?.(0, total);

    let completed = 0;
    for (const index of this.indices) {
      if (isBatchAborted(this.signal)) break;
      await this.applyRotateToIndex(index);
      completed += 1;
      this.onProgress?.(completed, total);
    }

    this.onProgress?.(isBatchAborted(this.signal) ? completed : total, total);
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
    const label = this.angle === -90 ? "left" : "right";
    return `Rotate ${label} (${this.indices.length} photo${this.indices.length === 1 ? "" : "s"})`;
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
