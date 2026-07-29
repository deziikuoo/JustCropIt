import type { ImportFormat } from '../../types/import';

const HEIC_EXTENSIONS = new Set(['heic', 'heif']);
const AVIF_EXTENSIONS = new Set(['avif']);

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

function mimeToFormat(mime: string): ImportFormat | null {
  const normalized = mime.toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpeg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/heic' || normalized === 'image/heif') return 'heic';
  if (normalized === 'image/avif') return 'avif';
  return null;
}

async function sniffFormatFromBytes(file: File): Promise<ImportFormat | null> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  // JPEG SOI
  if (header[0] === 0xff && header[1] === 0xd8) return 'jpeg';

  // PNG signature
  if (
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47
  ) {
    return 'png';
  }

  // ISO BMFF (HEIC / AVIF): ....ftypXXXX
  if (header.length >= 12) {
    const brand = String.fromCharCode(
      header[8],
      header[9],
      header[10],
      header[11]
    ).toLowerCase();

    if (
      brand.includes('heic') ||
      brand.includes('heix') ||
      brand.includes('hevc') ||
      brand.includes('mif1')
    ) {
      return 'heic';
    }

    if (brand.includes('avif') || brand.includes('avis')) {
      return 'avif';
    }
  }

  // WebP: RIFF....WEBP
  if (
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header.length >= 12 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return 'webp';
  }

  return null;
}

export async function detectImportFormat(file: File): Promise<ImportFormat> {
  const ext = extensionOf(file.name);

  if (HEIC_EXTENSIONS.has(ext)) return 'heic';
  if (AVIF_EXTENSIONS.has(ext)) return 'avif';

  if (file.type) {
    const fromMime = mimeToFormat(file.type);
    if (fromMime) return fromMime;
  }

  const sniffed = await sniffFormatFromBytes(file);
  if (sniffed) return sniffed;

  if (file.type.startsWith('image/')) return 'unknown';
  return 'unknown';
}

export function isHeicOrHeifFormat(format: ImportFormat): boolean {
  return format === 'heic' || format === 'heif';
}

export function isAvifFormat(format: ImportFormat): boolean {
  return format === 'avif';
}

export function needsDecodeStep(format: ImportFormat): boolean {
  return isHeicOrHeifFormat(format) || isAvifFormat(format);
}

/**
 * Whether a file is eligible for the photo import pipeline.
 */
export async function isSupportedImportFile(file: File): Promise<boolean> {
  const format = await detectImportFormat(file);
  if (format !== 'unknown') return true;
  return file.type.startsWith('image/');
}

/**
 * Pre-scan batch for slow-path candidates (HEIC/AVIF) to pick chunk size.
 */
export async function batchHasSlowPathCandidate(
  files: File[]
): Promise<boolean> {
  for (const file of files) {
    const format = await detectImportFormat(file);
    if (needsDecodeStep(format)) return true;
  }
  return false;
}

export function jpegFileNameFromOriginal(originalName: string): string {
  return originalName.replace(/\.[^.]+$/, '.jpg');
}
