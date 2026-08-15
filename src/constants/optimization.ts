/**
 * Optimization Constants
 * 
 * Centralized configuration for performance optimizations.
 */

// Pixel 10 Pro XL viewport reference (portrait): width 412–430 px, height 915–932 px.
// Use in DevTools when testing safe-area insets and touch targets; breakpoint 480px covers this device.

// Worker Pool Configuration
// Cap at 8 workers to prevent excessive memory usage, but respect hardware limits
// Reserve 1 core for the main thread (UI)
export const WORKER_POOL_MAX = 8;

// Minimum batch size to offload to workers
// Below this, the overhead of serialization/transfer outweighs the benefit
export const MIN_BATCH_FOR_WORKERS = 2;

// Virtual Scrolling Configuration (P0 item 2)
// Device-aware crossover: full DOM below threshold; virtual scroll above.
// Mobile gets a lower threshold (fewer cores, less memory, narrower grid).
export const VIRTUAL_SCROLL_PHOTO_THRESHOLD_MOBILE = 80;
export const VIRTUAL_SCROLL_PHOTO_THRESHOLD_DESKTOP = 150;

/** Same breakpoint as PhotoGrid small-screen layout (max-width: 480px). */
export const VIRTUAL_SCROLL_MOBILE_BREAKPOINT_PX = 480;

export function getVirtualScrollPhotoThreshold(isMobileViewport: boolean): number {
  return isMobileViewport
    ? VIRTUAL_SCROLL_PHOTO_THRESHOLD_MOBILE
    : VIRTUAL_SCROLL_PHOTO_THRESHOLD_DESKTOP;
}

// Batch Download Configuration (P1)
export const DOWNLOAD_PARALLEL_BATCH_SIZE = 10;

// Main Thread Chunking Configuration (P2 item 6)
// Chunk size for heavy operations on the main thread to allow UI updates
export const MAIN_THREAD_CHUNK_SIZE = 5;

// Grid display / thumbnail pipeline
export const THUMBNAIL_MAX_EDGE_PX = 400;
export const THUMBNAIL_JPEG_QUALITY = 0.82;
export const GRID_URL_LRU_MAX = 48;
export const GRID_DECODE_CONCURRENCY = 6;
export const VIEWABILITY_THROTTLE_MS = 100;
export const VIEWABILITY_ROOT_MARGIN = '200px';
export const IDLE_PREFETCH_AHEAD = 12;
export const INITIAL_GRID_MOUNT_BATCH = 24;
export const GRID_MOUNT_BATCH_SIZE = 16;
export const GRID_ENTRANCE_ANIMATION_CAP = 6;
export const GRID_ENTRANCE_STAGGER_MS = 70;

/** Frames per batch before WASM reset (legacy FFmpeg extraction) */
export const VIDEO_EXTRACTION_CHUNK_SIZE = 25;
/** Smaller batches when using lossless PNG (legacy FFmpeg extraction) */
export const VIDEO_EXTRACTION_CHUNK_SIZE_PNG = 25;

/** Prefer GPU/hardware decode when the browser supports it */
export const WEBCODECS_HARDWARE_ACCELERATION = 'prefer-hardware' as const;
/** Throttle progress postMessage frequency during dense (e.g. 0.05s) extraction */
export const WEBCODECS_PROGRESS_EVERY_N_FRAMES = 5;
/** Match decoded frames to target timestamps within this window (microseconds) */
export const WEBCODECS_TIMESTAMP_TOLERANCE_US = 25_000;
/** Max encoded chunks waiting in VideoDecoder before pausing demux */
export const WEBCODECS_MAX_DECODE_QUEUE = 12;

export function getThumbnailCacheKey(
  photoId: string,
  thumbRevision: number
): string {
  return `${photoId}:${thumbRevision}`;
}

// Upload ingest pipeline (Phase 1)
export const UPLOAD_INGEST_CHUNK_SIZE = 1;
export const UPLOAD_INGEST_CHUNK_SIZE_FAST = 4;
/** Larger chunks for already-decoded video frame JPEGs/PNGs on higher-memory devices */
export const UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES = 8;
/** Fallback chunk size for video frames on low-memory devices */
export const UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES_LOW_MEMORY = 4;
export const UPLOAD_DECODE_JPEG_QUALITY = 0.92;
export const UPLOAD_HEIC_MAX_CONCURRENT = 1;
export const UPLOAD_WORKER_POOL_MAX = 11;

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

export interface UploadIngestChunkOptions {
  hasSlowPathCandidate: boolean;
  /** Video-frame dumps are already JPEG/PNG — allow larger parallel chunks */
  preferLargerChunks?: boolean;
}

/**
 * Pick chunk size for upload ingest based on batch composition and device memory.
 */
