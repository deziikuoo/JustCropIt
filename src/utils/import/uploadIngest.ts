import {
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_EDGE_PX,
  UPLOAD_DECODE_JPEG_QUALITY,
} from '../../constants/optimization';
import type { ImportFormat, IngestResult } from '../../types/import';
import { createThumbnailFromFile, computeThumbnailDimensions } from '../thumbnailGenerator';
import { uploadWorkerPool } from '../uploadWorkerPool';
import { decodeAvifToJpegFile } from './avifDecoder';
import { readExifOrientation } from './exifReader';
import {
  drawOrientedImage,
  getOrientedDimensions,
  needsOrientationNormalize,
} from './exifOrientation';
import {
  detectImportFormat,
  isAvifFormat,
  isHeicOrHeifFormat,
  jpegFileNameFromOriginal,
} from './formatDetector';
import { decodeHeicToJpegFile } from './heicDecoder';

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode JPEG'));
      },
      'image/jpeg',
      quality
    );
  });
}

async function ingestOnMainThread(
  buffer: ArrayBuffer,
  mimeType: string,
  fileName: string,
  orientation: number
): Promise<{ file: File; thumbnailBlob: Blob }> {
  const bitmap = await createImageBitmap(new Blob([buffer], { type: mimeType }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });

  try {
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const mustNormalize = needsOrientationNormalize(orientation);

    let normalizedWidth: number;
    let normalizedHeight: number;
    const canvas = document.createElement('canvas');

    if (mustNormalize) {
      const dims = getOrientedDimensions(sourceWidth, sourceHeight, orientation);
      normalizedWidth = dims.width;
      normalizedHeight = dims.height;
      canvas.width = normalizedWidth;
      canvas.height = normalizedHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get normalize context');
      drawOrientedImage(ctx, bitmap, sourceWidth, sourceHeight, orientation);
    } else {
      normalizedWidth = sourceWidth;
      normalizedHeight = sourceHeight;
      canvas.width = normalizedWidth;
      canvas.height = normalizedHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get copy context');
      ctx.drawImage(bitmap, 0, 0);
    }

    const normalizedBlob = await canvasToJpegBlob(
      canvas,
      UPLOAD_DECODE_JPEG_QUALITY
    );
    const outputName =
      mimeType === 'image/jpeg' ? fileName : jpegFileNameFromOriginal(fileName);
    const file = new File([normalizedBlob], outputName, { type: 'image/jpeg' });

    const thumbDims = computeThumbnailDimensions(
      normalizedWidth,
      normalizedHeight,
      THUMBNAIL_MAX_EDGE_PX
    );
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbDims.width;
    thumbCanvas.height = thumbDims.height;
    const thumbCtx = thumbCanvas.getContext('2d');
    if (!thumbCtx) throw new Error('Failed to get thumbnail context');
    thumbCtx.drawImage(
      canvas,
      0,
      0,
      normalizedWidth,
      normalizedHeight,
      0,
      0,
      thumbDims.width,
      thumbDims.height
    );
    const thumbnailBlob = await canvasToJpegBlob(
      thumbCanvas,
      THUMBNAIL_JPEG_QUALITY
    );

    return { file, thumbnailBlob };
  } finally {
    bitmap.close();
  }
}

async function ingestViaWorker(
  buffer: ArrayBuffer,
  mimeType: string,
  fileName: string,
  orientation: number
): Promise<{ file: File; thumbnailBlob: Blob }> {
  const id = `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const transferable = buffer.slice(0);

  const response = await uploadWorkerPool.submitTask(
    {
      id,
      type: 'ingest',
      imageData: transferable,
      mimeType,
      orientation,
      thumbnailMaxEdge: THUMBNAIL_MAX_EDGE_PX,
      thumbnailQuality: THUMBNAIL_JPEG_QUALITY,
      normalizedJpegQuality: UPLOAD_DECODE_JPEG_QUALITY,
    },
    [transferable]
  );

  if (
    !response.success ||
    !response.normalizedBuffer ||
    !response.thumbnailBuffer
  ) {
    throw new Error(response.error || 'Upload worker ingest failed');
  }

  const outputName =
    mimeType === 'image/jpeg' ? fileName : jpegFileNameFromOriginal(fileName);

  const file = new File([response.normalizedBuffer], outputName, {
    type: 'image/jpeg',
  });
  const thumbnailBlob = new Blob([response.thumbnailBuffer], {
    type: 'image/jpeg',
  });

  return { file, thumbnailBlob };
}

async function runSlowPathIngest(
  file: File,
  orientation: number
): Promise<{ file: File; thumbnailBlob: Blob; workerUsed: boolean }> {
  let buffer = await file.arrayBuffer();
  const mimeType = file.type || 'image/jpeg';

  try {
    if (uploadWorkerPool.isSupported()) {
      const result = await ingestViaWorker(
        buffer,
        mimeType,
        file.name,
        orientation
      );
      buffer = new ArrayBuffer(0);
      return { ...result, workerUsed: true };
    }

    const result = await ingestOnMainThread(
      buffer,
      mimeType,
      file.name,
      orientation
    );
    buffer = new ArrayBuffer(0);
    return { ...result, workerUsed: false };
  } finally {
    buffer = new ArrayBuffer(0);
  }
}

/**
 * Ingest a single photo file: decode if needed, normalize EXIF orientation,
 * produce thumbnail — single-pass where possible.
 */
export async function ingestPhotoFile(file: File): Promise<IngestResult> {
  const timings: IngestResult['timings'] = {};
  let workingFile = file;
  let sourceFormat: ImportFormat = await detectImportFormat(file);
  let decoded = false;

  if (isHeicOrHeifFormat(sourceFormat)) {
    const decodeStart = performance.now();
    workingFile = await decodeHeicToJpegFile(file);
    timings.decodeMs = Math.round(performance.now() - decodeStart);
    sourceFormat = 'jpeg';
    decoded = true;
  } else if (isAvifFormat(sourceFormat)) {
    const decodeStart = performance.now();
    workingFile = await decodeAvifToJpegFile(file);
    timings.decodeMs = Math.round(performance.now() - decodeStart);
    sourceFormat = 'jpeg';
    decoded = true;
  }

  const orientation = await readExifOrientation(workingFile);
  const exifNormalized = needsOrientationNormalize(orientation);
  const useSlowPath = decoded || exifNormalized;

  if (!useSlowPath) {
    const thumbStart = performance.now();
    const thumbnailBlob = await createThumbnailFromFile(workingFile);
    timings.thumbnailMs = Math.round(performance.now() - thumbStart);

    return {
      file: workingFile,
      thumbnailBlob,
      sourceFormat,
      exifNormalized: false,
      workerUsed: false,
      decoded: false,
      timings,
    };
  }

  const normalizeStart = performance.now();
  const { file: normalizedFile, thumbnailBlob, workerUsed } =
    await runSlowPathIngest(workingFile, orientation);
  timings.normalizeMs = Math.round(performance.now() - normalizeStart);
  timings.thumbnailMs = 0;

  return {
    file: normalizedFile,
    thumbnailBlob,
    sourceFormat,
    exifNormalized: exifNormalized || decoded,
    workerUsed,
    decoded,
    timings,
  };
}
