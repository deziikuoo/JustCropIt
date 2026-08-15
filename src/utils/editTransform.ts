import type { Photo } from '../types/photo';

/**
 * Flips can stay metadata-only (CSS preview) until export when there is
 * no crop/rotation baked into photo.current.
 */
export function usesDeferredFlips(photo: Pick<Photo, 'crop' | 'rotation'>): boolean {
  return !photo.crop && !photo.rotation;
}

/** True when flips are pending a pixel bake at export time. */
export function hasPendingFlipBake(
  photo: Pick<Photo, 'crop' | 'rotation' | 'flips'>
): boolean {
  return (
    usesDeferredFlips(photo) &&
    (photo.flips.horizontal || photo.flips.vertical)
  );
}

/** CSS transform for deferred flip preview (no pixel bake). */
export function getDeferredFlipCssTransform(
  flips: { horizontal: boolean; vertical: boolean }
): string | undefined {
  const sx = flips.horizontal ? -1 : 1;
  const sy = flips.vertical ? -1 : 1;
  if (sx === 1 && sy === 1) return undefined;
  return `scale(${sx}, ${sy})`;
}
