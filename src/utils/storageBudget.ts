/**
 * Effective storage budget: min(app cap, browser quota) with OS reserve.
 * A 500GB app cap never overrides a 20GB free disk / private-window quota.
 */

/** App hard ceiling (GiB). Effective budget is always min(this, browser quota − reserve). */
export const STORAGE_LIMIT_HARD_BYTES = 500 * 1024 * 1024 * 1024;
/** Soft warn when usage ≥ this fraction of the *effective* budget. */
export const STORAGE_SOFT_WARN_RATIO = 0.8;
/** Hard stop when browser reports ≥ this fraction of its own quota. */
export const STORAGE_BROWSER_HARD_RATIO = 0.95;
/** Soft warn when browser reports ≥ this fraction of its own quota. */
export const STORAGE_BROWSER_SOFT_RATIO = 0.8;

const RESERVE_BYTES_CAP = 2 * 1024 * 1024 * 1024; // 2 GiB
const RESERVE_RATIO = 0.05;
const RESERVE_BYTES_FLOOR = 256 * 1024 * 1024; // 256 MiB

export interface StorageEstimate {
  usage: number;
  /** Raw browser quota (0 if unknown). */
  browserQuota: number;
  available: number;
  percentage: number;
}

export interface EffectiveBudget {
  /** Bytes the app may use (≤ HARD, ≤ browser quota − reserve). */
  effectiveHard: number;
  softWarnAt: number;
  usage: number;
  browserQuota: number;
  available: number;
  /** Why the budget is below HARD, if known. */
  limitingFactor: 'app-cap' | 'browser-quota' | 'unknown';
}

function osReserve(browserQuota: number): number {
  if (browserQuota <= 0) return RESERVE_BYTES_FLOOR;
  const byRatio = Math.floor(browserQuota * RESERVE_RATIO);
  return Math.max(
    RESERVE_BYTES_FLOOR,
    Math.min(RESERVE_BYTES_CAP, byRatio)
  );
}

export async function readStorageEstimate(): Promise<StorageEstimate> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const browserQuota = estimate.quota || 0;
      const available = Math.max(0, browserQuota - usage);
      const percentage =
        browserQuota > 0 ? (usage / browserQuota) * 100 : 0;
      return { usage, browserQuota, available, percentage };
    } catch {
      // fall through
    }
  }
  return {
    usage: 0,
    browserQuota: 0,
    available: STORAGE_LIMIT_HARD_BYTES,
    percentage: 0,
  };
}

export function computeEffectiveBudget(
  estimate: StorageEstimate
): EffectiveBudget {
  const { usage, browserQuota, available } = estimate;

  let effectiveHard = STORAGE_LIMIT_HARD_BYTES;
  let limitingFactor: EffectiveBudget['limitingFactor'] = 'app-cap';

  if (browserQuota > 0) {
    const reserve = osReserve(browserQuota);
    const browserBudget = Math.max(0, browserQuota - reserve);
    if (browserBudget < effectiveHard) {
      effectiveHard = browserBudget;
      limitingFactor = 'browser-quota';
    }
  } else {
    limitingFactor = 'unknown';
  }

  const softWarnAt = Math.floor(effectiveHard * STORAGE_SOFT_WARN_RATIO);
  // Prefer live available when we know browser quota; else room under effective hard.
  const effectiveAvailable =
    browserQuota > 0
      ? Math.min(available, Math.max(0, effectiveHard - usage))
      : Math.max(0, effectiveHard - usage);

  return {
    effectiveHard,
    softWarnAt,
    usage,
    browserQuota,
    available: effectiveAvailable,
    limitingFactor,
  };
}

export function formatGiB(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}

export function formatMiB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(0);
}

/**
 * Rough preflight: will `fileCount` files of `typicalBytes` fit?
 */
export function estimateJobFits(
  fileCount: number,
  typicalBytes: number,
  budget: EffectiveBudget
): { fits: boolean; needed: number; available: number; message?: string } {
  const needed = fileCount * typicalBytes * 1.2;
  const available = budget.available;
  if (needed <= available) {
    return { fits: true, needed, available };
  }
  const reason =
    budget.limitingFactor === 'browser-quota'
      ? 'browser/disk quota'
      : budget.limitingFactor === 'app-cap'
        ? 'app storage cap'
        : 'available storage';
  return {
    fits: false,
    needed,
    available,
    message: `This job needs about ${formatGiB(needed)} GB but only ${formatGiB(
      available
    )} GB is available (${reason}). Import fewer frames, use JPEG, or free disk space.`,
  };
}
