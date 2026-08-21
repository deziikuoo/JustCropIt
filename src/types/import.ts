/**
 * Upload import pipeline types (Phase 1)
 */

export type ImportFormat =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'heic'
  | 'heif'
  | 'avif'
  | 'unknown';

export interface IngestTimings {
  decodeMs?: number;
  normalizeMs?: number;
  thumbnailMs?: number;
}

export interface IngestResult {
  file: File;
  thumbnailBlob: Blob;
  sourceFormat: ImportFormat;
  exifNormalized: boolean;
  workerUsed: boolean;
  decoded: boolean;
  timings: IngestTimings;
}

export type UploadWorkerTaskType = 'ingest' | 'thumbnail' | 'stripExif' | 'ping';

export interface UploadWorkerRequest {
  id: string;
  type: UploadWorkerTaskType;
  imageData?: ArrayBuffer;
  mimeType?: string;
  orientation?: number;
  thumbnailMaxEdge?: number;
  thumbnailQuality?: number;
  normalizedJpegQuality?: number;
  jpegQuality?: number;
}

export interface UploadWorkerResponse {
  id: string;
  type: UploadWorkerTaskType;
  success: boolean;
  normalizedBuffer?: ArrayBuffer;
  thumbnailBuffer?: ArrayBuffer;
  strippedBuffer?: ArrayBuffer;
  width?: number;
  height?: number;
  error?: string;
}

export interface PersistedIngestPhoto {
  id: string;
  file: File;
  thumbnailFile?: File;
  thumbhash: string | null;
  sourceFormat: ImportFormat;
  exifNormalized: boolean;
}
