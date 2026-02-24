/**
 * Flip Command
 * Command for flipping photos horizontally or vertically
 */

import type { Ref } from "vue";
import { BaseCommand, type Photo, type ApplyFlipsRotationAndCropFn } from "./BaseCommand";
import type { PhotoState } from "../types";
import { updatePhoto } from "../../photoStorage";

export class FlipCommand extends BaseCommand {
  private photoId: string;
  private direction: "horizontal" | "vertical";
  private previousState: PhotoState | null = null;

  constructor(
    photoId: string,
    direction: "horizontal" | "vertical",
    photos: Ref<Photo[]>,
    updatePhotoFn: typeof updatePhoto,
    applyFlipsRotationAndCropFn: ApplyFlipsRotationAndCropFn
  ) {
    super(photos, updatePhotoFn, applyFlipsRotationAndCropFn);
    this.photoId = photoId;
    this.direction = direction;
  }

  async execute(): Promise<void> {
    const photo = this.findPhotoById(this.photoId);
    if (!photo) {
      throw new Error(`Photo with ID ${this.photoId} not found`);
    }
    if (!photo.id) {
      throw new Error("Photo must have an ID to flip");
    }

    // Capture previous state
    this.previousState = this.capturePhotoState(photo);

    // Calculate new flips state
    const newFlips = {
      ...photo.flips,
      [this.direction]: !photo.flips[this.direction],
    };

    // Get current crop and rotation (or defaults)
    const img = new Image();
    img.src = URL.createObjectURL(photo.original);

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const crop = photo.crop || {
      x: 0,
      y: 0,
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
    const rotation = photo.rotation || 0;

    URL.revokeObjectURL(img.src);

    // Create new state
    const newState: PhotoState = {
      flips: newFlips,
      crop,
      rotation,
    };

    // Regenerate photo from original + new state
    const newCurrent = await this.regeneratePhotoFromState(photo, newState);

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
      throw new Error("Photo must have an ID to undo flip");
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
    return `Flip ${this.direction}`;
  }

  captureState(): PhotoState {
    const photo = this.findPhotoById(this.photoId);
    if (!photo) {
      throw new Error(`Photo with ID ${this.photoId} not found`);
    }
    return this.capturePhotoState(photo);
  }
}
