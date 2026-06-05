export interface TrimExportOptions {
  trimStartSeconds: number;
  clipDurationSeconds: number;
}

export interface ExtractionOptions {
  intervalMs: number;           // 50-3000ms
  outputFormat: 'png' | 'jpeg';
  quality: number;              // 0.92-1.0 for JPEG
  maxFrames?: number;           // Optional limit
  videoDuration: number;        // seconds — trimmed clip duration for extraction
  trimStartSeconds?: number;    // offset into source video (default 0)
  chunkSize?: number;           // frames per FFmpeg batch (default 75)
}

export interface ExtractionProgress {
  phase: 'loading' | 'extracting' | 'processing' | 'complete' | 'error';
  currentFrame: number;
  totalFrames: number;
  percent: number;
  message?: string;
}

export interface ExtractedFrame {
  timestamp: number;
  blob: Blob;
  index: number;
}

export interface VideoInfo {
  duration: number;           // in seconds
  width: number;
  height: number;
  frameRate?: number;
  codec?: string;
}

export interface VideoWorkerRequest {
  id: string;
  type: 'extract' | 'probe' | 'cancel' | 'trim';
  videoData?: ArrayBuffer;
  fileName?: string;
  options?: ExtractionOptions;
  trimOptions?: TrimExportOptions;
}

export interface VideoWorkerResponse {
  id: string;
  type: 'progress' | 'frame' | 'info' | 'complete' | 'error' | 'cancelled' | 'trimComplete';
  progress?: ExtractionProgress;
  frame?: {
    index: number;
    timestamp: number;
    data: Uint8Array;
    mimeType: string;
  };
  info?: VideoInfo;
  error?: string;
  framesExtracted?: number;
  trimVideo?: {
    data: Uint8Array;
    mimeType: string;
    fileName: string;
  };
}
