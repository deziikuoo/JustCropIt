/**
 * Base Command Class
 * Abstract base class providing common functionality for all commands
 */

import type { Ref } from "vue";
import type { Command, PhotoState } from "../types";
import type { Photo } from "../../../types/photo";
import { updatePhoto, updatePhotoMetadata } from "../../photoStorage";
import { applyDisplayInvalidation } from "../../thumbnailInvalidation";
import { usesDeferredFlips } from "../../editTransform";

export type { Photo };

/**
 * Function type for applying flips, rotation, and crop to an image
 */
export type ApplyFlipsRotationAndCropFn = (
  image: HTMLImageElement,
  flips: { horizontal: boolean; vertical: boolean },
  rotation: number,
  crop: { x: number; y: number; width: number; height: number },
  mimeType: string
) => Promise<Blob | null>;

/**
 * Abstract base class for all undo/redo commands
 */
export abstract class BaseCommand implements Command {
  protected photos: Ref<Photo[]>;
  protected updatePhotoFn: typeof updatePhoto;
  protected applyFlipsRotationAndCropFn: ApplyFlipsRotationAndCropFn;

  constructor(
    photos: Ref<Photo[]>,
    updatePhotoFn: typeof updatePhoto,
    applyFlipsRotationAndCropFn: ApplyFlipsRotationAndCropFn
  ) {
    this.photos = photos;
    this.updatePhotoFn = updatePhotoFn;
    this.applyFlipsRotationAndCropFn = applyFlipsRotationAndCropFn;
  }

  abstract execute(): Promise<void>;
  abstract undo(): Promise<void>;
  abstract validate(): boolean;
  abstract getAffectedPhotoIds(): string[];
  abstract getDescription(): string;

  /**
   * Find a photo by its ID
   */
  protected findPhotoById(photoId: string): Photo | undefined {
    return this.photos.value.find((p) => p.id === photoId);
  }

  /**
   * Find the index of a photo by its ID
   */
  protected findPhotoIndexById(photoId: string): number {
    return this.photos.value.findIndex((p) => p.id === photoId);
  }

  /**
   * Capture the current state of a photo
   */
  protected capturePhotoState(photo: Photo): PhotoState {
    return {
      flips: { ...photo.flips },
      crop: photo.crop ? { ...photo.crop } : undefined,
      rotation: photo.rotation,
    };
  }

  /**
   * Regenerate the current File from original + state
   */
  protected async regeneratePhotoFromState(
    photo: Photo,
    state: PhotoState
  ): Promise<File> {
    if (!photo.id) {
      throw new Error("Photo must have an ID to regenerate");
    }

    // Create image element from original
    const img = new Image();
    img.src = URL.createObjectURL(photo.original);

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    // Default values for crop if not present
    const crop = state.crop || {
      x: 0,
      y: 0,
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
    const rotation = state.rotation || 0;

    // Apply transformations
    const blob = await this.applyFlipsRotationAndCropFn(
      img,
      state.flips,
      rotation,
      crop,
      photo.original.type
    );

    // Cleanup
    URL.revokeObjectURL(img.src);

    if (!blob) {
      throw new Error("Failed to regenerate photo from state");
    }

    return new File([blob], photo.original.name, {
      type: photo.original.type,
    });
  }

  /**
   * Update photo in the photos array and persist to IndexedDB
   */
  protected async updatePhotoState(
    photoId: string,
    newCurrent: File,
    newState: PhotoState
  ): Promise<void> {
    const photoIndex = this.findPhotoIndexById(photoId);
    if (photoIndex === -1) {
      throw new Error(`Photo with ID ${photoId} not found`);
    }

    const photo = this.photos.value[photoIndex];
    if (!photo.id) {
      throw new Error("Photo must have an ID to update");
    }

    // Update in-memory photo
    this.photos.value[photoIndex] = applyDisplayInvalidation(photo, {
      current: newCurrent,
      flips: newState.flips,
      crop: newState.crop,
      rotation: newState.rotation,
    });

    // Persist to IndexedDB
    try {
      await this.updatePhotoFn(photo.id, newCurrent, {
        flips: newState.flips,
        crop: newState.crop,
        rotation: newState.rotation,
      });
    } catch (error) {
      console.error("Failed to update photo in storage:", error);
      // Revert in-memory change on IndexedDB failure
      this.photos.value[photoIndex] = photo;
      throw error;
    }
  }

  /**
   * Persist flips/crop/rotation without rewriting blobs or invalidating thumbs.
   * Used when usesDeferredFlips is true.
   */
  protected async updateFlipsMetadataOnly(
    photoId: string,
    newState: PhotoState
  ): Promise<void> {
    const photoIndex = this.findPhotoIndexById(photoId);
    if (photoIndex === -1) {
      throw new Error(`Photo with ID ${photoId} not found`);
    }

    const photo = this.photos.value[photoIndex];
    if (!photo.id) {
      throw new Error("Photo must have an ID to update");
    }

    this.photos.value[photoIndex] = {
      ...photo,
      flips: { ...newState.flips },
      crop: newState.crop ? { ...newState.crop } : undefined,
      rotation: newState.rotation,
    };

    try {
      await updatePhotoMetadata(photo.id, {
        flips: newState.flips,
        crop: newState.crop,
        rotation: newState.rotation,
      });
    } catch (error) {
      console.error("Failed to update photo metadata:", error);
      this.photos.value[photoIndex] = photo;
      throw error;
    }
  }

  protected canUseDeferredFlipPath(
    photo: Photo,
    state?: PhotoState
  ): boolean {
    if (!usesDeferredFlips(photo)) return false;
    if (!state) return true;
    return !state.crop && !state.rotation;
  }
}
