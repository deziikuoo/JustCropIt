/**
 * Web Worker Message Types
 * 
 * Defines the contract between the main thread and the image processing worker.
 */

// Operation Parameters
export interface FlipParams {
  direction: 'horizontal' | 'vertical';
}

export interface CropParams {
  crop: { x: number; y: number; width: number; height: number };
  rotation?: number; // Rotation in degrees (0, 90, 180, 270)
}

export interface PasteParams {
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
  // Current state might be needed if we need to apply logic based on it,
  // but usually for paste we just apply the target settings to the original image.
  // We'll keep it simple for now and just pass the target settings.
}

// Request Types
export interface WorkerRequest {
  id: string;
  type: 'flip' | 'crop' | 'paste' | 'ping';
  imageData?: ArrayBuffer; // Image data (not needed for ping)
  mimeType?: string;       // e.g. 'image/jpeg'
  params?: FlipParams | CropParams | PasteParams;
}

// Response Types
export interface WorkerResponse {
  id: string;
  success: boolean;
  type: 'flip' | 'crop' | 'paste' | 'ping';
  result?: ArrayBuffer; // Processed image data
  /** Grid JPEG thumbnail baked in the same pass as `result`. */
  thumbnailBuffer?: ArrayBuffer;
  error?: string;
}
