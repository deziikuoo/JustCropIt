export type PhotoImportOrigin = 'device' | 'video';

export interface Photo {
  id?: string;
  original: File;
  current: File;
  /** Download / display name; OPFS Files are often named original.bin. */
  fileName?: string;
  thumbnail?: File | null;
  thumbhash?: string | null;
  thumbRevision: number;
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
  /** Writable handle from Chromium showOpenFilePicker. Missing on fallback input / video frames. */
  fileHandle?: FileSystemFileHandle;
  /** Device uploads can offer replace-original. Video frames are copy-only. */
  importOrigin?: PhotoImportOrigin;
}

export function isDeviceImportedPhoto(photo: Photo): boolean {
  return photo.importOrigin !== 'video';
}
