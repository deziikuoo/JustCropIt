export function blobToFile(
  blob: Blob,
  fileName: string,
  mimeType: string
): File {
  return new File([blob], fileName, { type: mimeType });
}

export type BlobToFileFn = typeof blobToFile;