export function getUploadIngestChunkSize(
  hasSlowPathCandidateOrOptions: boolean | UploadIngestChunkOptions
): number {
  const options: UploadIngestChunkOptions =
    typeof hasSlowPathCandidateOrOptions === 'boolean'
      ? { hasSlowPathCandidate: hasSlowPathCandidateOrOptions }
      : hasSlowPathCandidateOrOptions;

  const nav = navigator as NavigatorWithMemory;
  const memory = nav.deviceMemory ?? 4;

  if (options.preferLargerChunks && !options.hasSlowPathCandidate) {
    return memory <= 4
      ? UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES_LOW_MEMORY
      : UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES;
  }

  if (options.hasSlowPathCandidate || memory <= 4) {
    return UPLOAD_INGEST_CHUNK_SIZE;
  }

  return UPLOAD_INGEST_CHUNK_SIZE_FAST;
}

// Export strip pipeline (Phase 2)
export const EXPORT_STRIP_JPEG_QUALITY = 0.92;
export const EXPORT_STRIP_DEFAULT = false;
export const EXPORT_SETTINGS_SESSION_KEY = 'justcropit-strip-exif-on-export';
export const EXPORT_STRIP_CHUNK_SIZE_LOW_MEMORY = 5;

/**
 * Chunk size for parallel export strip in batch ZIP downloads.
 */
// Operation history panel (Phase 3)
export const HISTORY_MAX_SIZE = 50;
export const UNDO_TO_NAV_DEBOUNCE_MS = 300;
export const HISTORY_PANEL_MOBILE_BREAKPOINT_PX = 480;

// Subject-aware crop suggest (Phase 4)
export const DETECTION_WORKER_POOL_MAX = 1;
export const DETECTION_INPUT_MAX_EDGE_PX = 640;
export const DETECTION_BBOX_PADDING_RATIO = 0.01;
/** Min landmark visibility for pose-driven portrait crops. */
export const DETECTION_LANDMARK_MIN_VISIBILITY = 0.4;
/** Lower visibility threshold for pose ear landmarks (often partially occluded). */
export const DETECTION_EAR_MIN_VISIBILITY = 0.1;
/** Expand each detected ear landmark outward toward the outer ear edge (× ear-to-ear span per side). */
export const DETECTION_EAR_OUTWARD_PAD_RATIO = 0.04;
/** Horizontal pad after ear bounds are resolved (× ear-to-ear span per side). */
export const DETECTION_EAR_HORIZONTAL_PAD_RATIO = 0.02;
/** Reject pose ear spans that are clearly wider than a portrait head crop. */
export const DETECTION_EAR_MAX_IMAGE_WIDTH_RATIO = 0.42;
/** Cap landmark-based horizontal crop against face side span. */
export const DETECTION_HEAD_MAX_FACE_WIDTH_RATIO = 1.55;
/** Face-landmark fallback: expand cheek bounds outward for outer ear (× head width per side). */
export const DETECTION_FACE_EAR_OUTWARD_PAD_RATIO = 0.06;
/** Expand the ear-side line outward toward the outer ear edge (× span per side). */
export const DETECTION_FACE_OVAL_EAR_PAD_RATIO = 0.05;
/** Expand inner-cheek bounds outward to reach outer ear (× inter-cheek span per side). */
export const DETECTION_CHEEKBONE_EAR_OFFSET_RATIO = 0.05;
/** Max crop width relative to inter-cheek distance (landmark 123 ↔ 352). */
export const DETECTION_FACE_WIDTH_CHEEK_MULTIPLIER = 1.12;
/** Max crop width relative to outer-eye distance (landmark 33 ↔ 263). */
export const DETECTION_FACE_WIDTH_EYE_MULTIPLIER = 1.22;
/** When one ear is occluded, mirror visible half-span across the face center. */
export const DETECTION_PROFILE_MIRROR_RATIO = 1;
/** Show landmark debug overlay in crop modal (dev builds only by default). */
export const DETECTION_DEBUG_OVERLAY = import.meta.env.DEV;
/** Pad below shoulder landmarks toward upper chest (× portrait height). */
export const DETECTION_PORTRAIT_SHOULDER_PAD_RATIO = 0.05;
/** Extend above forehead toward crown / hair (× chin-to-forehead face height). */
export const DETECTION_FACE_TOP_EXTEND_RATIO = 0.32;
/** Extend below chin landmark toward collarbone when pose shoulders missing. */
export const DETECTION_FACE_BOTTOM_EXTEND_RATIO = 0.4;
/** Face-detector fallback: extend beside face for ears (× face width per side). */
export const DETECTION_FACE_SIDE_EXTEND_RATIO = 0.12;
export const DETECTION_SUGGEST_DEBOUNCE_MS = 300;
export const DETECTION_IDLE_TERMINATE_MS = 5 * 60 * 1000;

export function getDetectionConcurrency(): number {
  const nav = navigator as NavigatorWithMemory;
  const memory = nav.deviceMemory ?? 4;
  return memory < 4 ? 1 : 1;
}

export function getExportStripChunkSize(): number {
  const nav = navigator as NavigatorWithMemory;
  const memory = nav.deviceMemory ?? 4;

  if (memory <= 4) {
    return EXPORT_STRIP_CHUNK_SIZE_LOW_MEMORY;
  }

  return DOWNLOAD_PARALLEL_BATCH_SIZE;
}
