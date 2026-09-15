/**
 * Drives a single <video> element through an edited timeline for preview.
 *
 * Strategy (see plan section 5):
 * - Regular / speed-only clips play directly from the original source file by
 *   seeking + setting playbackRate — no re-encode needed.
 * - Reversed clips are pre-rendered once via FFmpeg (crop+speed+reverse baked
 *   in) and cached as object URLs, swapped into the video element only while
 *   that clip is the active segment.
 * - Freeze clips pause on a canvas-captured still frame for their duration.
 *
 * This is a best-effort preview, not a frame-accurate compositor — final
 * quality/timing is guaranteed by the FFmpeg export pipeline instead.
 */
import type { Ref } from 'vue';
import type { Clip } from '../../types/videoEdit';
import { getClipDuration, toClipRenderSpec } from '../../types/videoEdit';
import { findClipAtTime, localTimeToSourceTime } from './clipMath';
import { videoWorkerPool } from '../videoWorkerPool';

export interface TimelinePreviewCallbacks {
  /** Fired continuously with the absolute timeline position while playing/scrubbing. */
  onTimeUpdate?: (timelineTime: number) => void;
  /** Fired when a freeze clip becomes active (data URL) or when leaving one (null). */
  onFreezeFrame?: (dataUrl: string | null) => void;
  /** Fired while a reversed clip is being rendered for the first time. */
  onBuffering?: (buffering: boolean) => void;
  onEnded?: () => void;
}

export interface TimelinePreviewController {
  seekTo(timelineTime: number): Promise<void>;
  play(fromTime?: number): Promise<void>;
  pause(): void;
  dispose(): void;
  isPlaying(): boolean;
}

function waitForLoadedData(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const onLoaded = () => {
      video.removeEventListener('loadeddata', onLoaded);
      resolve();
    };
    video.addEventListener('loadeddata', onLoaded);
  });
}

function seekVideoElement(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const clamped = Math.max(0, Number.isFinite(time) ? time : 0);
    if (Math.abs(video.currentTime - clamped) < 0.01) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = clamped;
  });
}

/** Cache key covers every property that affects the rendered output, not just id —
 * toggling reverse off/on (same id) or re-cropping must invalidate the old render. */
function getClipRenderCacheKey(clip: Clip): string {
  const crop = clip.crop ? `${clip.crop.x},${clip.crop.y},${clip.crop.width},${clip.crop.height}` : 'none';
  return `${clip.id}|${clip.sourceStart}|${clip.sourceEnd}|${clip.speed}|${clip.reversed}|${crop}`;
}

