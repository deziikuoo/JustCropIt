/**
 * Subject detection types (Phase 4)
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SuggestedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export type PortraitDetectionMethod =
  | 'pose+face'
  | 'pose'
  | 'face-landmark'
  | 'face-detector';

export interface DetectionStageTimings {
  downscaleMs?: number;
  loadModelMs?: number;
  inferenceMs?: number;
  postProcessMs?: number;
  portraitMethod?: PortraitDetectionMethod;
  poseInferenceMs?: number;
  faceLandmarkInferenceMs?: number;
  faceDetectorInferenceMs?: number;
}

export type PortraitDebugPointKind =
  | 'face-ear'
  | 'face-cheek'
  | 'face-eye'
  | 'pose-ear'
  | 'bbox';

export interface PortraitDebugPoint {
  x: number;
  y: number;
  label: string;
  kind: PortraitDebugPointKind;
}

export interface PortraitDebugOverlay {
  points: PortraitDebugPoint[];
  bbox: BoundingBox | null;
  /** Final crop applied to the stencil (after padding / aspect fit). */
  appliedCrop: BoundingBox | null;
  widthSource: string | null;
  faceWidthPx: number | null;
  imageSize: ImageDimensions;
}

export type DetectionWorkerRequestType = 'ping' | 'detect' | 'cancel';

export interface DetectionWorkerRequest {
  id: string;
  type: DetectionWorkerRequestType;
  photoId?: string;
  imageData?: ArrayBuffer;
  mimeType?: string;
  scaledWidth?: number;
  scaledHeight?: number;
}

export interface DetectionWorkerResponse {
  id: string;
  type: 'success' | 'error' | 'cancelled' | 'pong';
  photoId?: string;
  bbox?: BoundingBox | null;
  loadModelMs?: number;
  inferenceMs?: number;
  error?: string;
}

export interface DownscaledImagePayload {
  buffer: ArrayBuffer;
  mimeType: string;
  fullWidth: number;
  fullHeight: number;
  scaledWidth: number;
  scaledHeight: number;
}
