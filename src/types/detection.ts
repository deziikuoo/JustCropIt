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

/** User-selected framing target for Suggest / Crop target. */
export type CropTarget =
  | 'full-body'
  | 'upper-body'
  | 'lower-body'
  | 'head-shoulders'
  | 'head';

export interface DetectionStageTimings {
  downscaleMs?: number;
  loadModelMs?: number;
  inferenceMs?: number;
  postProcessMs?: number;
  portraitMethod?: PortraitDetectionMethod;
  poseInferenceMs?: number;
  faceLandmarkInferenceMs?: number;
  faceDetectorInferenceMs?: number;
  identityLoadModelMs?: number;
  identityInferenceMs?: number;
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

/** Pixel-space facial landmark used for ArcFace alignment. */
export interface FaceKeypoint {
  x: number;
  y: number;
}

export interface DetectedFace {
  bbox: BoundingBox;
  score: number;
  /**
   * Optional BlazeFace keypoints in image pixels:
   * right eye, left eye, nose tip, mouth, right ear, left ear.
   */
  keypoints?: FaceKeypoint[];
}

export type DetectionWorkerRequestType =
  | 'ping'
  | 'detect'
  | 'portrait'
  | 'detectFaces'
  | 'warmup'
  | 'cancel';

export interface DetectionWorkerRequest {
  id: string;
  type: DetectionWorkerRequestType;
  photoId?: string;
  imageData?: ArrayBuffer;
  mimeType?: string;
  scaledWidth?: number;
  scaledHeight?: number;
  target?: CropTarget;
  hintBbox?: BoundingBox;
  faces?: DetectedFace[];
  includeDebug?: boolean;
}

export interface DetectionWorkerResponse {
  id: string;
  type: 'success' | 'error' | 'cancelled' | 'pong';
  photoId?: string;
  bbox?: BoundingBox | null;
  faces?: DetectedFace[];
  embeddings?: number[][];
  method?: PortraitDetectionMethod | null;
  loadModelMs?: number;
  inferenceMs?: number;
  poseInferenceMs?: number;
  faceLandmarkInferenceMs?: number;
  faceDetectorInferenceMs?: number;
  debug?: PortraitDebugOverlay | null;
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
