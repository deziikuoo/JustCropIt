import { getUploadIngestChunkSize } from '../../constants/optimization';
import type { ImportFormat, PersistedIngestPhoto } from '../../types/import';
import type { Photo } from '../../types/photo';
import { performanceLogger } from '../performanceLogger';
import {
  createBulkPhotoSaver,
  getStorageStatus,
  isQuotaExceededError,
  isTransientIdbError,
} from '../photoStorage';
import { scheduleIdleTask } from '../scheduler';
import { createThumbhashFromBlob } from '../thumbhashGenerator';
import { blobToFile } from '../blobToFile';
import { pauseThumbnailBackfill, resumeThumbnailBackfill } from '../thumbnailBackfill';
import {
  batchHasSlowPathCandidate,
  fileLooksLikeJpeg,
  inferImportFormatFromNameAndType,
  isSupportedImportFile,
} from './formatDetector';
import { ingestPhotoFile } from './uploadIngest';

export interface IngestPersistOptions {
  operationIdPrefix: string;
  onError: (title: string, message: string) => void;
  onStorageWarning: (message: string) => void;
  onPhotosAdded?: (count: number) => void;
  /** Called as photos are written so the UI can stream updates */
  onPhotosPersisted?: (photos: Photo[]) => void;
  /** Fired as files are processed (success, fail, or quota) for progress UI */
  onProgress?: (processed: number, total: number) => void;
  /** Prefer larger parallel chunks (video-frame dumps); JPEG gets bigger chunks than PNG */
  preferLargerChunks?: boolean;
  /**
   * Frames already extracted on the Video tab — persist existing bytes;
   * skip format sniff, EXIF, decode, and thumbnail bake (grid backfill later).
   */
  fromVideoSession?: boolean;
  /** Abort in-flight import; already-persisted photos are kept */
  signal?: AbortSignal;
}

export interface IngestPersistResult {
  photos: Photo[];
  workerUsed: boolean;
  stoppedEarly: boolean;
  cancelled: boolean;
  failedCount: number;
  skippedUnsupported: number;
  requestedCount: number;
}

function toPhoto(result: PersistedIngestPhoto): Photo {
  return {
    id: result.id,
    original: result.file,
    current: result.file,
    fileName: result.file.name,
    thumbnail: result.thumbnailFile,
    thumbhash: result.thumbhash,
    thumbRevision: 0,
    flips: { horizontal: false, vertical: false },
    rotation: undefined,
  };
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    scheduleIdleTask(resolve, { timeout: 100 });
  });
}

function logImport(message: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.warn(`[Import] ${message}`, detail);
  } else {
    console.warn(`[Import] ${message}`);
  }
}

function isAborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

function videoSourceFormat(file: File): ImportFormat {
  const format = inferImportFormatFromNameAndType(file);
  return format === 'unknown' ? 'jpeg' : format;
}

/**
 * Full upload pipeline: validate → ingest → quota check → IndexedDB → Photo models.
 * Streams persisted photos to the UI as they land.
 * Supports cancellation via `signal`; photos already written are retained.
 */
export async function ingestAndPersistPhotos(
  rawFiles: File[],
  options: IngestPersistOptions
): Promise<IngestPersistResult> {
  const requestedCount = rawFiles.length;
  const signal = options.signal;

  logImport(`Starting import of ${requestedCount} file(s)`, {
    prefix: options.operationIdPrefix,
    preferLargerChunks: Boolean(options.preferLargerChunks),
    fromVideoSession: Boolean(options.fromVideoSession),
  });

  if (isAborted(signal)) {
    logImport('Import cancelled before start');
    return {
      photos: [],
      workerUsed: false,
      stoppedEarly: false,
      cancelled: true,
      failedCount: 0,
      skippedUnsupported: 0,
      requestedCount,
    };
  }

  pauseThumbnailBackfill();
  try {
    return await ingestAndPersistPhotosBody(rawFiles, options, requestedCount);
  } finally {
    resumeThumbnailBackfill();
  }
}

