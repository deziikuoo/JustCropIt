/**
 * Crop Command
 * Command for cropping and rotating photos
 */

import type { Ref } from "vue";
import { BaseCommand, type Photo, type ApplyFlipsRotationAndCropFn } from "./BaseCommand";
import type { PhotoState } from "../types";
import { updatePhoto } from "../../photoStorage";

export class CropCommand extends BaseCommand {
  private photoId: string;
  private newCrop: { x: number; y: number; width: number; height: number };
  private newRotation: number;
  private previousState: PhotoState | null = null;
  private bakedBlob: Blob | null;

  constructor(
    photoId: string,
    crop: { x: number; y: number; width: number; height: number },
    rotation: number,
    photos: Ref<Photo[]>,
    updatePhotoFn: typeof updatePhoto,
    applyFlipsRotationAndCropFn: ApplyFlipsRotationAndCropFn,
    bakedBlob?: Blob | null
  ) {
    super(photos, updatePhotoFn, applyFlipsRotationAndCropFn);
    this.photoId = photoId;
    this.newCrop = { ...crop };
    this.newRotation = rotation;
    this.bakedBlob = bakedBlob ?? null;
  }

  async execute(): Promise<void> {
    const photo = this.findPhotoById(this.photoId);
    if (!photo) {
      throw new Error(`Photo with ID ${this.photoId} not found`);
    }
    if (!photo.id) {
      throw new Error("Photo must have an ID to crop");
    }

    // Capture previous state
    this.previousState = this.capturePhotoState(photo);

    // Create new state with updated crop and rotation
    const newState: PhotoState = {
      flips: { ...photo.flips },
      crop: { ...this.newCrop },
      rotation: this.newRotation,
    };

    const newCurrent = this.bakedBlob
      ? new File([this.bakedBlob], photo.original.name, {
          type: this.bakedBlob.type || photo.original.type,
        })
      : await this.regeneratePhotoFromState(photo, newState);

    // Update photo
    await this.updatePhotoState(this.photoId, newCurrent, newState);
  }

  async undo(): Promise<void> {
    if (!this.previousState) {
      throw new Error("Cannot undo: no previous state");
    }

    const photo = this.findPhotoById(this.photoId);
    if (!photo) {
      throw new Error(`Photo with ID ${this.photoId} not found`);
    }
    if (!photo.id) {
      throw new Error("Photo must have an ID to undo crop");
    }

    // Regenerate photo from original + previous state
    const newCurrent = await this.regeneratePhotoFromState(
      photo,
      this.previousState
    );

    // Update photo
    await this.updatePhotoState(this.photoId, newCurrent, this.previousState);
  }

  validate(): boolean {
    const photo = this.findPhotoById(this.photoId);
    return photo !== undefined && photo.id !== undefined;
  }

  getAffectedPhotoIds(): string[] {
    return [this.photoId];
  }

  getDescription(): string {
    return "Crop and rotate";
  }

  captureState(): PhotoState {
    const photo = this.findPhotoById(this.photoId);
    if (!photo) {
      throw new Error(`Photo with ID ${this.photoId} not found`);
    }
    return this.capturePhotoState(photo);
  }
}
