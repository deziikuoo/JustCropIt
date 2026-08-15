import { Zip, ZipPassThrough } from 'fflate';

/**
 * Streaming ZIP writer.
 *
 * JSZip keeps every input file in the JS heap until `generateAsync`, then
 * concatenates the whole archive into one contiguous buffer and copies it again
 * into a Blob. At a few hundred photos that peak exceeds what the tab can
 * allocate, and Chrome reports the failed download as "Check internet
 * connection".
 *
 * Here each file is pushed straight through the encoder and the output is
 * flushed into disk-backed Blob parts, so heap usage stays flat no matter how
 * large the archive gets.
 */

const FLUSH_THRESHOLD_BYTES = 16 * 1024 * 1024;

export interface StreamingZipWriter {
  /** Adds one entry. Returns the (possibly de-duplicated) name used. */
  add(fileName: string, data: ArrayBuffer | Uint8Array): string;
  /** Closes the archive and resolves the finished Blob. */
  finish(): Promise<Blob>;
  /** Number of entries added so far. */
  readonly fileCount: number;
}

function uniqueName(taken: Set<string>, fileName: string): string {
  if (!taken.has(fileName)) {
    taken.add(fileName);
    return fileName;
  }

  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';

  let counter = 2;
  let candidate = `${stem} (${counter})${ext}`;
  while (taken.has(candidate)) {
    counter += 1;
    candidate = `${stem} (${counter})${ext}`;
  }

  taken.add(candidate);
  return candidate;
}

export function createStreamingZip(): StreamingZipWriter {
  const parts: Blob[] = [];
  const takenNames = new Set<string>();
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let count = 0;
  let failure: Error | null = null;

  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const flush = (): void => {
    if (pending.length === 0) return;
    parts.push(new Blob(pending as BlobPart[]));
    pending = [];
    pendingBytes = 0;
  };

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failure = error;
      rejectDone(error);
      return;
    }

    if (chunk && chunk.length > 0) {
      pending.push(chunk);
      pendingBytes += chunk.length;
      if (pendingBytes >= FLUSH_THRESHOLD_BYTES) {
        flush();
      }
    }

    if (final) {
      flush();
      resolveDone();
    }
  });

  return {
    get fileCount() {
      return count;
    },

    add(fileName, data) {
      if (failure) throw failure;

      const name = uniqueName(takenNames, fileName);
      // Photos are already compressed; STORE avoids a pointless deflate pass.
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      entry.push(
        data instanceof Uint8Array ? data : new Uint8Array(data),
        true
      );
      count += 1;
      return name;
    },

    async finish() {
      zip.end();
      await done;
      return new Blob(parts, { type: 'application/zip' });
    },
  };
}
