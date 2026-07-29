import { getUploadIngestChunkSize } from '../../constants/optimization';
import type { PersistedIngestPhoto } from '../../types/import';
import type { Photo } from '../../types/photo';
import { performanceLogger } from '../performanceLogger';
import {
  canStorePhoto,
  getStorageStatus,
  savePhoto,
} from '../photoStorage';
import { processInChunks } from '../scheduler';
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
}

export interface IngestPersistResult {
  photos: Photo[];
  workerUsed: boolean;
}

/**
 * Full upload pipeline: validate → ingest → quota check → IndexedDB → Photo models.
 */
export async function ingestAndPersistPhotos(
  rawFiles: File[],
  options: IngestPersistOptions
): Promise<IngestPersistResult> {
  const supportedChecks = await Promise.all(
    rawFiles.map(async (file) =>
      (await isSupportedImportFile(file)) ? file : null
    )
  );
  const files = supportedChecks.filter((f): f is File => f !== null);

  if (files.length === 0) return { photos: [], workerUsed: false };

  const slowPathBatch = await batchHasSlowPathCandidate(files);
  const chunkSize = getUploadIngestChunkSize(slowPathBatch);

  const status = await getStorageStatus();
  if (status.shouldWarn && status.message) {
    options.onStorageWarning(status.message);
  }

  const operationId = `${options.operationIdPrefix}-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  let anyWorkerUsed = false;
  const newPhotos: Photo[] = [];

  const uploadResults = await processInChunks(
    files,
    async (rawFile) => {
      try {
        const ingest = await ingestPhotoFile(rawFile);
        if (ingest.workerUsed) anyWorkerUsed = true;

        if (ingest.timings.decodeMs || ingest.timings.normalizeMs) {
          performanceLogger.recordIngestStageTimings(operationId, ingest.timings);
        }

        const storageCheck = await canStorePhoto(ingest.file);
        if (!storageCheck.canStore) {
          options.onError(
            'Storage Limit',
            storageCheck.reason || `Cannot store ${rawFile.name}`
          );
          return null;
        }

        const thumbhash = await createThumbhashFromBlob(ingest.thumbnailBlob);
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

        const thumbnailFile = blobToFile(
          ingest.thumbnailBlob,
          `thumb-${ingest.file.name}`,
          'image/jpeg'
        );

        const persisted: PersistedIngestPhoto = {
          id,
          file: ingest.file,
          thumbnailFile,
          thumbhash,
          sourceFormat: ingest.sourceFormat,
          exifNormalized: ingest.exifNormalized,
        };

        return persisted;
      } catch (error) {
        console.error(`Failed to ingest ${rawFile.name}:`, error);
        options.onError(
          'Upload Error',
          `Failed to import ${rawFile.name}. ${error instanceof Error ? error.message : 'Please try again.'}`
        );
        return null;
      }
    },
    chunkSize
  );

  for (const result of uploadResults) {
    if (!result) continue;
    newPhotos.push({
      id: result.id,
      original: result.file,
      current: result.file,
      thumbnail: result.thumbnailFile,
      thumbhash: result.thumbhash,
      thumbRevision: 0,
      cropHistory: [],
      cropFuture: [],
      flips: { horizontal: false, vertical: false },
      rotation: undefined,
    });
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

  return { photos: newPhotos, workerUsed: anyWorkerUsed };
}
