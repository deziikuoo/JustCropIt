/**
 * Paste Settings Command
 * Command for pasting settings (flips, crop, rotation) to multiple photos
 */

import type { Ref } from "vue";
import { BaseCommand, type Photo, type ApplyFlipsRotationAndCropFn } from "./BaseCommand";
import type { PhotoState } from "../types";
import { updatePhoto } from "../../photoStorage";
import type { BatchProgressCallback } from "../../batchEditProgress";
import { isBatchAborted } from "../../batchEditProgress";

export interface CopiedSettings {
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
}

export class PasteSettingsCommand extends BaseCommand {
  private photoIds: string[];
  private settings: CopiedSettings;
  private previousStates: Map<string, PhotoState> = new Map();
  private onProgress?: BatchProgressCallback;
  private signal?: AbortSignal;

  constructor(
    photoIds: string[],
    settings: CopiedSettings,
    photos: Ref<Photo[]>,
    updatePhotoFn: typeof updatePhoto,
    applyFlipsRotationAndCropFn: ApplyFlipsRotationAndCropFn,
    onProgress?: BatchProgressCallback,
    signal?: AbortSignal
  ) {
    super(photos, updatePhotoFn, applyFlipsRotationAndCropFn);
    this.photoIds = [...photoIds];
    this.settings = { ...settings };
    this.onProgress = onProgress;
    this.signal = signal;
  }

  async execute(): Promise<void> {
    // Capture previous states for all photos
    this.previousStates.clear();
    for (const photoId of this.photoIds) {
      const photo = this.findPhotoById(photoId);
      if (!photo) {
        throw new Error(`Photo with ID ${photoId} not found`);
      }
      if (!photo.id) {
        throw new Error(`Photo with ID ${photoId} must have an ID to paste settings`);
      }
      this.previousStates.set(photoId, this.capturePhotoState(photo));
    }

    const total = this.photoIds.length;
    this.onProgress?.(0, total);
    let completed = 0;

    // Apply settings to all photos
    for (const photoId of this.photoIds) {
      if (isBatchAborted(this.signal)) {
        break;
      }

      const photo = this.findPhotoById(photoId);
      if (!photo || !photo.id) {
        completed += 1;
        this.onProgress?.(completed, total);
        continue;
      }

      const pastedHasGeometry =
        Boolean(this.settings.crop) || Boolean(this.settings.rotation);

      // Flip-only paste onto deferred photos: metadata + CSS, no re-encode
      if (!pastedHasGeometry && this.canUseDeferredFlipPath(photo)) {
        await this.updateFlipsMetadataOnly(photoId, {
          flips: { ...this.settings.flips },
          crop: undefined,
          rotation: undefined,
        });
        completed += 1;
        this.onProgress?.(completed, total);
        continue;
      }

      // Create new state with pasted settings
      const newState: PhotoState = {
        flips: { ...this.settings.flips },
        crop: this.settings.crop ? { ...this.settings.crop } : undefined,
        rotation: this.settings.rotation,
      };

      // If crop is not provided in settings, keep existing crop or use full image
      if (!newState.crop) {
        newState.crop = photo.crop;
        if (!newState.crop) {
          // Use full image dimensions if no crop
          const img = new Image();
          img.src = URL.createObjectURL(photo.original);
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });
          newState.crop = {
            x: 0,
            y: 0,
            width: img.naturalWidth,
            height: img.naturalHeight,
          };
          URL.revokeObjectURL(img.src);
        }
      }

      // Regenerate photo from original + new state
      const newCurrent = await this.regeneratePhotoFromState(photo, newState);

      // Update photo
      await this.updatePhotoState(photoId, newCurrent, newState);
      completed += 1;
      this.onProgress?.(completed, total);
    }

    if (!isBatchAborted(this.signal)) {
      this.onProgress?.(total, total);
    }
  }

  async undo(): Promise<void> {
    // Restore previous states for all photos
    for (const photoId of this.photoIds) {
      const previousState = this.previousStates.get(photoId);
      if (!previousState) {
        continue; // Skip if no previous state (should not happen)
      }

      const photo = this.findPhotoById(photoId);
      if (!photo || !photo.id) {
        continue; // Skip if photo not found
      }

      if (this.canUseDeferredFlipPath(photo, previousState)) {
        await this.updateFlipsMetadataOnly(photoId, previousState);
        continue;
      }

      // Regenerate photo from original + previous state
      const newCurrent = await this.regeneratePhotoFromState(photo, previousState);

      // Update photo
      await this.updatePhotoState(photoId, newCurrent, previousState);
    }
  }

  validate(): boolean {
    // All photos must exist and have IDs
    for (const photoId of this.photoIds) {
      const photo = this.findPhotoById(photoId);
      if (!photo || !photo.id) {
        return false;
      }
    }
    return this.photoIds.length > 0;
  }

  getAffectedPhotoIds(): string[] {
    return [...this.photoIds];
  }

  getDescription(): string {
    return `Paste settings to ${this.photoIds.length} photo(s)`;
  }

  captureState(): Map<string, PhotoState> {
    const states = new Map<string, PhotoState>();
    for (const photoId of this.photoIds) {
      const photo = this.findPhotoById(photoId);
      if (photo) {
        states.set(photoId, this.capturePhotoState(photo));
      }
    }
    return states;
  }
}
