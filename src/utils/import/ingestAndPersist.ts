import { getUploadIngestChunkSize } from '../../constants/optimization';
import type { PersistedIngestPhoto } from '../../types/import';
import type { Photo } from '../../types/photo';
import { performanceLogger } from '../performanceLogger';
import {
  canStorePhoto,
  getStorageStatus,
  savePhoto,
} from '../photoStorage';
import { scheduleIdleTask } from '../scheduler';
import { createThumbhashFromBlob } from '../thumbhashGenerator';
import { blobToFile } from '../blobToFile';
import {
  batchHasSlowPathCandidate,
  isSupportedImportFile,
} from './formatDetector';
import { ingestPhotoFile } from './uploadIngest';

export interface IngestPersistOptions {
  operationIdPrefix: string;
  onError: (title: string, message: string) => void;
  onStorageWarning: (message: string) => void;
  onPhotosAdded?: (count: number) => void;
  /** Called after each chunk is written to IndexedDB so the UI can stream updates */
  onPhotosPersisted?: (photos: Photo[]) => void;
  /** Fired as files are processed (success, fail, or quota) for progress UI */
  onProgress?: (processed: number, total: number) => void;
  /** Prefer larger parallel chunks (video-frame JPEG/PNG dumps) */
  preferLargerChunks?: boolean;
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

/**
 * Full upload pipeline: validate → ingest → quota check → IndexedDB → Photo models.
 * Streams persisted photos to the UI after each chunk.
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

  const supportedChecks = await Promise.all(
    rawFiles.map(async (file) =>
      (await isSupportedImportFile(file)) ? file : null
    )
  );
  const files = supportedChecks.filter((f): f is File => f !== null);
  const skippedUnsupported = requestedCount - files.length;

  if (skippedUnsupported > 0) {
    logImport(`Skipped ${skippedUnsupported} unsupported file(s)`);
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

  const slowPathBatch = await batchHasSlowPathCandidate(files);
  const chunkSize = getUploadIngestChunkSize({
    hasSlowPathCandidate: slowPathBatch,
    preferLargerChunks: options.preferLargerChunks,
  });

  logImport(`Using chunk size ${chunkSize}`, {
    slowPathBatch,
    fileCount: files.length,
  });

  const status = await getStorageStatus();
  logImport('Storage status before import', {
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
    logImport(`Storage hard-blocked before import: ${status.message}`);
    options.onError(
      'Storage Limit',
      status.message || 'Not enough storage to import photos.'
    );
    return {
      photos: [],
      workerUsed: false,
      stoppedEarly: true,
      cancelled: false,
      failedCount: 0,
      skippedUnsupported,
      requestedCount,
    };
  }

  const operationId = `${options.operationIdPrefix}-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  let anyWorkerUsed = false;
  let stoppedEarly = false;
  let cancelled = false;
  let failedCount = 0;
  let processedCount = 0;
  let stopReason: string | null = null;
  const newPhotos: Photo[] = [];

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

    const chunk = files.slice(i, i + chunkSize);
    const chunkIndex = Math.floor(i / chunkSize) + 1;
    const totalChunks = Math.ceil(files.length / chunkSize);
    const chunkPhotos: Photo[] = [];

    logImport(
      `Processing chunk ${chunkIndex}/${totalChunks} (${chunk.length} file(s))`
    );

    const chunkResults = await Promise.all(
      chunk.map(
        async (
          rawFile
        ): Promise<PersistedIngestPhoto | null | 'quota' | 'cancelled'> => {
          if (isAborted(signal)) return 'cancelled';

          try {
            const ingest = await ingestPhotoFile(rawFile);
            if (isAborted(signal)) return 'cancelled';

            if (ingest.workerUsed) anyWorkerUsed = true;

            if (ingest.timings.decodeMs || ingest.timings.normalizeMs) {
              performanceLogger.recordIngestStageTimings(
                operationId,
                ingest.timings
              );
            }

            const storageCheck = await canStorePhoto(ingest.file, {
              identicalOriginalAndCurrent: true,
            });
            if (!storageCheck.canStore) {
              const reason =
                storageCheck.reason || `Cannot store ${rawFile.name}`;
              logImport(`Quota/storage stop on ${rawFile.name}`, reason);
              options.onError('Storage Limit', reason);
              return 'quota';
            }

            if (isAborted(signal)) return 'cancelled';

            const thumbhash = await createThumbhashFromBlob(
              ingest.thumbnailBlob
            );
            if (isAborted(signal)) return 'cancelled';

            const id = await savePhoto(
              ingest.file,
              ingest.file,
              {
                name: ingest.file.name,
                flips: { horizontal: false, vertical: false },
                sourceFormat: ingest.sourceFormat,
                exifNormalized: ingest.exifNormalized,
                ...(thumbhash ? { thumbhash } : {}),
              },
              ingest.thumbnailBlob
            );

            // Once saved, always return the photo so UI/IDB stay in sync
            // even if cancel was requested during the write.
            const thumbnailFile = blobToFile(
              ingest.thumbnailBlob,
              `thumb-${ingest.file.name}`,
              'image/jpeg'
            );

            return {
              id,
              file: ingest.file,
              thumbnailFile,
              thumbhash,
              sourceFormat: ingest.sourceFormat,
              exifNormalized: ingest.exifNormalized,
            };
          } catch (error) {
            if (isAborted(signal)) return 'cancelled';

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
            return null;
          }
        }
      )
    );

    for (const result of chunkResults) {
      processedCount += 1;
      if (result === 'cancelled') {
        cancelled = true;
        stopReason = stopReason ?? 'cancelled by user';
        continue;
      }
      if (result === 'quota') {
        stoppedEarly = true;
        stopReason = stopReason ?? 'storage quota / app storage limit';
        continue;
      }
      if (!result) continue;
      chunkPhotos.push(toPhoto(result));
    }

    options.onProgress?.(
      Math.min(processedCount, files.length),
      files.length
    );

    if (chunkPhotos.length > 0) {
      newPhotos.push(...chunkPhotos);
      options.onPhotosPersisted?.(chunkPhotos);
      logImport(
        `Persisted ${chunkPhotos.length} photo(s); running total ${newPhotos.length}/${files.length}`
      );
    }

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
