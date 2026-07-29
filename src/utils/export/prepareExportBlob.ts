import type { ExportSettings, PreparedExport } from '../../types/export';
import type { Photo } from '../../types/photo';
import { mimeTypeCanCarryExif, stripExifFromBuffer } from './exifStrip';
import { hasPixelEdits } from './hasPixelEdits';

async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

/**
 * Prepare photo bytes for download respecting export privacy settings.
 */
export async function prepareExportFile(
  photo: Photo,
  settings: ExportSettings
): Promise<PreparedExport> {
  const file = photo.current;
  const fileName = file.name;
  const mimeType = file.type || 'image/jpeg';

  if (!settings.stripExifOnExport) {
    const buffer = await readFileBuffer(file);
    return {
      buffer,
      fileName,
      mimeType,
      path: 'passthrough',
      workerUsed: false,
    };
  }

  if (hasPixelEdits(photo)) {
    const buffer = await readFileBuffer(file);
    return {
      buffer,
      fileName,
      mimeType,
      path: 'fast-path',
      workerUsed: false,
    };
  }

  if (!mimeTypeCanCarryExif(mimeType)) {
    const buffer = await readFileBuffer(file);
    return {
      buffer,
      fileName,
      mimeType,
      path: 'passthrough',
      workerUsed: false,
    };
  }

  const sourceBuffer = await readFileBuffer(file);
  const stripped = await stripExifFromBuffer(sourceBuffer, mimeType);

  return {
    buffer: stripped.buffer,
    fileName,
    mimeType: stripped.mimeType,
    path: 'slow-path',
    workerUsed: stripped.workerUsed,
  };
}
