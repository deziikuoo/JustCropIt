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
export const VIRTUAL_SCROLL_PHOTO_THRESHOLD = 300;

// Batch Download Configuration (P1)
export const DOWNLOAD_PARALLEL_BATCH_SIZE = 10;

// Main Thread Chunking Configuration (P2 item 6)
// Chunk size for heavy operations on the main thread to allow UI updates
export const MAIN_THREAD_CHUNK_SIZE = 5;
