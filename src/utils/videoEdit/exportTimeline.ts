/**
 * Orchestrates rendering the full Edit-tab timeline to a single downloadable
 * video file. Actual FFmpeg work happens in the worker (videoWorker.ts);
 * this module just adapts Clip[] -> ClipRenderSpec[] and triggers the pool.
 */
import type { Clip, TimelineRenderProgress } from '../../types/videoEdit';
import { toClipRenderSpec } from '../../types/videoEdit';
import { videoWorkerPool } from '../videoWorkerPool';

export async function exportTimelineToVideo(
  videoFile: File,
  clips: Clip[],
  onProgress?: (progress: TimelineRenderProgress) => void
): Promise<{ blob: Blob; fileName: string }> {
  if (clips.length === 0) {
    throw new Error('Timeline is empty — nothing to export');
  }

  const specs = clips.map(toClipRenderSpec);
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
