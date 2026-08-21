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
}
