import { UPLOAD_DECODE_JPEG_QUALITY } from '../../constants/optimization';
import { jpegFileNameFromOriginal } from './formatDetector';

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode AVIF decode output'));
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Decode AVIF to JPEG File using native createImageBitmap where supported.
 */
export async function decodeAvifToJpegFile(file: File): Promise<File> {
  if (typeof createImageBitmap === 'undefined') {
    throw new Error('AVIF decode requires createImageBitmap support');
  }

  const bitmap = await createImageBitmap(file, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });

  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context for AVIF decode');
    }

    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvasToJpegBlob(canvas, UPLOAD_DECODE_JPEG_QUALITY);

    return new File([blob], jpegFileNameFromOriginal(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}
