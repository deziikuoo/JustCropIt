/**
 * Persists the video extraction tab session across page refreshes.
 * Uses IndexedDB; session expires after 24 hours (aligned with photo cleanup).
 */

import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { VideoInfo } from '../types/video';

const DB_NAME = 'justcropit-video-session';
const DB_VERSION = 1;
const STORE_NAME = 'session';
const SESSION_KEY = 'current';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

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
  savedAt: number;
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

export async function saveVideoSession(data: Omit<VideoSessionData, 'id' | 'savedAt'>): Promise<void> {
  const database = await getDB();
  const record: VideoSessionData = {
    ...data,
    id: SESSION_KEY,
    savedAt: Date.now(),
  };
  await database.put(STORE_NAME, record);
}

export async function loadVideoSession(): Promise<VideoSessionData | null> {
  const database = await getDB();
  const record = await database.get(STORE_NAME, SESSION_KEY);
  if (!record) return null;

  if (Date.now() - record.savedAt > SESSION_TTL_MS) {
    await clearVideoSession();
    return null;
  }

  return record;
}

export async function clearVideoSession(): Promise<void> {
  const database = await getDB();
  await database.delete(STORE_NAME, SESSION_KEY);
}
