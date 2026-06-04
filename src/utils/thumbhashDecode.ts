import { thumbHashToDataURL } from 'thumbhash';

const DECODE_CACHE_MAX = 64;
const decodeCache = new Map<string, string>();

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function touchDecodeCache(key: string, value: string): string {
  decodeCache.delete(key);
  decodeCache.set(key, value);

  while (decodeCache.size > DECODE_CACHE_MAX) {
    const oldestKey = decodeCache.keys().next().value;
    if (oldestKey === undefined) break;
    decodeCache.delete(oldestKey);
  }

  return value;
}

export function thumbhashToDataUrl(base64Hash: string): string | null {
  const cached = decodeCache.get(base64Hash);
  if (cached) {
    return touchDecodeCache(base64Hash, cached);
  }

  try {
    const hashBytes = base64ToBytes(base64Hash);
    const dataUrl = thumbHashToDataURL(hashBytes);
    return touchDecodeCache(base64Hash, dataUrl);
  } catch (error) {
    console.warn('Failed to decode thumbhash:', error);
    return null;
  }
}
