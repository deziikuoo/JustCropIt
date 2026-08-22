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
export const GRID_URL_LRU_MAX = 96;
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
/** Larger chunks for already-decoded video frame JPEGs on higher-memory devices */
export const UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES = 16;
/** Fallback chunk size for video-frame JPEGs on low-memory devices */
export const UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES_LOW_MEMORY = 4;
/** Conservative chunks when video frames are PNG (quota / memory risk) */
export const UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES_PNG = 4;
export const UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES_PNG_LOW_MEMORY = 1;
export const UPLOAD_DECODE_JPEG_QUALITY = 0.92;
export const UPLOAD_HEIC_MAX_CONCURRENT = 1;
export const UPLOAD_WORKER_POOL_MAX = 11;

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

export interface UploadIngestChunkOptions {
  hasSlowPathCandidate: boolean;
  /** Video-frame dumps — allow larger parallel chunks (JPEG only when filesAreJpeg) */
  preferLargerChunks?: boolean;
  /** When preferLargerChunks, only raise size for JPEG batches; PNG stays conservative */
  filesAreJpeg?: boolean;
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
    if (options.filesAreJpeg === false) {
      return memory <= 4
        ? UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES_PNG_LOW_MEMORY
        : UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES_PNG;
    }
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
export const EXPORT_DESTINATION_SESSION_KEY = 'justcropit-export-destination';
export const EXPORT_DESTINATION_DEFAULT: 'ask' | 'replace' | 'copy' = 'ask';
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
export const IDENTITY_FACE_SIZE_PX = 112;
export const IDENTITY_MATCH_MIN_COSINE = 0.58;
/** Full ArcFace+detect every Nth frame when track is cold; healthy track stretches further. */
export const IDENTITY_KEYFRAME_STRIDE = 6;
/** Max consecutive ROI-only frames while a healthy track is held (stronger temporal tracking). */
export const IDENTITY_TRACK_MAX_ROI_SKIPS = 12;
/** Max faces kept in the This person reference gallery (auto + manual). */
export const IDENTITY_REF_GALLERY_MAX = 5;
/** How many batch photos to sample for auto multi-view seeding. */
export const IDENTITY_AUTO_MULTIVIEW_SAMPLES = 4;
/** Expand projected face box by this factor before ROI detect (~1.8× face). */
export const IDENTITY_ROI_PAD_RATIO = 1.8;
export const IDENTITY_MAX_FACES = 5;
export const IDENTITY_CACHE_MAX_PHOTOS = 64;
/** Safety cap for in-flight batch scratch (video extracts can be hundreds of frames). */
export const IDENTITY_BATCH_SCRATCH_MAX = 2048;
/**
 * Source decode max edge for This person face detect.
 * MediaPipe Face Detector always resizes the whole image internally, so a
 * higher decode does not help small faces — tiling does (see below).
 */
export const IDENTITY_DETECT_MAX_EDGE_PX = 1280;
/**
 * MediaPipe Tasks Face Detector only accepts BlazeFace short-range (896 boxes).
 * blaze_face_full_range.tflite outputs 2304 and crashes the Tasks graph.
 */
export const FACE_DETECTOR_MODEL_FILE = 'blaze_face_short_range.tflite';
/** Overlapping tiles make mid/wide faces occupy more of the detector input. */
export const IDENTITY_DETECT_TILE_COLS = 2;
export const IDENTITY_DETECT_TILE_ROWS = 2;
export const IDENTITY_DETECT_TILE_OVERLAP = 0.22;
/** If the largest face is smaller than this fraction of min(image side), also tile. */
export const IDENTITY_SMALL_FACE_MIN_SIDE_RATIO = 0.14;
/** ± batch-order window for neighbor box fill after ArcFace miss. */
export const IDENTITY_NEIGHBOR_WINDOW = 8;
/** Max center distance vs projected neighbor box, as fraction of image min side. */
export const IDENTITY_NEIGHBOR_MAX_CENTER_SHIFT_RATIO = 0.25;
/** Face area vs neighbor projected area must stay within these ratios. */
export const IDENTITY_NEIGHBOR_MIN_SIZE_RATIO = 0.5;
export const IDENTITY_NEIGHBOR_MAX_SIZE_RATIO = 2.0;
/** Reject neighbor projection when frame aspect ratios differ by more than this. */
export const IDENTITY_NEIGHBOR_MAX_ASPECT_DELTA = 0.2;
/** Minimum projected face edge (px) to accept a no-detection neighbor fill. */
export const IDENTITY_NEIGHBOR_MIN_FACE_EDGE_PX = 24;
/** Apache-2.0 FaceX MobileFaceNet-nano ArcFace ONNX. */
export const IDENTITY_EMBEDDER_MODEL_FILE = 'facex_nano.onnx';
export const IDENTITY_EMBEDDER_MODEL_ID = 'facex_nano_arcface';
export const IDENTITY_EMBEDDING_DIM = 512;
export const DETECTION_BATCH_DOWNSCALE_CONCURRENCY = 1;
export const BATCH_CROP_MODE_STORAGE_KEY = 'justcropit.batchCropMode';
/** Interactive segmenter model (MagicTouch, unused by crop-to-object). */
export const INTERACTIVE_SEGMENTER_MODEL_FILE = 'magic_touch.tflite';
/**
 * WebSAM-class SAM 2 Tiny via sam-web. Base (~340 MB) and Large (~880 MB)
 * are too slow and memory-heavy for batches — Tiny only.
 */
export const SAM_OBJECT_MODEL_ID = 'sam2_tiny';
export const SAM_RETENTION_STORAGE_KEY = 'justcropit.samModelRetention';
export const SAM_CONSENT_SESSION_KEY = 'justcropit.samModelConsentSession';
/** OPFS root filenames written by sam-web for SAM 2 Tiny. */
export const SAM_MODEL_CACHE_FILES = [
  'sam2_hiera_tiny_encoder.with_runtime_opt.ort',
  'sam2_hiera_tiny_decoder_pr1.onnx',
] as const;
/** Fallback totals when the download response has no Content-Length. */
export const SAM_MODEL_EXPECTED_BYTES: Record<string, number> = {
  'sam2_hiera_tiny_encoder.with_runtime_opt.ort': 148 * 1024 * 1024,
  'sam2_hiera_tiny_decoder_pr1.onnx': 16 * 1024 * 1024,
};
/** Persisted pixel pad for crop-to-object (single + batch). */
export const OBJECT_CROP_PAD_STORAGE_KEY = 'justcropit.objectCropPadPx';
export const OBJECT_CROP_PAD_DEFAULT = 0;
export const OBJECT_CROP_PAD_MIN = 0;
export const OBJECT_CROP_PAD_MAX = 500;
/** Foreground confidence threshold for MagicTouch mask → bbox. */
export const OBJECT_MASK_CONFIDENCE_THRESHOLD = 0.4;
/** Accept auto-detected masks between these fractions of image area. */
export const OBJECT_MASK_MIN_AREA_RATIO = 0.005;
export const OBJECT_MASK_MAX_AREA_RATIO = 0.85;
/** Looser bounds when the user drew a mark around the target. */
export const OBJECT_MASK_GUIDED_CONFIDENCE_THRESHOLD = 0.5;
export const OBJECT_MASK_GUIDED_MIN_AREA_RATIO = 0.001;
export const OBJECT_MASK_GUIDED_MAX_AREA_RATIO = 0.75;
/** Scribble stroke sent to MagicTouch (normalized points). */
export const OBJECT_SCRIBBLE_MAX_POINTS = 48;
export const OBJECT_SCRIBBLE_MIN_POINTS = 6;
/** Inset grid for auto object seeding (normalized 0–1). */
export const OBJECT_AUTO_SEED_INSET = 0.15;
export const OBJECT_AUTO_SEED_GRID = 3;
/** Batch crop-to-object detect concurrency. SAM encode is per-image and heavy. */
export const OBJECT_CROP_DETECT_CONCURRENCY_MAX = 1;
/** Max RGB channel still treated as letterbox/pillarbox black (ffmpeg cropdetect). */
export const LETTERBOX_BLACK_LIMIT = 24;
/** Share of pixels in an edge line that must be near-black to count as a bar. */
export const LETTERBOX_COVERAGE = 0.992;
/** Refuse a trim that would leave a tiny leftover frame. */
export const LETTERBOX_MIN_CONTENT_PX = 8;
/** Decode/scan this many edge rows or columns per canvas read. */
export const LETTERBOX_STRIP_PX = 48;
/** iOS home-indicator pill is a short centered streak in the bottom safe area. */
export const LETTERBOX_HOME_MIN_WIDTH_RATIO = 0.08;
export const LETTERBOX_HOME_MAX_WIDTH_RATIO = 0.5;
export const LETTERBOX_HOME_CENTER_SLACK_RATIO = 0.12;
export const LETTERBOX_HOME_MIN_FILL = 0.35;
export const LETTERBOX_HOME_FROM_BOTTOM_RATIO = 0.06;
export const LETTERBOX_HOME_FROM_BOTTOM_MIN_PX = 48;
export const LETTERBOX_HOME_BRIGHT_MIN = 140;
export const LETTERBOX_HOME_CHROMA_MAX = 48;
export const LETTERBOX_DETECT_CONCURRENCY_MAX = 3;
/** Dev-only per-frame identity match logs. */
export const IDENTITY_DEBUG_LOGS = import.meta.env.DEV;

export function getLetterboxDetectConcurrency(): number {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(LETTERBOX_DETECT_CONCURRENCY_MAX, cores - 1));
}

export function getObjectCropDetectConcurrency(): number {
  return OBJECT_CROP_DETECT_CONCURRENCY_MAX;
}

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
