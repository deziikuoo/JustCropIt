/**
 * Unique names for download jobs so later zips / files do not overwrite
 * earlier ones in the user's Downloads folder.
 */

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Local timestamp unique enough for back-to-back downloads. */
export function createDownloadStamp(now = new Date()): string {
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-` +
    `${pad(now.getMilliseconds(), 3)}`
  );
}

function safeFileName(fileName: string, fallback: string): string {
  const trimmed = fileName.replace(/[/\\]/g, '_').trim();
  return trimmed || fallback;
}

/** Prefix a file so two download jobs never share the same name. */
export function stampDownloadFileName(fileName: string, stamp: string): string {
  return `${stamp}_${safeFileName(fileName, 'file')}`;
}

/** Append a stamp before the .zip extension. */
export function stampDownloadZipName(zipName: string, stamp: string): string {
  const safe = safeFileName(zipName, 'download.zip');
  if (/\.zip$/i.test(safe)) {
    return `${safe.slice(0, -4)}-${stamp}.zip`;
  }
  return `${safe}-${stamp}.zip`;
}
