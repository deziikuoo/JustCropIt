import { UPLOAD_DECODE_JPEG_QUALITY } from '../../constants/optimization';
import { jpegFileNameFromOriginal } from './formatDetector';

type Heic2AnyFn = (options: {
  blob: Blob;
  toType: string;
  quality?: number;
}) => Promise<Blob | Blob[]>;

let heic2anyLoader: Promise<Heic2AnyFn> | null = null;

async function loadHeic2Any(): Promise<Heic2AnyFn> {
  if (!heic2anyLoader) {
    heic2anyLoader = import('heic2any').then((mod) => {
      const fn = mod.default as Heic2AnyFn;
      return fn;
    });
  }
  return heic2anyLoader;
}

/**
 * Decode HEIC/HEIF to JPEG File. WASM loads lazily on first call.
 */
export async function decodeHeicToJpegFile(file: File): Promise<File> {
  const heic2any = await loadHeic2Any();

  const result = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: UPLOAD_DECODE_JPEG_QUALITY,
  });

  const blob = Array.isArray(result) ? result[0] : result;
  if (!blob) {
    throw new Error(`HEIC decode produced no output for ${file.name}`);
  }

  return new File([blob], jpegFileNameFromOriginal(file.name), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}
