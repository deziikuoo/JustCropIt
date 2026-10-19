/**
 * Cheap pre-check for hardware Edit export. Kept off hardwareExport.ts so the
 * main thread does not pull mediabunny into the UI bundle.
 */

import type { ClipRenderSpec } from '../../types/videoEdit';
import {
  clipIsPassthrough,
  planUniqueRenders,
  uniqueClipsShareOutputSize,
} from '../videoEdit/clipRenderFingerprint';
import { isVideoEncoderSupported } from './support';

export function shouldTryHardwareTimelineExport(clips: ClipRenderSpec[]): boolean {
  if (!isVideoEncoderSupported()) return false;
  const plan = planUniqueRenders(clips);
  const uniqueClips = plan.uniqueKeys.map((key) => plan.clipByKey.get(key)!);
  if (uniqueClips.every(clipIsPassthrough)) return false;
  return uniqueClipsShareOutputSize(uniqueClips);
}

/**
 * Phones and tablets. VideoEncoder inside a worker often never fires
 * `dequeue` (Android) or is missing entirely (iOS), so the export sits on
 * "Encoding unique clip" forever. The main thread encoder drains.
 */
export function prefersMainThreadHardwareExport(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS reports a desktop Mac UA but still has a touch screen.
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return (
    window.matchMedia('(pointer: coarse)').matches &&
    window.matchMedia('(hover: none)').matches
  );
}