function captureVideoFrameDataUrl(video: HTMLVideoElement): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function createTimelinePreviewController(
  videoEl: Ref<HTMLVideoElement | null>,
  sourceFile: Ref<File | null>,
  sourceUrl: Ref<string | null>,
  getClips: () => Clip[],
  callbacks: TimelinePreviewCallbacks = {}
): TimelinePreviewController {
  const reversedClipUrlCache = new Map<string, string>();
  const reversedClipRenderPromises = new Map<string, Promise<string>>();

  let playing = false;
  let rafId: number | null = null;
  let freezeTimer: ReturnType<typeof setTimeout> | null = null;
  let activeIndex = -1;
  let activeClipStart = 0;
  let currentSrcKind: 'source' | 'reversed' | null = null;
  let disposed = false;

  function clearFreezeTimer(): void {
    if (freezeTimer) {
      clearTimeout(freezeTimer);
      freezeTimer = null;
    }
  }

  function stopFrameLoop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function pauseInternal(): void {
    playing = false;
    stopFrameLoop();
    clearFreezeTimer();
    videoEl.value?.pause();
  }

  function invalidateReversedClipCache(): void {
    for (const url of reversedClipUrlCache.values()) URL.revokeObjectURL(url);
    reversedClipUrlCache.clear();
    reversedClipRenderPromises.clear();
  }

  async function ensureReversedClipUrl(clip: Clip): Promise<string> {
    const key = getClipRenderCacheKey(clip);
    const cached = reversedClipUrlCache.get(key);
    if (cached) return cached;

    const inFlight = reversedClipRenderPromises.get(key);
    if (inFlight) return inFlight;

    const file = sourceFile.value;
    if (!file) throw new Error('No source video loaded');

    const promise = videoWorkerPool
      .renderClip(file, toClipRenderSpec(clip))
      .then(({ blob }) => {
        const url = URL.createObjectURL(blob);
        reversedClipUrlCache.set(key, url);
        reversedClipRenderPromises.delete(key);
        return url;
      })
      .catch((err) => {
        reversedClipRenderPromises.delete(key);
        throw err;
      });

    reversedClipRenderPromises.set(key, promise);
    return promise;
  }

  function timelineOffsetForIndex(clips: Clip[], index: number): number {
    let cursor = 0;
    for (let i = 0; i < index; i++) cursor += getClipDuration(clips[i]);
    return cursor;
  }

  /** Activates clip `index`, seeking to `localTime` within it, optionally starting playback. */
  async function activateClip(
    index: number,
    clips: Clip[],
    opts: { autoplay: boolean; localTime?: number }
  ): Promise<void> {
    const video = videoEl.value;
    if (!video) return;
    const clip = clips[index];
    if (!clip) return;

    const localTime = Math.max(0, opts.localTime ?? 0);
    activeIndex = index;
    activeClipStart = timelineOffsetForIndex(clips, index);
    clearFreezeTimer();

    if (clip.freeze) {
      video.pause();
      if (currentSrcKind !== 'source' && sourceUrl.value) {
        video.src = sourceUrl.value;
        currentSrcKind = 'source';
        await waitForLoadedData(video);
      }
      await seekVideoElement(video, clip.freeze.sourceTime);
      callbacks.onFreezeFrame?.(captureVideoFrameDataUrl(video));

      if (opts.autoplay) {
        const remaining = Math.max(0.05, clip.freeze.durationSeconds - localTime);
        freezeTimer = setTimeout(() => {
          freezeTimer = null;
          void advanceToNextClip(clips);
        }, remaining * 1000);
      }
      return;
    }

    callbacks.onFreezeFrame?.(null);

    if (clip.reversed) {
      callbacks.onBuffering?.(true);
      let url: string;
      try {
        url = await ensureReversedClipUrl(clip);
      } finally {
        callbacks.onBuffering?.(false);
      }
      if (disposed) return;
      if (video.src !== url) {
        video.src = url;
        currentSrcKind = 'reversed';
        await waitForLoadedData(video);
      }
      video.playbackRate = 1;
      await seekVideoElement(video, localTime);
    } else {
      if (currentSrcKind !== 'source' && sourceUrl.value) {
        video.src = sourceUrl.value;
        currentSrcKind = 'source';
        await waitForLoadedData(video);
      }
      video.playbackRate = clip.speed > 0 ? clip.speed : 1;
      await seekVideoElement(video, localTimeToSourceTime(clip, localTime));
    }

    if (opts.autoplay) {
      try {
        await video.play();
      } catch {
        // Playback interrupted (e.g. by a pause() call racing this) — ignore.
      }
    }
  }

  async function advanceToNextClip(clips: Clip[]): Promise<void> {
    if (disposed || !playing) return;
    const next = activeIndex + 1;
    if (next >= clips.length) {
      pauseInternal();
      callbacks.onEnded?.();
      return;
    }
    await activateClip(next, clips, { autoplay: true });
    if (playing && !clips[next].freeze) {
      rafId = requestAnimationFrame(frameLoop);
    }
  }

  function frameLoop(): void {
    if (!playing || disposed) return;
    const video = videoEl.value;
    const clips = getClips();
    const clip = clips[activeIndex];

    if (video && clip && !clip.freeze) {
      const speed = clip.speed > 0 ? clip.speed : 1;
      const localTime = clip.reversed
        ? video.currentTime
        : Math.max(0, video.currentTime - clip.sourceStart) / speed;
      callbacks.onTimeUpdate?.(activeClipStart + localTime);

      const reachedEnd = clip.reversed
        ? video.currentTime >= getClipDuration(clip) - 0.03 || video.ended
        : video.currentTime >= clip.sourceEnd - 0.02 || video.ended;

      if (reachedEnd) {
        void advanceToNextClip(clips);
        return;
      }
    }
    rafId = requestAnimationFrame(frameLoop);
  }

  return {
    async seekTo(timelineTime: number): Promise<void> {
      const clips = getClips();
      const pos = findClipAtTime(clips, timelineTime);
      if (!pos) return;
      const wasPlaying = playing;
      pauseInternal();
      await activateClip(pos.index, clips, { autoplay: false, localTime: pos.localTime });
      callbacks.onTimeUpdate?.(timelineTime);

      if (wasPlaying) {
        playing = true;
        const clip = getClips()[pos.index];
        if (clip?.freeze) {
          const remaining = Math.max(0.05, clip.freeze.durationSeconds - pos.localTime);
          freezeTimer = setTimeout(() => {
            freezeTimer = null;
            void advanceToNextClip(getClips());
          }, remaining * 1000);
        } else {
          try {
            await videoEl.value?.play();
          } catch {
            // ignore
          }
          rafId = requestAnimationFrame(frameLoop);
        }
      }
    },

    async play(fromTime?: number): Promise<void> {
      const clips = getClips();
      if (clips.length === 0) return;
      stopFrameLoop();
      clearFreezeTimer();
      playing = true;

      const startTime = fromTime ?? (activeIndex === -1 ? 0 : undefined);
      if (startTime !== undefined) {
        const pos = findClipAtTime(clips, startTime);
        if (pos) {
          await activateClip(pos.index, clips, { autoplay: true, localTime: pos.localTime });
        }
      } else if (clips[activeIndex]?.freeze) {
        // Resuming while paused mid-freeze: re-activating restarts the freeze
        // timer (from the top — a minor imprecision, but guarantees we always
        // re-arm the advance timer instead of resuming the hidden <video>
        // underneath with nothing left to move past the freeze).
        await activateClip(activeIndex, clips, { autoplay: true, localTime: 0 });
      } else {
        try {
          await videoEl.value?.play();
        } catch {
          // ignore
        }
      }

      if (playing && !getClips()[activeIndex]?.freeze) {
        rafId = requestAnimationFrame(frameLoop);
      }
    },

    pause(): void {
      pauseInternal();
    },

    dispose(): void {
      disposed = true;
      pauseInternal();
      invalidateReversedClipCache();
    },

    isPlaying(): boolean {
      return playing;
    },
  };
}
