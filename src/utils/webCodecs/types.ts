import type { ExtractionOptions, ExtractionProgress, VideoInfo } from '../../types/video';

export interface WebCodecsProbeResult extends VideoInfo {
  codecString?: string;
}

export interface WebCodecsExtractCallbacks {
  onProgress: (progress: ExtractionProgress) => void;
  onFrame: (frame: {
    index: number;
    timestamp: number;
    data: Uint8Array;
    mimeType: string;
  }) => void;
  isCancelled: () => boolean;
}

export interface WebCodecsExtractResult {
  framesExtracted: number;
  cancelled: boolean;
  failedFrames: number;
}

export type { ExtractionOptions, ExtractionProgress, VideoInfo };
