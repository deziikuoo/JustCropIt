import type { ClipRenderSpec } from './videoEdit';

export interface TrimExportOptions {
  trimStartSeconds: number;
  clipDurationSeconds: number;
}

export interface RenderClipOptions {
  clip: ClipRenderSpec;
}

export interface ExportTimelineOptions {
  clips: ClipRenderSpec[];
}

/** Renders a contiguous subset of the full clip list — one pooled worker's share of a parallel export. */
export interface RenderClipBatchOptions {
  clips: ClipRenderSpec[];
  /** Global index of clips[0] within the full timeline, for progress/order mapping. */
  startIndex: number;
  /** Total clip count across every worker's batch, for progress display. */
  totalClips: number;
}

/** Stream-copies already-rendered (lossless-encoded) clip buffers together into one file. */
export interface ConcatClipsOptions {
  clipBuffers: Uint8Array[];
}

export interface TimelineRenderProgressWire {
  phase: 'loading' | 'rendering' | 'concatenating' | 'complete' | 'error';
  currentClip: number;
  totalClips: number;
  percent: number;
  message?: string;
}

export interface ExtractionOptions {
  intervalMs?: number;           // 50-3000ms — ignored when targetTimestamps is set
  outputFormat: 'png' | 'jpeg';
  quality: number;              // 0.92-1.0 for JPEG
  maxFrames?: number;           // Optional limit — ignored when targetTimestamps is set
  videoDuration?: number;        // seconds — trimmed clip duration; ignored when targetTimestamps is set
  trimStartSeconds?: number;    // offset into source video (default 0); ignored when targetTimestamps is set
  chunkSize?: number;           // frames per FFmpeg batch (default 75)
  /**
   * Explicit absolute source-video timestamps (seconds) to capture in a single
   * decode pass, bypassing interval-based sampling. Used for non-uniformly
   * spaced captures (e.g. one thumbnail per edit-timeline clip).
   */
  targetTimestamps?: number[];
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
  type:
    | 'extract'
    | 'probe'
    | 'cancel'
    | 'trim'
    | 'renderClip'
    | 'exportTimeline'
    | 'renderClipBatch'
    | 'concatClips'
    | 'preload';
  videoData?: ArrayBuffer;
  fileName?: string;
  options?: ExtractionOptions;
  trimOptions?: TrimExportOptions;
  renderClipOptions?: RenderClipOptions;
  exportTimelineOptions?: ExportTimelineOptions;
  renderClipBatchOptions?: RenderClipBatchOptions;
  concatClipsOptions?: ConcatClipsOptions;
}

export interface VideoWorkerResponse {
  id: string;
  type:
    | 'progress'
    | 'frame'
    | 'info'
    | 'complete'
    | 'error'
    | 'cancelled'
    | 'trimComplete'
    | 'renderClipComplete'
    | 'exportTimelineComplete'
    | 'renderClipBatchComplete'
    | 'concatClipsComplete';
  progress?: ExtractionProgress;
  timelineProgress?: TimelineRenderProgressWire;
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
  renderedClip?: {
    data: Uint8Array;
    mimeType: string;
    fileName: string;
  };
  exportedTimeline?: {
    data: Uint8Array;
    mimeType: string;
    fileName: string;
  };
  renderedClipBatch?: {
    clips: { index: number; data: Uint8Array; mimeType: string }[];
  };
  concatenatedTimeline?: {
    data: Uint8Array;
    mimeType: string;
    fileName: string;
  };
}
