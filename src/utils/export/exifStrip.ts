import { EXPORT_STRIP_JPEG_QUALITY } from '../../constants/optimization';
import { uploadWorkerPool } from '../uploadWorkerPool';

function outputMimeType(sourceMime: string): string {
  const normalized = sourceMime.toLowerCase();
  if (normalized === 'image/webp') return 'image/webp';
  return 'image/jpeg';
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to strip EXIF via canvas'));
      },
      mimeType,
      mimeType === 'image/jpeg' ? quality : undefined
    );
  });
}

async function stripExifOnMainThread(
  buffer: ArrayBuffer,
  mimeType: string,
  quality: number
): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(new Blob([buffer], { type: mimeType }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });

  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context for EXIF strip');

    ctx.drawImage(bitmap, 0, 0);

    const outputMime = outputMimeType(mimeType);
    const blob = await canvasToBlob(canvas, outputMime, quality);
    return blob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}

async function stripExifViaWorker(
  buffer: ArrayBuffer,
  mimeType: string,
  quality: number
): Promise<ArrayBuffer> {
  const id = `strip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const transferable = buffer.slice(0);

  const response = await uploadWorkerPool.submitTask(
    {
      id,
      type: 'stripExif',
      imageData: transferable,
      mimeType,
      jpegQuality: quality,
    },
    [transferable]
  );

  if (!response.success || !response.strippedBuffer) {
    throw new Error(response.error || 'Worker EXIF strip failed');
  }

  return response.strippedBuffer;
}

/**
 * Re-encode image bytes through canvas to drop EXIF metadata.
 */
export async function stripExifFromBuffer(
  buffer: ArrayBuffer,
  mimeType: string,
  quality: number = EXPORT_STRIP_JPEG_QUALITY
): Promise<{ buffer: ArrayBuffer; mimeType: string; workerUsed: boolean }> {
  if (uploadWorkerPool.isSupported()) {
    const stripped = await stripExifViaWorker(buffer, mimeType, quality);
    return {
      buffer: stripped,
      mimeType: outputMimeType(mimeType),
      workerUsed: true,
    };
  }

  const stripped = await stripExifOnMainThread(buffer, mimeType, quality);
  return {
    buffer: stripped,
    mimeType: outputMimeType(mimeType),
    workerUsed: false,
  };
}

export function mimeTypeCanCarryExif(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return (
    normalized === 'image/jpeg' ||
    normalized === 'image/jpg' ||
    normalized === 'image/webp'
  );
}
