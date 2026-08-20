export interface Photo {
  id?: string;
  original: File;
  current: File;
  thumbnail?: File | null;
  thumbhash?: string | null;
  thumbRevision: number;
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
}
