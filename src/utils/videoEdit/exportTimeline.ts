/**
 * Orchestrates rendering the full Edit-tab timeline to a single downloadable
 * video file. Hardware encode (WebCodecs VideoEncoder) is tried first;
 * FFmpeg WASM is the fallback. This module adapts Clip[] -> ClipRenderSpec[].
 */
import type { Clip, TimelineRenderProgress } from '../../types/videoEdit';
import { toClipRenderSpec } from '../../types/videoEdit';
import { flattenClipsForRender } from './compoundClip';
import { videoWorkerPool } from '../videoWorkerPool';

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

export function downloadRenderedVideo(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
