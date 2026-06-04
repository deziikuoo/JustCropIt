export interface Photo {
  id?: string;
  original: File;
  current: File;
  thumbnail?: File | null;
  thumbhash?: string | null;
  thumbRevision: number;
  cropHistory: Blob[];
  cropFuture: Blob[];
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
}
