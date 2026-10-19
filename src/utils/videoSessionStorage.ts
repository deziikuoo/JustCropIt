/**
 * Persists the video extraction tab and Edit-tab timeline across refreshes.
 * Uses IndexedDB with a session-level 24h expiry (independent of photo expiry).
 */

import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { VideoInfo } from '../types/video';
import type { Clip, CropBox, FreezeSpec } from '../types/videoEdit';

const DB_NAME = 'justcropit-video-session';
const DB_VERSION = 3;
const STORE_NAME = 'session';
const EDIT_STORE_NAME = 'edit-session';
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

export interface VideoEditSessionData {
  id: typeof SESSION_KEY;
  video: Blob;
  videoName: string;
  videoType: string;
  videoInfo: VideoInfo | null;
  clips: Clip[];
  playheadTime: number;
  savedAt: number;
  createdAt: number;
  expiresAt: number;
}

interface VideoSessionDB extends DBSchema {
  session: {
    key: string;
    value: VideoSessionData;
  };
  'edit-session': {
    key: string;
    value: VideoEditSessionData;
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
      if (!database.objectStoreNames.contains(EDIT_STORE_NAME)) {
        database.createObjectStore(EDIT_STORE_NAME, { keyPath: 'id' });
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

export type VideoSessionPersistInput = Omit<VideoSessionData, 'id' | 'savedAt'>;

export async function saveVideoSession(data: VideoSessionPersistInput): Promise<void> {
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

const MAX_COMPOUND_DEPTH = 8;

function toPlainCrop(crop: CropBox | undefined): CropBox | undefined {
  if (!crop) return undefined;
  return {
    x: Number(crop.x) || 0,
    y: Number(crop.y) || 0,
    width: Number(crop.width) || 0,
    height: Number(crop.height) || 0,
  };
}

function toPlainFreeze(freeze: FreezeSpec | undefined): FreezeSpec | undefined {
  if (!freeze) return undefined;
  return {
    sourceTime: Number(freeze.sourceTime) || 0,
    durationSeconds: Number(freeze.durationSeconds) || 0,
  };
}

function toPlainClip(clip: Clip, depth = 0): Clip {
  const plain: Clip = {
    id: String(clip.id),
    sourceStart: Number(clip.sourceStart) || 0,
    sourceEnd: Number(clip.sourceEnd) || 0,
    speed: Number(clip.speed) > 0 ? Number(clip.speed) : 1,
    reversed: Boolean(clip.reversed),
  };
  const crop = toPlainCrop(clip.crop);
  if (crop) plain.crop = crop;
  const freeze = toPlainFreeze(clip.freeze);
  if (freeze) plain.freeze = freeze;
  if (clip.originClipId) plain.originClipId = String(clip.originClipId);
  if (clip.autoBuilt) plain.autoBuilt = true;
  if (depth < MAX_COMPOUND_DEPTH && Array.isArray(clip.children) && clip.children.length > 0) {
    plain.children = clip.children.map((child) => toPlainClip(child, depth + 1));
  }
  return plain;
}

export type VideoEditSessionPersistInput = Omit<VideoEditSessionData, 'id' | 'savedAt'>;

export async function saveVideoEditSession(data: VideoEditSessionPersistInput): Promise<void> {
  const database = await getDB();
  const now = Date.now();
  const record: VideoEditSessionData = {
    id: SESSION_KEY,
    savedAt: now,
    createdAt: data.createdAt,
    expiresAt: data.expiresAt,
    video: toStorableBlob(data.video),
    videoName: data.videoName,
    videoType: data.videoType,
    videoInfo: toPlainVideoInfo(data.videoInfo),
    clips: data.clips.map((clip) => toPlainClip(clip)),
    playheadTime: Number.isFinite(data.playheadTime) ? Math.max(0, data.playheadTime) : 0,
  };
  await database.put(EDIT_STORE_NAME, record);
}

export async function loadVideoEditSession(): Promise<VideoEditSessionData | null> {
  const database = await getDB();
  const record = await database.get(EDIT_STORE_NAME, SESSION_KEY);
  if (!record) return null;

  const { createdAt, expiresAt } = resolveExpiry(record);
  if (Date.now() >= expiresAt) {
    await clearVideoEditSession();
    return null;
  }

  return {
    ...record,
    clips: Array.isArray(record.clips) ? record.clips.map((clip) => toPlainClip(clip)) : [],
    playheadTime: Number.isFinite(record.playheadTime) ? Math.max(0, record.playheadTime) : 0,
    createdAt,
    expiresAt,
  };
}

export async function clearVideoEditSession(): Promise<void> {
  const database = await getDB();
  await database.delete(EDIT_STORE_NAME, SESSION_KEY);
}

/** Deletes the Edit-tab session if its independent 24h timer has elapsed. */
export async function cleanupExpiredVideoEditSession(): Promise<boolean> {
  const database = await getDB();
  const record = await database.get(EDIT_STORE_NAME, SESSION_KEY);
  if (!record) return false;

  const { expiresAt } = resolveExpiry(record);
  if (Date.now() < expiresAt) return false;

  await database.delete(EDIT_STORE_NAME, SESSION_KEY);
  return true;
}
