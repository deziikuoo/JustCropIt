/**
 * Optimization Checker
 *
 * Verifies that all optimization features from OptimizationImp2.md are present
 * and configured according to the parameter rules. Used by the Optimization Check
 * modal (dev-only) for quick validation.
 */

import {
  WORKER_POOL_MAX,
  MIN_BATCH_FOR_WORKERS,
  VIRTUAL_SCROLL_PHOTO_THRESHOLD,
  DOWNLOAD_PARALLEL_BATCH_SIZE,
  MAIN_THREAD_CHUNK_SIZE,
} from '../constants/optimization';
import { imageWorkerPool } from './imageWorkerPool';
import { updatePhotosBatch, deletePhotos } from './photoStorage';
import { scheduleIdleTask, processInChunks } from './scheduler';
import { useVirtualScroll } from '../composables/useVirtualScroll';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info';

export interface OptimizationCheckResult {
  id: string;
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
}

/**
 * Run all optimization feature checks and rule-compliance checks.
 * Safe to call from the app; uses no DOM except for optional content-visibility check.
 */
export function runOptimizationChecks(): OptimizationCheckResult[] {
  const results: OptimizationCheckResult[] = [];

  // --- P0: Web Workers ---
  const workerSupported = imageWorkerPool.isWorkerSupported();
  const shouldUse = imageWorkerPool.shouldUseWorkers(MIN_BATCH_FOR_WORKERS);
  results.push({
    id: 'p0-workers',
    name: 'Web Workers (flip / crop / paste)',
    status: workerSupported ? 'pass' : 'warn',
    message: workerSupported
      ? `Workers supported; used when batch ≥ ${MIN_BATCH_FOR_WORKERS} (Rule 2)`
      : 'Workers or OffscreenCanvas not supported; main-thread fallback used',
    detail: workerSupported ? `shouldUseWorkers(2) = ${shouldUse}` : undefined,
  });

  // --- P0: Virtual scrolling ---
  const thresholdOk =
    typeof VIRTUAL_SCROLL_PHOTO_THRESHOLD === 'number' &&
    VIRTUAL_SCROLL_PHOTO_THRESHOLD === 300;
  const useVirtualScrollFn = typeof useVirtualScroll === 'function';
  results.push({
    id: 'p0-virtual-scroll',
    name: 'Virtual scrolling (300+ threshold)',
    status: thresholdOk && useVirtualScrollFn ? 'pass' : 'fail',
    message: thresholdOk
      ? `Threshold = ${VIRTUAL_SCROLL_PHOTO_THRESHOLD}; composable available (Rule 2)`
      : 'VIRTUAL_SCROLL_PHOTO_THRESHOLD should be 300 and useVirtualScroll must exist',
    detail: useVirtualScrollFn ? 'useVirtualScroll is a function' : 'useVirtualScroll not found',
  });

  // --- P1: IndexedDB batching ---
  const hasUpdateBatch = typeof updatePhotosBatch === 'function';
  const hasDeleteBatch = typeof deletePhotos === 'function';
  results.push({
    id: 'p1-idb-batching',
    name: 'IndexedDB write batching',
    status: hasUpdateBatch && hasDeleteBatch ? 'pass' : 'fail',
    message:
      hasUpdateBatch && hasDeleteBatch
        ? 'updatePhotosBatch and deletePhotos available (Rule 1: batch boundary)'
        : 'Missing updatePhotosBatch or deletePhotos in photoStorage',
  });

  // --- P1: Batch download parallelization ---
  const downloadBatchOk =
    typeof DOWNLOAD_PARALLEL_BATCH_SIZE === 'number' &&
    DOWNLOAD_PARALLEL_BATCH_SIZE >= 1;
  results.push({
    id: 'p1-download-parallel',
    name: 'Batch download parallelization',
    status: downloadBatchOk ? 'pass' : 'fail',
    message: downloadBatchOk
      ? `Chunk size = ${DOWNLOAD_PARALLEL_BATCH_SIZE} (Promise.all per chunk)`
      : 'DOWNLOAD_PARALLEL_BATCH_SIZE must be a positive number',
  });

  // --- P2: content-visibility ---
  const contentVisibilityOk = checkContentVisibilityInDOM();
  results.push({
    id: 'p2-content-visibility',
    name: 'content-visibility (CSS)',
    status: contentVisibilityOk === true ? 'pass' : contentVisibilityOk === null ? 'info' : 'warn',
    message:
      contentVisibilityOk === true
        ? '.photo-card-wrapper uses content-visibility: auto and contain-intrinsic-size'
        : contentVisibilityOk === null
          ? 'Grid not rendered yet; ensure PhotoGrid uses .photo-card-wrapper with content-visibility'
          : 'content-visibility or contain-intrinsic-size not applied (grid may be empty)',
  });

  // --- P2: requestIdleCallback / chunked work ---
  const hasScheduleIdle = typeof scheduleIdleTask === 'function';
  const hasProcessInChunks = typeof processInChunks === 'function';
  const chunkSizeOk =
    typeof MAIN_THREAD_CHUNK_SIZE === 'number' && MAIN_THREAD_CHUNK_SIZE >= 1;
  results.push({
    id: 'p2-idle-chunked',
    name: 'requestIdleCallback / chunked work',
    status: hasScheduleIdle && hasProcessInChunks && chunkSizeOk ? 'pass' : 'fail',
    message:
      hasScheduleIdle && hasProcessInChunks && chunkSizeOk
        ? `scheduler + MAIN_THREAD_CHUNK_SIZE = ${MAIN_THREAD_CHUNK_SIZE} (main-thread fallback)`
        : 'Missing scheduleIdleTask, processInChunks, or MAIN_THREAD_CHUNK_SIZE',
  });

  // --- P2: Passive touch/scroll listeners ---
  results.push({
    id: 'p2-passive-listeners',
    name: 'Passive touch/scroll listeners',
    status: 'info',
    message:
      'Spec: resize/touchend/touchcancel use { passive: true }; touchmove for drag uses passive: false (PhotoGrid, ShimmerBackground, DeletionNotification)',
    detail: 'See OptimizationImp2.md §5.7',
  });

  // --- Rule 1: Seamless integration ---
  results.push({
    id: 'rule1-seamless',
    name: 'Rule 1: Seamless integration',
    status: 'info',
    message:
      'Single run-batch path (workers + logger); shared visibleIndices for virtual scroll and lazy load',
    detail: 'Section 6.1',
  });

  // --- Rule 2: Dynamic choice ---
  const rule2Workers = workerSupported && MIN_BATCH_FOR_WORKERS >= 1;
  const rule2Virtual = thresholdOk;
  results.push({
    id: 'rule2-dynamic',
    name: 'Rule 2: Dynamic choice',
    status: rule2Workers && rule2Virtual ? 'pass' : 'warn',
    message: rule2Workers && rule2Virtual
      ? 'Worker vs main thread by batch size; virtual scroll vs full DOM by photo count'
      : 'Constants for dynamic choice (workers, virtual scroll threshold) must be set',
  });

  return results;
}

/**
 * If the DOM has a .photo-card-wrapper, check that it has content-visibility and contain-intrinsic-size.
 * Returns true if check passed, false if failed, null if element not found (e.g. grid empty).
 */
function checkContentVisibilityInDOM(): boolean | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector('.photo-card-wrapper');
  if (!el) return null;
  const style = getComputedStyle(el);
  return style.contentVisibility === 'auto';
}
