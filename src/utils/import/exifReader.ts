import exifr from 'exifr';

/**
 * Read EXIF Orientation tag only (fast parse).
 * Returns 1–8, or 1 if missing / unreadable.
 */
export async function readExifOrientation(file: File | Blob): Promise<number> {
  try {
    const result = await exifr.parse(file, { pick: ['Orientation'] });
    const orientation = result?.Orientation;

    if (
      typeof orientation === 'number' &&
      orientation >= 1 &&
      orientation <= 8
    ) {
      return orientation;
    }
  } catch (error) {
    console.warn('[exifReader] Failed to read orientation, defaulting to 1:', error);
  }

  return 1;
}
