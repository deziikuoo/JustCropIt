import { GRID_URL_LRU_MAX } from '../constants/optimization';

interface CacheEntry {
  url: string;
  lastAccess: number;
}

export class GridUrlCache {
  private entries = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize: number = GRID_URL_LRU_MAX) {
    this.maxSize = maxSize;
  }

  get size(): number {
    return this.entries.size;
  }

  getOrCreate(key: string, factory: () => string): string {
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastAccess = Date.now();
      return existing.url;
    }

    const url = factory();
    this.entries.set(key, { url, lastAccess: Date.now() });
    this.evictLRU();
    return url;
  }

  touch(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.lastAccess = Date.now();
    }
  }

  revoke(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    URL.revokeObjectURL(entry.url);
    this.entries.delete(key);
  }

  evictLRU(): void {
    while (this.entries.size > this.maxSize) {
      let oldestKey: string | null = null;
      let oldestAccess = Infinity;

      for (const [key, entry] of this.entries) {
        if (entry.lastAccess < oldestAccess) {
          oldestAccess = entry.lastAccess;
          oldestKey = key;
        }
      }

      if (oldestKey === null) break;
      this.revoke(oldestKey);
    }
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) {
      this.revoke(key);
    }
  }
}
