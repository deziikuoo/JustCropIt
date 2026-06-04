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
export const THUMBNAIL_MAX_EDGE_PX = 320;
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

export function getThumbnailCacheKey(
  photoId: string,
  thumbRevision: number
): string {
  return `${photoId}:${thumbRevision}`;
}
