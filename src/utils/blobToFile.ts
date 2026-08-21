/**
 * Infer a usable image MIME when OPFS / File System Access returns
 * application/octet-stream for .bin blobs.
 */
export function resolveImageMimeType(
  blob: Blob,
  fileName?: string
): string {
  const type = (blob.type || '').toLowerCase();
  if (type.startsWith('image/')) {
    return blob.type;
  }

  const name = fileName || (blob instanceof File ? blob.name : '') || '';
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'image/jpeg';
  }
}

function isOpfsBinName(name: string): boolean {
  return name === 'original.bin' || name === 'current.bin';
}

/** User-facing file name (OPFS hydrate keeps `original.bin` on the File itself). */
export function photoFileName(photo: {
  fileName?: string;
  current?: File;
  original?: File;
}): string {
  if (photo.fileName && !isOpfsBinName(photo.fileName)) {
    return photo.fileName;
  }
  const currentName = photo.current?.name;
  if (currentName && !isOpfsBinName(currentName)) return currentName;
  const originalName = photo.original?.name;
  if (originalName && !isOpfsBinName(originalName)) return originalName;
  return photo.fileName || currentName || originalName || 'photo.jpg';
}

/**
 * Prefer the existing File object — `new File([blob])` copies every byte.
 * OPFS `getFile()` already returns a File; only wrap plain Blobs (e.g. IDB thumbs).
 */
export function blobToFile(
  blob: Blob,
  fileName: string,
  mimeType?: string
): File {
  if (blob instanceof File) {
    return blob;
  }
  const type = mimeType || resolveImageMimeType(blob, fileName);
  return new File([blob], fileName, { type });
}

export type BlobToFileFn = typeof blobToFile;
