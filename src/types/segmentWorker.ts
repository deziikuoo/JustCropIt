/**
 * Segmenter worker message types.
 */

import type { BoundingBox } from './detection';
import type { NormalizedKeypoint } from '../utils/objectMaskCrop';
import type { SegmentMaskPayload } from '../utils/interactiveSegmenterSession';

export type SegmentWorkerRequestType = 'ping' | 'warmup' | 'segment' | 'cancel';

export interface SegmentWorkerRequest {
  id: string;
  type: SegmentWorkerRequestType;
  photoId?: string;
  imageData?: ArrayBuffer;
  mimeType?: string;
  keypoint?: NormalizedKeypoint;
  scribble?: NormalizedKeypoint[];
  guided?: boolean;
}

export interface SegmentWorkerResponse {
  id: string;
  type: 'success' | 'error' | 'cancelled' | 'pong';
  photoId?: string;
  bounds?: BoundingBox | null;
  areaRatio?: number;
  keypoint?: NormalizedKeypoint;
  mask?: SegmentMaskPayload | null;
  loadModelMs?: number;
  inferenceMs?: number;
  imageWidth?: number;
  imageHeight?: number;
  error?: string;
}
