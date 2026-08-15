/**
 * Persists the video extraction tab session across page refreshes.
 * Uses IndexedDB with a session-level 24h expiry (independent of photo expiry).
 */

import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { VideoInfo } from '../types/video';

const DB_NAME = 'justcropit-video-session';
const DB_VERSION = 2;
const STORE_NAME = 'session';
const SESSION_KEY = 'current';

/** Video-tab session lifetime; independent of photo expiresAt timers. */
export const VIDEO_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface PersistedExtractedFrame {
  index: number;
  timestamp: number;
  blob: Blob;
  fileName: string;
  mimeType: string;
}

export interface VideoSessionData {
  id: typeof SESSION_KEY;
  video: Blob;
  videoName: string;
  videoType: string;
  videoInfo: VideoInfo | null;
  intervalMs: number;
  outputFormat: 'png' | 'jpeg';
  quality: number;
  trimStart: number;
  trimEnd: number;
  extractedFrames: PersistedExtractedFrame[];
  /** Last time this record was written (diagnostics / sliding save marker). */
  savedAt: number;
  /** When this video session was first created — starts the 24h clock. */
  createdAt: number;
  /** Absolute expiry time; not refreshed on subsequent persists. */
  expiresAt: number;
}

interface VideoSessionDB extends DBSchema {
  session: {
    key: string;
    value: VideoSessionData;
  };
}

let db: IDBPDatabase<VideoSessionDB> | null = null;

async function getDB(): Promise<IDBPDatabase<VideoSessionDB>> {
  if (db) return db;

  db = await openDB<VideoSessionDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });

  return db;
}

/** Copy blob bytes so Vue proxies / File wrappers are not passed to IndexedDB. */
function toStorableBlob(blob: Blob): Blob {
  return blob.slice(0, blob.size, blob.type);
}

function toPlainVideoInfo(info: VideoInfo | null): VideoInfo | null {
  if (!info) return null;
  return {
    duration: info.duration,
    width: info.width,
    height: info.height,
    ...(info.frameRate != null ? { frameRate: info.frameRate } : {}),
    ...(info.codec != null ? { codec: info.codec } : {}),
  };
}

function resolveExpiry(record: {
  expiresAt?: number;
  createdAt?: number;
  savedAt: number;
}): { createdAt: number; expiresAt: number } {
  const createdAt = record.createdAt ?? record.savedAt;
  const expiresAt = record.expiresAt ?? createdAt + VIDEO_SESSION_TTL_MS;
  return { createdAt, expiresAt };
}

export type VideoSessionPersistInput = Omit<
  VideoSessionData,
  'id' | 'savedAt'
>;

export async function saveVideoSession(
  data: VideoSessionPersistInput
): Promise<void> {
  const database = await getDB();
  const now = Date.now();
  const record: VideoSessionData = {
    id: SESSION_KEY,
    savedAt: now,
    createdAt: data.createdAt,
    expiresAt: data.expiresAt,
    video: toStorableBlob(data.video),
    videoName: data.videoName,
    videoType: data.videoType,
    videoInfo: toPlainVideoInfo(data.videoInfo),
    intervalMs: data.intervalMs,
    outputFormat: data.outputFormat,
    quality: data.quality,
    trimStart: data.trimStart,
    trimEnd: data.trimEnd,
    extractedFrames: data.extractedFrames.map((frame) => ({
      index: frame.index,
      timestamp: frame.timestamp,
      blob: toStorableBlob(frame.blob),
      fileName: frame.fileName,
      mimeType: frame.mimeType,
    })),
  };
  await database.put(STORE_NAME, record);
}

export async function loadVideoSession(): Promise<VideoSessionData | null> {
  const database = await getDB();
  const record = await database.get(STORE_NAME, SESSION_KEY);
  if (!record) return null;

  const { createdAt, expiresAt } = resolveExpiry(record);
  if (Date.now() >= expiresAt) {
    await clearVideoSession();
    return null;
  }

  return {
    ...record,
    createdAt,
    expiresAt,
  };
}

export async function clearVideoSession(): Promise<void> {
  const database = await getDB();
  await database.delete(STORE_NAME, SESSION_KEY);
}

/** Deletes the video session if its independent 24h timer has elapsed. */
export async function cleanupExpiredVideoSession(): Promise<boolean> {
  const database = await getDB();
  const record = await database.get(STORE_NAME, SESSION_KEY);
  if (!record) return false;

  const { expiresAt } = resolveExpiry(record);
  if (Date.now() < expiresAt) return false;

  await database.delete(STORE_NAME, SESSION_KEY);
  return true;
}
