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

    this.previousState = this.capturePhotoState(photo);

    const newFlips = {
      ...photo.flips,
      [this.direction]: !photo.flips[this.direction],
    };

    // Deferred path: metadata + CSS only (no re-encode / thumb regen)
    if (this.canUseDeferredFlipPath(photo)) {
      await this.updateFlipsMetadataOnly(this.photoId, {
        flips: newFlips,
        crop: undefined,
        rotation: undefined,
      });
      return;
    }

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

    const newState: PhotoState = {
      flips: newFlips,
      crop,
      rotation,
    };

    const newCurrent = await this.regeneratePhotoFromState(photo, newState);
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

    if (this.canUseDeferredFlipPath(photo, this.previousState)) {
      await this.updateFlipsMetadataOnly(this.photoId, this.previousState);
      return;
    }

    const newCurrent = await this.regeneratePhotoFromState(
      photo,
      this.previousState
    );

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
