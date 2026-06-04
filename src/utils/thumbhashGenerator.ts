import { rgbaToThumbHash } from 'thumbhash';
import { computeThumbnailDimensions } from './thumbnailGenerator';

export const THUMBHASH_MAX_EDGE_PX = 100;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function createThumbhashFromBlob(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const { width, height } = computeThumbnailDimensions(
        bitmap.width,
        bitmap.height,
        THUMBHASH_MAX_EDGE_PX
      );

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return null;
      }

      ctx.drawImage(bitmap, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const hashBytes = rgbaToThumbHash(width, height, imageData.data);
      return bytesToBase64(hashBytes);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    console.warn('Failed to generate thumbhash:', error);
    return null;
  }
}
