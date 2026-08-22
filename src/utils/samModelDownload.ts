/**
 * Pre-download SAM weights into OPFS with byte progress so sam-web hits cache.
 */

import { getModelConfig } from 'sam-web';
import {
  SAM_MODEL_CACHE_FILES,
  SAM_MODEL_EXPECTED_BYTES,
  SAM_OBJECT_MODEL_ID,
} from '../constants/optimization';
import { isSamModelCached, removeSamModelCache } from './samModelCache';

export interface SamDownloadProgress {
  current: number;
  total: number;
  label: string;
  phase: 'download' | 'load';
  cancelling: boolean;
  startedAt: number;
}

const listeners = new Set<(progress: SamDownloadProgress | null) => void>();
let progress: SamDownloadProgress | null = null;
let downloadPromise: Promise<boolean> | null = null;
let abortController: AbortController | null = null;

function setProgress(next: SamDownloadProgress | null) {
  progress = next;
  for (const listener of listeners) listener(next);
}

export function getSamDownloadProgress(): SamDownloadProgress | null {
  return progress;
}

export function subscribeSamDownloadProgress(
  listener: (next: SamDownloadProgress | null) => void
): () => void {
  listeners.add(listener);
  listener(progress);
  return () => {
    listeners.delete(listener);
  };
}

export function formatSamDownloadBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 0.1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

export function cancelSamModelDownload(): void {
  if (!progress || progress.cancelling) return;
  setProgress({ ...progress, cancelling: true });
  abortController?.abort();
  void import('./webSamSession').then(({ disposeSamSession }) => {
    disposeSamSession();
  });
}

async function cachedFileSize(filename: string): Promise<number | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return null;
  }
  try {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(filename)).getFile();
    return file.size > 0 ? file.size : null;
  } catch {
    return null;
  }
}

async function writeOpfsFile(
  filename: string,
  response: Response,
  onBytes: (delta: number, contentLength: number | null) => void,
  signal: AbortSignal
): Promise<void> {
  if (!response.body) {
    throw new Error('Model download had no body');
  }
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  const reader = response.body.getReader();
  const contentLength = Number(response.headers.get('content-length'));
  const knownLength = Number.isFinite(contentLength) && contentLength > 0
    ? contentLength
    : null;

  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      await writable.write(value);
      onBytes(value.byteLength, knownLength);
    }
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      /* ignore */
    }
    try {
      await root.removeEntry(filename);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

function modelFiles(): Array<{ url: string; filename: string; expectedBytes: number }> {
  const config = getModelConfig(SAM_OBJECT_MODEL_ID);
  return [
    {
      url: config.encoderUrl,
      filename: config.encoderUrl.split('/').pop() ?? SAM_MODEL_CACHE_FILES[0],
      expectedBytes: SAM_MODEL_EXPECTED_BYTES[SAM_MODEL_CACHE_FILES[0]],
    },
    {
      url: config.decoderUrl,
      filename: config.decoderUrl.split('/').pop() ?? SAM_MODEL_CACHE_FILES[1],
      expectedBytes: SAM_MODEL_EXPECTED_BYTES[SAM_MODEL_CACHE_FILES[1]],
    },
  ];
}

async function downloadMissingModels(signal: AbortSignal): Promise<void> {
  const files = modelFiles();
  const pending: typeof files = [];
  let alreadyHave = 0;

  for (const file of files) {
    const size = await cachedFileSize(file.filename);
    if (size != null) {
      alreadyHave += size;
    } else {
      pending.push(file);
    }
  }

  if (pending.length === 0) return;

  const pendingExpected = pending.reduce((sum, file) => sum + file.expectedBytes, 0);
  let received = 0;
  let pendingKnown = pendingExpected;
  const startedAt = Date.now();

  setProgress({
    current: alreadyHave,
    total: alreadyHave + pendingKnown,
    label: 'Downloading object finder',
    phase: 'download',
    cancelling: false,
    startedAt,
  });

  for (const file of pending) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await fetch(file.url, { mode: 'cors', signal });
    if (!response.ok) {
      throw new Error(`Model download failed (${response.status})`);
    }

    const headerLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(headerLength) && headerLength > 0) {
      pendingKnown += headerLength - file.expectedBytes;
    }

    await writeOpfsFile(
      file.filename,
      response,
      (delta, contentLength) => {
        received += delta;
        if (contentLength && contentLength !== file.expectedBytes) {
          /* total already adjusted once from header */
        }
        setProgress({
          current: alreadyHave + received,
          total: Math.max(alreadyHave + pendingKnown, alreadyHave + received),
          label: 'Downloading object finder',
          phase: 'download',
          cancelling: false,
          startedAt,
        });
      },
      signal
    );
  }
}

/**
 * @returns true if a network download ran this call
 */
export async function ensureSamModelsDownloaded(): Promise<boolean> {
  if (await isSamModelCached()) return false;
  if (downloadPromise) return downloadPromise;

  abortController = new AbortController();
  const signal = abortController.signal;

  downloadPromise = (async () => {
    try {
      await downloadMissingModels(signal);
      return true;
    } catch (error) {
      if (signal.aborted) {
        await removeSamModelCache();
        throw new DOMException('Aborted', 'AbortError');
      }
      throw error;
    } finally {
      setProgress(null);
      downloadPromise = null;
      abortController = null;
    }
  })();

  return downloadPromise;
}

export function beginSamLoadProgress(): void {
  setProgress({
    current: 1,
    total: 1,
    label: 'Loading object finder',
    phase: 'load',
    cancelling: false,
    startedAt: Date.now(),
  });
}

export function clearSamDownloadProgress(): void {
  setProgress(null);
}
