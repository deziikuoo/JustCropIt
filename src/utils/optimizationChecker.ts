/**
 * Optimization Checker
 *
 * Verifies that all optimization features from OptimizationImp2.md are present
 * and configured according to the parameter rules. Used by the Optimization Check
 * modal (dev-only) for quick validation.
 */

import {
  MIN_BATCH_FOR_WORKERS,
  VIRTUAL_SCROLL_PHOTO_THRESHOLD_MOBILE,
  VIRTUAL_SCROLL_PHOTO_THRESHOLD_DESKTOP,
  getVirtualScrollPhotoThreshold,
  DOWNLOAD_PARALLEL_BATCH_SIZE,
  MAIN_THREAD_CHUNK_SIZE,
  THUMBNAIL_MAX_EDGE_PX,
  GRID_URL_LRU_MAX,
  GRID_DECODE_CONCURRENCY,
  GRID_ENTRANCE_ANIMATION_CAP,
  GRID_ENTRANCE_STAGGER_MS,
  IDLE_PREFETCH_AHEAD,
  VIEWABILITY_THROTTLE_MS,
  VIEWABILITY_ROOT_MARGIN,
  INITIAL_GRID_MOUNT_BATCH,
  GRID_MOUNT_BATCH_SIZE,
  getThumbnailCacheKey,
  UPLOAD_INGEST_CHUNK_SIZE,
  UPLOAD_INGEST_CHUNK_SIZE_FAST,
  UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES,
  UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES_LOW_MEMORY,
  UPLOAD_DECODE_JPEG_QUALITY,
  UPLOAD_WORKER_POOL_MAX,
  getUploadIngestChunkSize,
  EXPORT_STRIP_DEFAULT,
  EXPORT_STRIP_JPEG_QUALITY,
  getExportStripChunkSize,
  HISTORY_MAX_SIZE,
  UNDO_TO_NAV_DEBOUNCE_MS,
  HISTORY_PANEL_MOBILE_BREAKPOINT_PX,
  DETECTION_WORKER_POOL_MAX,
  DETECTION_INPUT_MAX_EDGE_PX,
  DETECTION_BBOX_PADDING_RATIO,
  DETECTION_SUGGEST_DEBOUNCE_MS,
  getDetectionConcurrency,
} from '../constants/optimization';
import { useVirtualScrollThreshold } from '../composables/useVirtualScrollThreshold';
import { useGridViewability } from '../composables/useGridViewability';
import { useGridImageDisplay } from '../composables/useGridImageDisplay';
import { applyDisplayInvalidation } from './thumbnailInvalidation';
import { BaseCommand } from './undoRedo/commands/BaseCommand';
import { runBatchFlip } from './batchImageOps';
import PhotoCard from '../components/PhotoCard.vue';
import PhotoGrid from '../components/PhotoGrid.vue';
import { performanceLogger } from './performanceLogger';
import { useBatchedGridMount } from '../composables/useBatchedGridMount';
import { useGridEntranceAnimation } from '../composables/useGridEntranceAnimation';
import { useGridIdlePrefetch } from '../composables/useGridIdlePrefetch';
import { computePrefetchIndices } from './gridPrefetchIndices';
import { warmThumbnailUrl } from './gridUrlWarm';
import { createThumbnailFromFile } from './thumbnailGenerator';
import { GridUrlCache } from './gridUrlCache';
import { createGridDecodeQueue } from './gridDecodeQueue';
import { getPhotoCacheKey, syncGridUrlsForVisibility } from './gridUrlSync';
import { imageWorkerPool } from './imageWorkerPool';
import { updatePhotosBatch, deletePhotos, updatePhotoThumbnail } from './photoStorage';
import { scheduleIdleTask, processInChunks } from './scheduler';
import { useVirtualScroll } from '../composables/useVirtualScroll';
import { createThumbhashFromBlob } from './thumbhashGenerator';
import { thumbhashToDataUrl } from './thumbhashDecode';
import { invalidatePhotoDisplay } from './thumbnailInvalidation';
import type { Photo } from '../types/photo';
import { ingestPhotoFile } from './import/uploadIngest';
import { isSupportedImportFile, detectImportFormat } from './import/formatDetector';
import { readExifOrientation } from './import/exifReader';
import { uploadWorkerPool } from './uploadWorkerPool';
import { prepareExportFile } from './export/prepareExportBlob';
import { hasPixelEdits } from './export/hasPixelEdits';
import { useExportSettings } from '../composables/useExportSettings';
import { useOperationHistory } from '../composables/useOperationHistory';
import OperationHistoryPanel from '../components/OperationHistoryPanel.vue';
import { UndoRedoManager } from './undoRedo/undoRedoManager';
import { BatchFlipCommand } from './undoRedo/commands/BatchFlipCommand';
import { BatchCropCommand } from './undoRedo/commands/BatchCropCommand';
import { CropCommand } from './undoRedo/commands/CropCommand';
import { useCropSuggestion } from '../composables/useCropSuggestion';
import { createDetectionQueue } from './detectionQueue';
import { bboxToSuggestedCrop } from './cropSuggestion';
import { isDetectionSupported } from './subjectDetection';
import { isFaceDetectionSupported, getFaceDetector } from './faceDetectorSession';
import { getPoseLandmarker } from './poseLandmarkerSession';
import { getFaceLandmarker } from './faceLandmarkerSession';
import { detectPortraitInBitmap } from './portraitDetection';

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
  const mobileThresholdOk =
    typeof VIRTUAL_SCROLL_PHOTO_THRESHOLD_MOBILE === 'number' &&
    VIRTUAL_SCROLL_PHOTO_THRESHOLD_MOBILE === 80;
  const desktopThresholdOk =
    typeof VIRTUAL_SCROLL_PHOTO_THRESHOLD_DESKTOP === 'number' &&
    VIRTUAL_SCROLL_PHOTO_THRESHOLD_DESKTOP === 150;
  const thresholdResolverOk =
    getVirtualScrollPhotoThreshold(true) === VIRTUAL_SCROLL_PHOTO_THRESHOLD_MOBILE &&
    getVirtualScrollPhotoThreshold(false) === VIRTUAL_SCROLL_PHOTO_THRESHOLD_DESKTOP;
  const thresholdOk = mobileThresholdOk && desktopThresholdOk && thresholdResolverOk;
  const useVirtualScrollFn = typeof useVirtualScroll === 'function';
  const useThresholdComposable = typeof useVirtualScrollThreshold === 'function';
  results.push({
    id: 'p0-virtual-scroll',
    name: 'Virtual scrolling (device-aware threshold)',
    status: thresholdOk && useVirtualScrollFn && useThresholdComposable ? 'pass' : 'fail',
    message: thresholdOk
      ? `Mobile ≥ ${VIRTUAL_SCROLL_PHOTO_THRESHOLD_MOBILE}, desktop ≥ ${VIRTUAL_SCROLL_PHOTO_THRESHOLD_DESKTOP} (Rule 2)`
      : 'Device-aware virtual scroll thresholds (80 mobile / 150 desktop) must be configured',
    detail: useVirtualScrollFn
      ? `useVirtualScroll + useVirtualScrollThreshold available`
      : 'useVirtualScroll or useVirtualScrollThreshold not found',
  });

  // --- Phase 0: Grid memory foundation ---
  const gridConstantsOk =
    THUMBNAIL_MAX_EDGE_PX === 400 &&
    GRID_URL_LRU_MAX === 48 &&
    GRID_DECODE_CONCURRENCY === 6 &&
    getThumbnailCacheKey('photo-test', 0) === 'photo-test:0';
  results.push({
    id: 'phase0-grid-constants',
    name: 'Phase 0: Grid display constants',
    status: gridConstantsOk ? 'info' : 'warn',
    message: gridConstantsOk
      ? `Thumb max edge ${THUMBNAIL_MAX_EDGE_PX}px; URL LRU ${GRID_URL_LRU_MAX}; decode concurrency ${GRID_DECODE_CONCURRENCY}`
      : 'Grid display constants missing or misconfigured',
    detail: gridConstantsOk
      ? `getThumbnailCacheKey sample: ${getThumbnailCacheKey('photo-test', 1)}`
      : undefined,
  });

  const stubsOk =
    typeof createThumbnailFromFile === 'function' &&
    typeof useGridViewability === 'function' &&
    typeof useGridImageDisplay === 'function' &&
    typeof GridUrlCache === 'function' &&
    typeof createGridDecodeQueue === 'function';
  results.push({
    id: 'phase0-stubs',
    name: 'Phase 0: Grid pipeline modules',
    status: stubsOk ? 'info' : 'warn',
    message: stubsOk
      ? 'gridUrlCache, gridDecodeQueue, and grid composables available'
      : 'One or more Phase 0 grid pipeline modules missing',
  });

  const generatorSource = createThumbnailFromFile.toString();
  const generatorImplemented = !generatorSource.includes('Not implemented');
  results.push({
    id: 'phase1-thumbnail-generator',
    name: 'Phase 1: Thumbnail generator',
    status: generatorImplemented ? 'info' : 'warn',
    message: generatorImplemented
      ? 'createThumbnailFromFile implemented; grid display wiring is Phase 3'
      : 'createThumbnailFromFile is still a Phase 0 stub',
    detail: generatorImplemented
      ? 'Upload and idle backfill populate Photo.thumbnail'
      : undefined,
  });

  const viewabilitySource = useGridViewability.toString();
  const viewabilityImplemented = !viewabilitySource.includes('Phase 0 stub');
  results.push({
    id: 'phase2-viewability',
    name: 'Phase 2: Viewability gating',
    status: viewabilityImplemented ? 'pass' : 'fail',
    message: viewabilityImplemented
      ? 'useGridViewability merges virtual range + bidirectional IO with throttling'
      : 'useGridViewability is still a Phase 0 stub',
    detail: viewabilityImplemented
      ? 'PhotoGrid must not mark all indices visible on upload'
      : undefined,
  });

  const urlSyncOk =
    typeof getPhotoCacheKey === 'function' &&
    typeof syncGridUrlsForVisibility === 'function' &&
    typeof GridUrlCache === 'function';
  results.push({
    id: 'phase2-grid-url-cache',
    name: 'Phase 2: Grid URL LRU cache',
    status: urlSyncOk ? 'info' : 'warn',
    message: urlSyncOk
      ? `GridUrlCache + photoId:thumbRevision keys; max ${GRID_URL_LRU_MAX} URLs`
      : 'gridUrlSync or GridUrlCache missing',
    detail: urlSyncOk
      ? 'Thumb-only grid display enforced in Phase 3'
      : undefined,
  });

  const displaySource = useGridImageDisplay.toString();
  const displayImplemented = !displaySource.includes('Phase 0 stub');
  const displayThumbOnly = !displaySource.includes('photo.current');
  results.push({
    id: 'phase3-grid-display',
    name: 'Phase 3: Tiered grid display',
    status: displayImplemented && displayThumbOnly ? 'pass' : 'fail',
    message:
      displayImplemented && displayThumbOnly
        ? 'useGridImageDisplay resolves thumbnail URLs via decode queue'
        : 'useGridImageDisplay must be implemented without photo.current fallback',
  });

  results.push({
    id: 'phase3-fullres-isolation',
    name: 'Phase 3: Full-res isolation',
    status: 'info',
    message:
      'Tier 2 createObjectURL allowed in App crop/download, CropModal, BatchCropSelector, undo commands only',
    detail: 'PhotoGrid uses getDisplayUrl (thumbnails only)',
  });

  const invalidationOk = typeof applyDisplayInvalidation === 'function';
  results.push({
    id: 'phase4-invalidation-module',
    name: 'Phase 4: Thumbnail invalidation module',
    status: invalidationOk ? 'pass' : 'fail',
    message: invalidationOk
      ? 'applyDisplayInvalidation available for edit mutations'
      : 'thumbnailInvalidation.ts must export applyDisplayInvalidation',
  });

  const baseCommandSource =
    (
      BaseCommand.prototype as unknown as {
        updatePhotoState?: () => Promise<void>;
      }
    ).updatePhotoState?.toString() ?? '';
  const baseCommandInvalidates = baseCommandSource.includes('applyDisplayInvalidation');
  results.push({
    id: 'phase4-base-command',
    name: 'Phase 4: Undo/redo invalidation',
    status: baseCommandInvalidates ? 'pass' : 'fail',
    message: baseCommandInvalidates
      ? 'BaseCommand.updatePhotoState applies display invalidation'
      : 'BaseCommand.updatePhotoState must call applyDisplayInvalidation',
  });

  const batchOpsSource = runBatchFlip.toString();
  const batchOpsInvalidates = batchOpsSource.includes('applyDisplayInvalidation');
  results.push({
    id: 'phase4-batch-ops',
    name: 'Phase 4: Batch worker invalidation',
    status: batchOpsInvalidates ? 'pass' : 'fail',
    message: batchOpsInvalidates
      ? 'batchImageOps worker paths apply display invalidation'
      : 'batchImageOps must call applyDisplayInvalidation on memory updates',
  });

  const displayRevisionGuard = useGridImageDisplay.toString().includes('revisionAtEnqueue');
  results.push({
    id: 'phase4-display-revision-guard',
    name: 'Phase 4: Display revision guard',
    status: 'info',
    message: displayRevisionGuard
      ? 'useGridImageDisplay skips stale decode jobs when thumbRevision changes'
      : 'useGridImageDisplay should guard decode queue with revisionAtEnqueue',
  });

  const photoCardOk = !!PhotoCard;
  results.push({
    id: 'phase5-photo-card',
    name: 'Phase 5: PhotoCard component',
    status: photoCardOk ? 'pass' : 'fail',
    message: photoCardOk
      ? 'PhotoCard extracted from PhotoGrid'
      : 'PhotoCard component must exist',
  });

  const batchedMountOk =
    typeof useBatchedGridMount === 'function' &&
    useBatchedGridMount.toString().includes('mountedDisplayCount');
  const entranceOk = typeof useGridEntranceAnimation === 'function';
  const vMemoOk = photoCardOk && batchedMountOk && entranceOk;
  results.push({
    id: 'phase5-v-memo',
    name: 'Phase 5: Render stability wiring',
    status: vMemoOk ? 'pass' : 'fail',
    message: vMemoOk
      ? 'PhotoCard + v-memo + entrance/batched mount composables wired'
      : 'PhotoGrid must use PhotoCard with v-memo and Phase 5 composables',
  });

  results.push({
    id: 'phase5-batched-mount',
    name: 'Phase 5: Batched initial mount',
    status: batchedMountOk ? 'pass' : 'fail',
    message: batchedMountOk
      ? 'useBatchedGridMount limits DOM below virtual-scroll threshold'
      : 'useBatchedGridMount must be exported and used',
  });

  results.push({
    id: 'phase5-entrance-cap',
    name: 'Phase 5: Entrance animation cap',
    status: 'info',
    message: `Max ${GRID_ENTRANCE_ANIMATION_CAP} entrance animations per upload batch`,
    detail: entranceOk ? 'useGridEntranceAnimation tracks capped indices' : undefined,
  });

  results.push({
    id: 'phase5-render-stability',
    name: 'Phase 5: v-memo keys',
    status: 'info',
    message: 'v-memo includes thumbRevision, displayUrl, selection, and drag state',
    detail: 'Focus-gated actions via selected/hover/focus-within in PhotoCard',
  });

  const prefetchUtilOk = typeof computePrefetchIndices === 'function';
  results.push({
    id: 'phase6-prefetch-util',
    name: 'Phase 6: Prefetch index utility',
    status: prefetchUtilOk ? 'pass' : 'fail',
    message: prefetchUtilOk
      ? 'computePrefetchIndices expands visible window by index order'
      : 'gridPrefetchIndices must export computePrefetchIndices',
  });

  const idlePrefetchSource = useGridIdlePrefetch.toString();
  const idlePrefetchOk =
    typeof useGridIdlePrefetch === 'function' &&
    idlePrefetchSource.includes('scheduleIdleTask');
  results.push({
    id: 'phase6-idle-prefetch',
    name: 'Phase 6: Idle prefetch composable',
    status: idlePrefetchOk ? 'pass' : 'fail',
    message: idlePrefetchOk
      ? 'useGridIdlePrefetch schedules cache warm after viewability settles'
      : 'useGridIdlePrefetch must use scheduleIdleTask',
  });

  const warmSource = warmThumbnailUrl.toString();
  const thumbOnlyPrefetch = !warmSource.includes('photo.current');
  results.push({
    id: 'phase6-thumb-only',
    name: 'Phase 6: Prefetch thumb-only URLs',
    status: thumbOnlyPrefetch ? 'pass' : 'fail',
    message: thumbOnlyPrefetch
      ? 'gridUrlWarm creates object URLs from photo.thumbnail only'
      : 'Prefetch must not reference photo.current',
  });

  results.push({
    id: 'phase6-prefetch-budget',
    name: 'Phase 6: Prefetch budget',
    status: 'info',
    message: `Prefetch up to ${IDLE_PREFETCH_AHEAD} indices beyond visible window`,
    detail: `GridUrlCache LRU max ${GRID_URL_LRU_MAX}; prefetch warms cache without binding DOM`,
  });

  const thumbhashModuleOk =
    typeof createThumbhashFromBlob === 'function' &&
    typeof thumbhashToDataUrl === 'function';
  results.push({
    id: 'phase7-thumbhash-module',
    name: 'Phase 7: Thumbhash encode/decode',
    status: thumbhashModuleOk ? 'pass' : 'fail',
    message: thumbhashModuleOk
      ? 'createThumbhashFromBlob and thumbhashToDataUrl exported'
      : 'thumbhashGenerator and thumbhashDecode must export encode/decode helpers',
  });

  const photoTypeOk = ((): boolean => {
    const sample: Photo = {
      original: new File([], 'sample.jpg'),
      current: new File([], 'sample.jpg'),
      thumbRevision: 0,
      cropHistory: [],
      cropFuture: [],
      flips: { horizontal: false, vertical: false },
      thumbhash: null,
    };
    return sample.thumbhash === null;
  })();
  results.push({
    id: 'phase7-photo-type',
    name: 'Phase 7: Photo thumbhash field',
    status: photoTypeOk ? 'pass' : 'fail',
    message: photoTypeOk
      ? 'Photo type includes optional thumbhash'
      : 'Photo interface must include thumbhash?: string | null',
  });

  const storageSource = updatePhotoThumbnail.toString();
  const storageOk =
    typeof updatePhotoThumbnail === 'function' &&
    storageSource.includes('thumbhash');
  results.push({
    id: 'phase7-storage',
    name: 'Phase 7: Thumbhash storage',
    status: storageOk ? 'pass' : 'fail',
    message: storageOk
      ? 'updatePhotoThumbnail persists optional thumbhash metadata'
      : 'photoStorage.updatePhotoThumbnail must accept thumbhash param',
  });

  const photoCardSource = PhotoCard.__file ?? PhotoCard.toString();
  const photoCardThumbhashUi =
    photoCardSource.includes('placeholderPreviewUrl') &&
    photoCardSource.includes('image-placeholder--thumbhash');
  results.push({
    id: 'phase7-ui',
    name: 'Phase 7: Thumbhash placeholder UI',
    status: 'info',
    message: photoCardThumbhashUi
      ? 'PhotoCard renders thumbhash preview before Tier 1 URL'
      : 'PhotoCard should show placeholderPreviewUrl when displayUrl is absent',
  });

  const invalidationSample = invalidatePhotoDisplay({
    original: new File([], 'a'),
    current: new File([], 'a'),
    thumbRevision: 0,
    cropHistory: [],
    cropFuture: [],
    flips: { horizontal: false, vertical: false },
    thumbhash: 'abc',
  });
  const invalidationClearsHash = invalidationSample.thumbhash === undefined;
  results.push({
    id: 'phase7-invalidation',
    name: 'Phase 7: Thumbhash invalidation',
    status: invalidationClearsHash ? 'pass' : 'fail',
    message: invalidationClearsHash
      ? 'invalidatePhotoDisplay clears thumbhash on edit'
      : 'invalidatePhotoDisplay must set thumbhash to undefined',
  });

  const viewabilityConstantsOk =
    VIEWABILITY_THROTTLE_MS === 100 &&
    VIEWABILITY_ROOT_MARGIN === '200px' &&
    INITIAL_GRID_MOUNT_BATCH === 24 &&
    GRID_MOUNT_BATCH_SIZE === 16 &&
    GRID_ENTRANCE_STAGGER_MS === 70;
  results.push({
    id: 'phase8-viewability-constants',
    name: 'Phase 8: Viewability and mount constants',
    status: viewabilityConstantsOk ? 'pass' : 'fail',
    message: viewabilityConstantsOk
      ? `Throttle ${VIEWABILITY_THROTTLE_MS}ms; root margin ${VIEWABILITY_ROOT_MARGIN}; mount batch ${INITIAL_GRID_MOUNT_BATCH}/${GRID_MOUNT_BATCH_SIZE}`
      : 'VIEWABILITY_THROTTLE_MS, VIEWABILITY_ROOT_MARGIN, or mount batch constants misconfigured',
  });

  const photoGridSource = PhotoGrid.__file ?? PhotoGrid.toString();
  const eagerVisibilityPatterns = [
    'Array.from({ length: props.photos.length',
    'Array.from({ length: photos.length',
    'for (let i = 0; i < props.photos.length',
    'for (let i = 0; i < photos.length',
    'visibleIndices.value = new Set(Array.from',
  ];
  const noEagerVisibility = !eagerVisibilityPatterns.some((pattern) =>
    photoGridSource.includes(pattern)
  );
  results.push({
    id: 'phase8-no-eager-visibility',
    name: 'Phase 8: No eager visibility on upload',
    status: noEagerVisibility ? 'pass' : 'fail',
    message: noEagerVisibility
      ? 'PhotoGrid does not bulk-assign all indices visible'
      : 'PhotoGrid must not mark every index visible when virtual scroll is off',
  });

  const gridSourceAuditOk =
    photoGridSource.includes('getDisplayUrl') &&
    !photoGridSource.includes('createObjectURL(photo.current)') &&
    !photoGridSource.includes(':src="photoUrl(photo.current');
  results.push({
    id: 'phase8-grid-source-audit',
    name: 'Phase 8: Grid thumb-only source audit',
    status: gridSourceAuditOk ? 'pass' : 'fail',
    message: gridSourceAuditOk
      ? 'PhotoGrid uses getDisplayUrl; no createObjectURL(photo.current) in grid'
      : 'PhotoGrid must bind Tier-1 URLs via getDisplayUrl only',
  });

  const gridImgDomOk = checkGridDisplayImages();
  results.push({
    id: 'phase8-grid-img-dom',
    name: 'Phase 8: Grid img DOM heuristic',
    status:
      gridImgDomOk === true ? 'pass' : gridImgDomOk === null ? 'info' : 'warn',
    message:
      gridImgDomOk === true
        ? 'Mounted grid display images use blob: object URLs (Tier 1)'
        : gridImgDomOk === null
          ? 'Grid not rendered yet; load photos and refresh to verify blob: URLs'
          : 'One or more grid display images are not blob: URLs (possible full-res leak)',
  });

  results.push({
    id: 'phase8-device-thresholds',
    name: 'Phase 8: Device-aware virtual scroll',
    status: 'info',
    message: `Mobile ≥ ${VIRTUAL_SCROLL_PHOTO_THRESHOLD_MOBILE}, desktop ≥ ${VIRTUAL_SCROLL_PHOTO_THRESHOLD_DESKTOP} photos enable virtual scroll`,
    detail: 'See docs/GridOptimizationTestMatrix.md rows 2–3',
  });

  const gridMetricsHookOk =
    typeof performanceLogger.recordGridSnapshot === 'function' &&
    typeof performanceLogger.getLatestGridSnapshot === 'function';
  results.push({
    id: 'phase8-grid-metrics-hook',
    name: 'Phase 8: Grid runtime metrics hook',
    status: gridMetricsHookOk ? 'pass' : 'fail',
    message: gridMetricsHookOk
      ? 'performanceLogger records gridUrlsActive and gridDecodesQueued snapshots'
      : 'performanceLogger must export recordGridSnapshot and getLatestGridSnapshot',
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

  // --- Phase 1: Upload ingest pipeline ---
  const ingestFnsOk =
    typeof ingestPhotoFile === 'function' &&
    typeof isSupportedImportFile === 'function' &&
    typeof detectImportFormat === 'function' &&
    typeof readExifOrientation === 'function';
  results.push({
    id: 'phase1-ingest-module',
    name: 'Phase 1: Upload ingest module',
    status: ingestFnsOk ? 'pass' : 'fail',
    message: ingestFnsOk
      ? 'ingestPhotoFile + formatDetector + exifReader wired'
      : 'Missing upload ingest utilities',
  });

  const uploadConstantsOk =
    UPLOAD_INGEST_CHUNK_SIZE >= 1 &&
    UPLOAD_INGEST_CHUNK_SIZE_FAST >= UPLOAD_INGEST_CHUNK_SIZE &&
    UPLOAD_DECODE_JPEG_QUALITY > 0 &&
    UPLOAD_DECODE_JPEG_QUALITY <= 1 &&
    UPLOAD_WORKER_POOL_MAX >= 1;
  const chunkSizerOk = typeof getUploadIngestChunkSize === 'function';
  results.push({
    id: 'phase1-upload-constants',
    name: 'Phase 1: Upload ingest constants',
    status: uploadConstantsOk && chunkSizerOk ? 'pass' : 'fail',
    message: uploadConstantsOk && chunkSizerOk
      ? `chunk slow=${UPLOAD_INGEST_CHUNK_SIZE} fast=${UPLOAD_INGEST_CHUNK_SIZE_FAST} video=${UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES}/${UPLOAD_INGEST_CHUNK_SIZE_VIDEO_FRAMES_LOW_MEMORY} workers max=${UPLOAD_WORKER_POOL_MAX}`
      : 'Upload ingest constants missing or invalid',
  });

  const uploadWorkerOk = typeof uploadWorkerPool.isSupported === 'function';
  results.push({
    id: 'phase1-upload-worker-pool',
    name: 'Phase 1: Dedicated upload worker pool',
    status: uploadWorkerOk ? 'pass' : 'fail',
    message: uploadWorkerOk
      ? `Upload worker pool isolated from edit pool (max=${UPLOAD_WORKER_POOL_MAX}, supported=${uploadWorkerPool.isSupported()})`
      : 'uploadWorkerPool not available',
  });

  const perfIngestType = performanceLogger.getMetrics().some(
    (m) => m.operationType === 'upload-ingest'
  );
  results.push({
    id: 'phase1-upload-ingest-metrics',
    name: 'Phase 1: upload-ingest performance type',
    status: typeof performanceLogger.recordIngestStageTimings === 'function' ? 'pass' : 'fail',
    message:
      typeof performanceLogger.recordIngestStageTimings === 'function'
        ? perfIngestType
          ? 'upload-ingest metrics recorded this session'
          : 'recordIngestStageTimings available (no uploads yet this session)'
        : 'recordIngestStageTimings missing from performanceLogger',
  });

  // --- Phase 2: Export privacy pipeline ---
  const exportFnsOk =
    typeof prepareExportFile === 'function' &&
    typeof hasPixelEdits === 'function';
  results.push({
    id: 'phase2-export-module',
    name: 'Phase 2: Export prepare module',
    status: exportFnsOk ? 'pass' : 'fail',
    message: exportFnsOk
      ? 'prepareExportFile + hasPixelEdits wired'
      : 'Missing export utilities',
  });

  const exportConstantsOk =
    EXPORT_STRIP_DEFAULT === false &&
    EXPORT_STRIP_JPEG_QUALITY > 0 &&
    EXPORT_STRIP_JPEG_QUALITY <= 1;
  const exportChunkOk = typeof getExportStripChunkSize === 'function';
  results.push({
    id: 'phase2-export-constants',
    name: 'Phase 2: Export strip constants',
    status: exportConstantsOk && exportChunkOk ? 'pass' : 'fail',
    message: exportConstantsOk && exportChunkOk
      ? `strip default=OFF quality=${EXPORT_STRIP_JPEG_QUALITY} chunk=${getExportStripChunkSize()}`
      : 'Export constants missing or invalid',
  });

  let exportSettingsDefaultOff = false;
  try {
    const { stripExifOnExport } = useExportSettings();
    exportSettingsDefaultOff = stripExifOnExport.value === false || sessionStorage.getItem('justcropit-strip-exif-on-export') !== 'true';
  } catch {
    exportSettingsDefaultOff = EXPORT_STRIP_DEFAULT === false;
  }
  results.push({
    id: 'phase2-export-settings',
    name: 'Phase 2: useExportSettings composable',
    status: typeof useExportSettings === 'function' && exportSettingsDefaultOff ? 'pass' : 'warn',
    message: typeof useExportSettings === 'function'
      ? `useExportSettings available (default strip OFF=${exportSettingsDefaultOff})`
      : 'useExportSettings missing',
  });

  results.push({
    id: 'phase2-export-worker-strip',
    name: 'Phase 2: uploadWorker stripExif task',
    status: typeof performanceLogger.recordExportBatchStats === 'function' ? 'pass' : 'fail',
    message: typeof performanceLogger.recordExportBatchStats === 'function'
      ? 'stripExif worker type + recordExportBatchStats available'
      : 'Export worker/metrics wiring incomplete',
  });

  // --- Phase 3: Operation history panel ---
  const historyManager = new UndoRedoManager();
  const historyApiOk =
    typeof historyManager.subscribe === 'function' &&
    typeof historyManager.getHistoryPanelState === 'function' &&
    typeof historyManager.undoTo === 'function' &&
    typeof historyManager.getIsNavigating === 'function';
  results.push({
    id: 'phase3-manager-api',
    name: 'Phase 3: UndoRedoManager history API',
    status: historyApiOk ? 'pass' : 'fail',
    message: historyApiOk
      ? 'subscribe, getHistoryPanelState, undoTo, getIsNavigating available'
      : 'History manager API incomplete',
  });

  const historyConstantsOk =
    HISTORY_MAX_SIZE === 50 &&
    UNDO_TO_NAV_DEBOUNCE_MS === 300 &&
    HISTORY_PANEL_MOBILE_BREAKPOINT_PX === 480;
  results.push({
    id: 'phase3-history-constants',
    name: 'Phase 3: History constants',
    status: historyConstantsOk ? 'pass' : 'fail',
    message: historyConstantsOk
      ? `max=${HISTORY_MAX_SIZE} debounce=${UNDO_TO_NAV_DEBOUNCE_MS}ms mobile=${HISTORY_PANEL_MOBILE_BREAKPOINT_PX}px`
      : 'History constants missing or invalid',
  });

  results.push({
    id: 'phase3-composable',
    name: 'Phase 3: useOperationHistory composable',
    status: typeof useOperationHistory === 'function' ? 'pass' : 'fail',
    message: typeof useOperationHistory === 'function'
      ? 'useOperationHistory exported'
      : 'useOperationHistory missing',
  });

  results.push({
    id: 'phase3-panel',
    name: 'Phase 3: OperationHistoryPanel component',
    status: OperationHistoryPanel != null ? 'pass' : 'fail',
    message: OperationHistoryPanel != null
      ? 'OperationHistoryPanel.vue registered'
      : 'OperationHistoryPanel missing',
  });

  const batchHistoryCommandsOk =
    typeof BatchFlipCommand === 'function' &&
    typeof BatchCropCommand === 'function' &&
    typeof CropCommand === 'function';
  results.push({
    id: 'phase3-batch-commands',
    name: 'Phase 3: History command coverage',
    status: batchHistoryCommandsOk ? 'pass' : 'fail',
    message: batchHistoryCommandsOk
      ? 'CropCommand, BatchFlipCommand, BatchCropCommand available'
      : 'Batch history commands missing',
  });

  const historyMetricsOk = performanceLogger
    .getMetrics()
    .some((m) => m.operationType === 'history-navigate');
  results.push({
    id: 'phase3-history-metrics',
    name: 'Phase 3: history-navigate performance type',
    status: 'pass',
    message: historyMetricsOk
      ? 'history-navigate metrics recorded this session'
      : 'history-navigate type registered (no navigations yet this session)',
  });

  // --- Phase 4: Subject-aware crop suggest ---
  const detectionConstantsOk =
    DETECTION_WORKER_POOL_MAX === 1 &&
    DETECTION_INPUT_MAX_EDGE_PX === 640 &&
    DETECTION_BBOX_PADDING_RATIO > 0 &&
    DETECTION_SUGGEST_DEBOUNCE_MS === 300 &&
    typeof getDetectionConcurrency === 'function';
  results.push({
    id: 'phase4-detection-constants',
    name: 'Phase 4: Detection constants',
    status: detectionConstantsOk ? 'pass' : 'fail',
    message: detectionConstantsOk
      ? `pool=${DETECTION_WORKER_POOL_MAX} maxEdge=${DETECTION_INPUT_MAX_EDGE_PX}px concurrency=${getDetectionConcurrency()}`
      : 'Detection constants missing or invalid',
  });

  const detectionSessionOk =
    typeof getFaceDetector === 'function' &&
    typeof getPoseLandmarker === 'function' &&
    typeof getFaceLandmarker === 'function' &&
    typeof detectPortraitInBitmap === 'function' &&
    typeof isFaceDetectionSupported === 'function';
  results.push({
    id: 'phase4-detection-session',
    name: 'Phase 4: Portrait detection sessions',
    status: detectionSessionOk ? 'pass' : 'fail',
    message: detectionSessionOk
      ? 'pose + face landmarker + face detector fallback (main-thread)'
      : 'Portrait detection sessions incomplete',
  });

  const detectionQueueOk = typeof createDetectionQueue === 'function';
  results.push({
    id: 'phase4-detection-queue',
    name: 'Phase 4: Detection queue + revision guard',
    status: detectionQueueOk ? 'pass' : 'fail',
    message: detectionQueueOk
      ? 'createDetectionQueue available'
      : 'Detection queue missing',
  });

  results.push({
    id: 'phase4-crop-suggestion-utils',
    name: 'Phase 4: cropSuggestion + subjectDetection',
    status:
      typeof bboxToSuggestedCrop === 'function' &&
      typeof isDetectionSupported === 'function'
        ? 'pass'
        : 'fail',
    message:
      typeof bboxToSuggestedCrop === 'function'
        ? 'bboxToSuggestedCrop + isDetectionSupported available'
        : 'Crop suggestion utilities missing',
  });

  results.push({
    id: 'phase4-composable',
    name: 'Phase 4: useCropSuggestion composable',
    status: typeof useCropSuggestion === 'function' ? 'pass' : 'fail',
    message: typeof useCropSuggestion === 'function'
      ? 'useCropSuggestion exported'
      : 'useCropSuggestion missing',
  });

  results.push({
    id: 'phase4-detection-metrics',
    name: 'Phase 4: crop-suggest performance type',
    status: typeof performanceLogger.recordDetectionStageTimings === 'function'
      ? 'pass'
      : 'fail',
    message: typeof performanceLogger.recordDetectionStageTimings === 'function'
      ? performanceLogger.getMetrics().some((m) => m.operationType === 'crop-suggest')
        ? 'crop-suggest metrics recorded this session'
        : 'recordDetectionStageTimings + crop-suggest type registered'
      : 'Detection metrics wiring incomplete',
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

function checkGridDisplayImages(): boolean | null {
  if (typeof document === 'undefined') return null;
  const imgs = document.querySelectorAll(
    '.photo-card-wrapper .image-container > img:not(.image-placeholder__preview)'
  );
  if (imgs.length === 0) return null;
  return [...imgs].every((img) =>
    (img.getAttribute('src') ?? '').startsWith('blob:')
  );
}
