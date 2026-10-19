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
