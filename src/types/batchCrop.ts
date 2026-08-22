import type { BoundingBox, CropTarget, DetectedFace } from './detection';

export type BatchCropMode = 'same-box' | 'follow-subject' | 'this-person' | 'trim-bars' | 'crop-to-object';

export type IdentityReferenceOrigin = 'auto' | 'manual';

export interface BatchCropSelectPayload {
  mode: BatchCropMode;
  /** Image opened in CropModal for crop-target / stencil setup */
  templateIndex: number;
  /** This person: photo indices chosen as identity references */
  referencePhotoIndices?: number[];
  /** Crop-to-object: pixel pad around detected object */
  objectPadPx?: number;
}

/** One face used as an identity reference for This person matching. */
export interface IdentityReferenceFace {
  photoId: string;
  /** Index into the photos array at apply / gallery time */
  photoIndex: number;
  bbox: BoundingBox;
  /** Optional BlazeFace keypoints for better ArcFace align */
  keypoints?: DetectedFace['keypoints'];
}

export interface BatchCropRecipe {
  mode: BatchCropMode;
  cropTarget: CropTarget | null;
  aspectRatio: number | null;
  rotation: number;
  /** Gallery of reference faces (This person). Match if any hits cosine threshold. */
  referenceFaces?: IdentityReferenceFace[];
}

export interface BatchTrimBarsResult {
  croppedCount: number;
  skippedCount: number;
  skippedPhotoIds: string[];
  cancelled: boolean;
}

export interface BatchObjectCropResult {
  croppedCount: number;
  skippedCount: number;
  skippedPhotoIds: string[];
  cancelled: boolean;
}

export interface BatchSmartCropResult {
  croppedCount: number;
  skippedCount: number;
  skippedPhotoIds: string[];
  workerUsed: boolean;
  cancelled: boolean;
  identityLoadModelMs?: number;
  identityInferenceMs?: number;
  /** ArcFace matches that led to a crop. */
  matchedCount?: number;
  /** Misses filled via bidirectional neighbor box projection. */
  neighborFilledCount?: number;
}