async function ingestAndPersistPhotosBody(
  rawFiles: File[],
  options: IngestPersistOptions,
  requestedCount: number
): Promise<IngestPersistResult> {
  const signal = options.signal;
  const fromVideoSession = Boolean(options.fromVideoSession);

  let files: File[];
  let skippedUnsupported = 0;

  if (fromVideoSession) {
    files = rawFiles;
  } else {
    const supportedChecks = await Promise.all(
      rawFiles.map(async (file) =>
        (await isSupportedImportFile(file)) ? file : null
      )
    );
    files = supportedChecks.filter((f): f is File => f !== null);
    skippedUnsupported = requestedCount - files.length;
    if (skippedUnsupported > 0) {
      logImport(`Skipped ${skippedUnsupported} unsupported file(s)`);
    }
  }

  if (isAborted(signal)) {
    logImport('Import cancelled during format checks');
    return {
      photos: [],
      workerUsed: false,
      stoppedEarly: false,
      cancelled: true,
      failedCount: 0,
      skippedUnsupported,
      requestedCount,
    };
  }

  if (files.length === 0) {
    logImport('No supported files to import — aborting');
    return {
      photos: [],
      workerUsed: false,
      stoppedEarly: false,
      cancelled: false,
      failedCount: 0,
      skippedUnsupported,
      requestedCount,
    };
  }

  const slowPathBatch = fromVideoSession
    ? false
    : await batchHasSlowPathCandidate(files);
  const filesAreJpeg = files.every(fileLooksLikeJpeg);
  const chunkSize = getUploadIngestChunkSize({
    hasSlowPathCandidate: slowPathBatch,
    preferLargerChunks: options.preferLargerChunks,
    filesAreJpeg,
  });

  logImport(`Using chunk size ${chunkSize}`, {
    slowPathBatch,
    filesAreJpeg,
    fromVideoSession,
    fileCount: files.length,
  });

  const operationId = `${options.operationIdPrefix}-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  const saver = createBulkPhotoSaver();
  const halfwayAt = Math.ceil(files.length / 2);
  let initialStorageChecked = false;
  let halfwayStorageChecked = false;
  let anyWorkerUsed = false;
  let stoppedEarly = false;
  let cancelled = false;
  let failedCount = 0;
  let processedCount = 0;
  let stopReason: string | null = null;
  const newPhotos: Photo[] = [];
  const slots: Array<Photo | null | undefined> = new Array(files.length);
  let nextEmitIndex = 0;

  const releaseInOrder = (index: number, photo: Photo | null): void => {
    slots[index] = photo;
    while (
      nextEmitIndex < files.length &&
      slots[nextEmitIndex] !== undefined
    ) {
      const item = slots[nextEmitIndex];
      nextEmitIndex += 1;
      if (item) {
        newPhotos.push(item);
        options.onPhotosPersisted?.([item]);
      }
    }
  };

  const applyStorageStatus = async (
    label: string
  ): Promise<'ok' | 'stop'> => {
    const status = await getStorageStatus();
    logImport(`Storage status ${label}`, {
      canStore: status.canStore,
      shouldWarn: status.shouldWarn,
      usageMB:
        status.usage != null
          ? Math.round(status.usage / 1024 / 1024)
          : undefined,
      quotaMB:
        status.quota != null
          ? Math.round(status.quota / 1024 / 1024)
          : undefined,
      availableMB:
        status.available != null
          ? Math.round(status.available / 1024 / 1024)
          : undefined,
      message: status.message,
    });

    if (status.shouldWarn && status.message) {
      options.onStorageWarning(status.message);
    }
    if (!status.canStore) {
      logImport(`Storage hard-blocked ${label}: ${status.message}`);
      options.onError(
        'Storage Limit',
        status.message || 'Not enough storage to import photos.'
      );
      return 'stop';
    }
    return 'ok';
  };

  const markProcessed = (): number => {
    processedCount += 1;
    options.onProgress?.(
      Math.min(processedCount, files.length),
      files.length
    );
    return processedCount;
  };

  for (let i = 0; i < files.length; i += chunkSize) {
    if (stoppedEarly || cancelled) break;

    if (isAborted(signal)) {
      cancelled = true;
      stopReason = 'cancelled by user';
      logImport('Import cancelled — stopping before next chunk', {
        importedSoFar: newPhotos.length,
      });
      break;
    }

    if (!initialStorageChecked) {
      initialStorageChecked = true;
      if ((await applyStorageStatus('on first file')) === 'stop') {
        stoppedEarly = true;
        stopReason = 'storage quota / app storage limit';
        break;
      }
    }

    const chunk = files.slice(i, i + chunkSize);
    const chunkIndex = Math.floor(i / chunkSize) + 1;
    const totalChunks = Math.ceil(files.length / chunkSize);

    logImport(
      `Processing chunk ${chunkIndex}/${totalChunks} (${chunk.length} file(s))`
    );

    await Promise.all(
      chunk.map(async (rawFile, chunkOffset): Promise<void> => {
        const fileIndex = i + chunkOffset;

        if (stoppedEarly || cancelled || isAborted(signal)) {
          if (isAborted(signal)) {
            cancelled = true;
            stopReason = stopReason ?? 'cancelled by user';
          }
          releaseInOrder(fileIndex, null);
          return;
        }

        try {
          let persistFile = rawFile;
          let sourceFormat: ImportFormat = videoSourceFormat(rawFile);
          let exifNormalized = false;
          let thumbnailBlob: Blob | undefined;
          let thumbhash: string | null = null;

          if (fromVideoSession) {
            // Existing JPEG/PNG bytes — do not re-detect, decode, or bake thumbs.
          } else {
            const ingest = await ingestPhotoFile(rawFile);
            if (stoppedEarly || cancelled || isAborted(signal)) {
              if (isAborted(signal)) {
                cancelled = true;
                stopReason = stopReason ?? 'cancelled by user';
              }
              releaseInOrder(fileIndex, null);
              markProcessed();
              return;
            }

            persistFile = ingest.file;
            sourceFormat = ingest.sourceFormat;
            exifNormalized = ingest.exifNormalized;
            thumbnailBlob = ingest.thumbnailBlob;
            if (ingest.workerUsed) anyWorkerUsed = true;

            if (ingest.timings.decodeMs || ingest.timings.normalizeMs) {
              performanceLogger.recordIngestStageTimings(
                operationId,
                ingest.timings
              );
            }

            thumbhash = await createThumbhashFromBlob(ingest.thumbnailBlob);
            if (stoppedEarly || cancelled || isAborted(signal)) {
              if (isAborted(signal)) {
                cancelled = true;
                stopReason = stopReason ?? 'cancelled by user';
              }
              releaseInOrder(fileIndex, null);
              markProcessed();
              return;
            }
          }

          const id = await saver.save({
            original: persistFile,
            current: persistFile,
            metadata: {
              name: persistFile.name,
              flips: { horizontal: false, vertical: false },
              sourceFormat,
              exifNormalized,
              ...(thumbhash ? { thumbhash } : {}),
            },
            thumbnail: thumbnailBlob,
          });

          const photo = toPhoto({
            id,
            file: persistFile,
            thumbnailFile: thumbnailBlob
              ? blobToFile(
                  thumbnailBlob,
                  `thumb-${persistFile.name}`,
                  'image/jpeg'
                )
              : undefined,
            thumbhash,
            sourceFormat,
            exifNormalized,
          });
          releaseInOrder(fileIndex, photo);
          const processed = markProcessed();
          if (
            processed === 1 ||
            processed === files.length ||
            processed % chunkSize === 0
          ) {
            logImport(`Persisted ${processed}/${files.length}`);
          }

          if (
            !halfwayStorageChecked &&
            files.length >= 2 &&
            processed >= halfwayAt
          ) {
            halfwayStorageChecked = true;
            if ((await applyStorageStatus('at 50%')) === 'stop') {
              stoppedEarly = true;
              stopReason = 'storage quota / app storage limit';
            }
          }
        } catch (error) {
          if (isAborted(signal)) {
            cancelled = true;
            stopReason = stopReason ?? 'cancelled by user';
            releaseInOrder(fileIndex, null);
            markProcessed();
            return;
          }

          if (isQuotaExceededError(error)) {
            const message =
              error instanceof Error ? error.message : String(error);
            logImport(`Quota exceeded on ${rawFile.name}`, message);
            options.onError(
              'Import Incomplete',
              'Browser storage quota was exceeded. Photos already imported were kept. Free disk space, exit private mode, or use JPEG frames.'
            );
            stoppedEarly = true;
            stopReason = stopReason ?? 'storage quota / app storage limit';
            releaseInOrder(fileIndex, null);
            markProcessed();
            return;
          }

          if (isTransientIdbError(error)) {
            const message =
              error instanceof Error ? error.message : String(error);
            logImport(`Storage reconnect failed on ${rawFile.name}`, message);
            options.onError(
              'Import Incomplete',
              `Storage connection failed after retries. Photos already imported were kept. ${message}`
            );
            stoppedEarly = true;
            stopReason = stopReason ?? 'storage quota / app storage limit';
            releaseInOrder(fileIndex, null);
            markProcessed();
            return;
          }

          failedCount += 1;
          const message =
            error instanceof Error ? error.message : String(error);
          logImport(`Failed to ingest ${rawFile.name}`, {
            error: message,
            stack: error instanceof Error ? error.stack : undefined,
          });
          options.onError(
            'Upload Error',
            `Failed to import ${rawFile.name}. ${message}`
          );
          releaseInOrder(fileIndex, null);
          markProcessed();
        }
      })
    );

    if (cancelled || isAborted(signal)) {
      cancelled = true;
      stopReason = stopReason ?? 'cancelled by user';
      logImport('Import cancelled after chunk', {
        importedSoFar: newPhotos.length,
      });
      break;
    }

    if (!stoppedEarly && i + chunkSize < files.length) {
      await yieldToMainThread();
    }
  }

  await performanceLogger.endMeasurement(
    operationId,
    'upload-ingest',
    newPhotos.length,
    anyWorkerUsed
  );

  if (newPhotos.length > 0 && options.onPhotosAdded) {
    options.onPhotosAdded(newPhotos.length);
  }

  const summary = {
    requestedCount,
    imported: newPhotos.length,
    failedCount,
    skippedUnsupported,
    stoppedEarly,
    cancelled,
    stopReason,
    workerUsed: anyWorkerUsed,
  };

  if (cancelled) {
    logImport('Import cancelled by user', summary);
  } else if (
    stoppedEarly ||
    failedCount > 0 ||
    newPhotos.length < files.length
  ) {
    logImport('Import finished with incomplete results', summary);
  } else {
    logImport('Import finished successfully', summary);
  }

  return {
    photos: newPhotos,
    workerUsed: anyWorkerUsed,
    stoppedEarly,
    cancelled,
    failedCount,
    skippedUnsupported,
    requestedCount,
  };
}
