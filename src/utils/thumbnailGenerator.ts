import {
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_EDGE_PX,
  getThumbnailCacheKey,
} from '../constants/optimization';

export { getThumbnailCacheKey };

export function computeThumbnailDimensions(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions for thumbnail');
  }

  if (width <= maxEdge && height <= maxEdge) {
    return { width, height };
  }

  if (width >= height) {
    return {
      width: maxEdge,
      height: Math.max(1, Math.round((height * maxEdge) / width)),
    };
  }

  return {
    width: Math.max(1, Math.round((width * maxEdge) / height)),
    height: maxEdge,
  };
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode thumbnail'));
      },
      'image/jpeg',
      quality
    );
  });
}

async function readImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

async function encodeThumbnailFromBitmap(
  source: ImageBitmap | CanvasImageSource,
  width: number,
  height: number,
  quality: number
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context for thumbnail');
  }
  ctx.drawImage(source, 0, 0, width, height);
  if (source instanceof ImageBitmap) {
    source.close();
  }
  return canvasToJpegBlob(canvas, quality);
}

async function createThumbnailViaResizeBitmap(
  file: File,
  width: number,
  height: number,
  quality: number
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, {
    resizeWidth: width,
    resizeHeight: height,
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    return await encodeThumbnailFromBitmap(bitmap, width, height, quality);
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

async function createThumbnailViaImageElement(
  file: File,
  width: number,
  height: number,
  quality: number
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image for thumbnail'));
      img.src = url;
    });
    return encodeThumbnailFromBitmap(image, width, height, quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function createThumbnailFromFile(
  file: File,
  maxEdge: number = THUMBNAIL_MAX_EDGE_PX,
  quality: number = THUMBNAIL_JPEG_QUALITY
): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`Unsupported file type for thumbnail: ${file.type || 'unknown'}`);
  }

  const { width: sourceWidth, height: sourceHeight } =
    await readImageDimensions(file);
  const { width, height } = computeThumbnailDimensions(
    sourceWidth,
    sourceHeight,
    maxEdge
  );

  try {
    return await createThumbnailViaResizeBitmap(file, width, height, quality);
  } catch {
    return createThumbnailViaImageElement(file, width, height, quality);
  }
}
