import type { ExportSettings, PreparedExport } from '../../types/export';
import type { Photo } from '../../types/photo';
import { mimeTypeCanCarryExif, stripExifFromBuffer } from './exifStrip';
import { hasPixelEdits } from './hasPixelEdits';
import { hasPendingFlipBake } from '../editTransform';
import { bakeDeferredFlipsForExport } from './bakeDeferredFlips';

async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

/**
 * Prepare photo bytes for download respecting export privacy settings.
 * Deferred flips are baked from original at export time.
 */
export async function prepareExportFile(
  photo: Photo,
  settings: ExportSettings
): Promise<PreparedExport> {
  const fileName = photo.current.name;
  let mimeType = photo.current.type || 'image/jpeg';
  let buffer: ArrayBuffer;
  let workerUsed = false;
  let bakedPendingFlips = false;

  if (hasPendingFlipBake(photo)) {
    const baked = await bakeDeferredFlipsForExport(photo);
    buffer = baked.buffer;
    mimeType = baked.mimeType;
    workerUsed = baked.workerUsed;
    bakedPendingFlips = true;
  } else {
    buffer = await readFileBuffer(photo.current);
  }

  if (!settings.stripExifOnExport) {
    return {
      buffer,
      fileName,
      mimeType,
      path: bakedPendingFlips ? 'fast-path' : 'passthrough',
      workerUsed,
    };
  }

  // Canvas-baked output (crop/rotate/deferred flip bake) has no EXIF
  if (hasPixelEdits(photo) || bakedPendingFlips) {
    return {
      buffer,
      fileName,
      mimeType,
      path: 'fast-path',
      workerUsed,
    };
  }

  if (!mimeTypeCanCarryExif(mimeType)) {
    return {
      buffer,
      fileName,
      mimeType,
      path: 'passthrough',
      workerUsed,
    };
  }

  const stripped = await stripExifFromBuffer(buffer, mimeType);

  return {
    buffer: stripped.buffer,
    fileName,
    mimeType: stripped.mimeType,
    path: 'slow-path',
    workerUsed: workerUsed || stripped.workerUsed,
  };
}
