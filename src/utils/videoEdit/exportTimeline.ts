/**
 * Orchestrates rendering the full Edit-tab timeline to a single downloadable
 * video file. Hardware encode (WebCodecs VideoEncoder) is tried first;
 * FFmpeg WASM is the fallback. This module adapts Clip[] -> ClipRenderSpec[].
 */
import type { Clip, TimelineRenderProgress } from '../../types/videoEdit';
import { toClipRenderSpec } from '../../types/videoEdit';
import { flattenClipsForRender } from './compoundClip';
import { videoWorkerPool } from '../videoWorkerPool';
import { prefersMainThreadHardwareExport } from '../webCodecs/hardwareExportGate';

export async function exportTimelineToVideo(
  videoFile: File,
  clips: Clip[],
  onProgress?: (progress: TimelineRenderProgress) => void
): Promise<{ blob: Blob; fileName: string }> {
  const leaves = flattenClipsForRender(clips);
  if (leaves.length === 0) {
    throw new Error('Timeline is empty — nothing to export');
  }

  const specs = leaves.map(toClipRenderSpec);
  return videoWorkerPool.exportTimeline(videoFile, specs, onProgress);
}

export async function downloadRenderedVideo(blob: Blob, fileName: string): Promise<void> {
  const file = new File([blob], fileName, { type: blob.type || 'video/mp4' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  // iOS ignores <a download>, so the share sheet is what actually saves the file.
  if (
    prefersMainThreadHardwareExport() &&
    typeof nav.share === 'function' &&
    (!nav.canShare || nav.canShare({ files: [file] }))
  ) {
    try {
      await nav.share({ files: [file], title: fileName });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
