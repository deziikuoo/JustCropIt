/**
 * Drives a single <video> element through an edited timeline for preview.
 *
 * Strategy:
 * - Regular / speed-only clips play directly from the original source file by
 *   seeking + setting playbackRate — no re-encode needed.
 * - Reversed clips play a downscaled WebCodecs frame strip backwards on a
 *   canvas (cached per source range). FFmpeg reverse is export-only.
 * - Freeze clips pause on a canvas-captured still frame for their duration.
 *
 * This is a best-effort preview, not a frame-accurate compositor — final
 * quality/timing is guaranteed by the FFmpeg export pipeline instead.
 */
import type { Ref } from 'vue';
import type { Clip } from '../../types/videoEdit';
import { getClipDuration } from '../../types/videoEdit';
import { findClipAtTime, localTimeToSourceTime } from './clipMath';
import {
  clearReversePreviewCache,
  loadReversePreviewSequence,
  hasReversePreview,
  nearestReverseFrame,
  prefetchReversePreviews,
  type ReversePreviewSequence,
} from './reversePreview';

export interface TimelinePreviewCallbacks {
  /** Fired continuously with the absolute timeline position while playing/scrubbing. */
  onTimeUpdate?: (timelineTime: number) => void;
  /** Fired when a freeze clip becomes active (data URL) or when leaving one (null). */
  onFreezeFrame?: (dataUrl: string | null) => void;
  /** Fired while a reversed clip's preview strip is being decoded for the first time. */
  onBuffering?: (buffering: boolean) => void;
  /** 0–100 while a reverse preview strip is being built. 100 means that pass finished. */
  onReverseProgress?: (percent: number) => void;
  /** Fired when canvas reverse preview should show/hide over the <video>. */
  onReversePreview?: (active: boolean) => void;
  onEnded?: () => void;
}

export interface TimelinePreviewController {
  seekTo(timelineTime: number, opts?: { scrub?: boolean }): Promise<void>;
  play(fromTime?: number): Promise<void>;
  pause(): void;
  dispose(): void;
  isPlaying(): boolean;
  prefetchReversedClips(clips: Clip[]): Promise<void>;
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

function assignVideoTime(video: HTMLVideoElement, time: number): void {
  const clamped = Math.max(0, Number.isFinite(time) ? time : 0);
  if (Math.abs(video.currentTime - clamped) < 0.008) return;
  const media = video as HTMLVideoElement & { fastSeek?: (t: number) => void };
  if (typeof media.fastSeek === 'function') {
    try {
      media.fastSeek(clamped);
      return;
    } catch {
      // fall through to currentTime
    }
  }
  video.currentTime = clamped;
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
  reverseCanvasEl: Ref<HTMLCanvasElement | null>,
  callbacks: TimelinePreviewCallbacks = {}
): TimelinePreviewController {
  let playing = false;
  let rafId: number | null = null;
  let freezeTimer: ReturnType<typeof setTimeout> | null = null;
  let activeIndex = -1;
  let activeClipStart = 0;
  let currentSrcKind: 'source' | null = null;
  let disposed = false;
  let reverseSequence: ReversePreviewSequence | null = null;
  let reverseLocalTime = 0;
  let lastRafTs = 0;
  let pendingScrubTime: number | null = null;
  let scrubSeekInFlight = false;

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
    lastRafTs = 0;
  }

  function pauseInternal(): void {
    playing = false;
    stopFrameLoop();
    clearFreezeTimer();
    videoEl.value?.pause();
  }

  function naturalSize(): { width: number; height: number } {
    const video = videoEl.value;
    return {
      width: video?.videoWidth || reverseSequence?.width || 0,
      height: video?.videoHeight || reverseSequence?.height || 0,
    };
  }

  function drawReverseFrame(clip: Clip, localTime: number): void {
    const canvas = reverseCanvasEl.value;
    const sequence = reverseSequence;
    if (!canvas || !sequence) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sourceTime = localTimeToSourceTime(clip, localTime);
    const frame = nearestReverseFrame(sequence, sourceTime);
    const bitmap = frame.bitmap;
    const crop = clip.crop;
    const { width: naturalWidth, height: naturalHeight } = naturalSize();

    let sx = 0;
    let sy = 0;
    let sw = bitmap.width;
    let sh = bitmap.height;
    if (crop && naturalWidth > 0 && naturalHeight > 0) {
      const scaleX = bitmap.width / naturalWidth;
      const scaleY = bitmap.height / naturalHeight;
      sx = crop.x * scaleX;
      sy = crop.y * scaleY;
      sw = Math.max(1, crop.width * scaleX);
      sh = Math.max(1, crop.height * scaleY);
    }

    const wrap = canvas.parentElement;
    const cssW = Math.max(1, wrap?.clientWidth || bitmap.width);
    const cssH = Math.max(1, wrap?.clientHeight || bitmap.height);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const outW = Math.max(2, Math.round(cssW * dpr));
    const outH = Math.max(2, Math.round(cssH * dpr));
    if (canvas.width !== outW) canvas.width = outW;
    if (canvas.height !== outH) canvas.height = outH;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, outW, outH);

    const scale = Math.min(outW / sw, outH / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (outW - dw) / 2;
    const dy = (outH - dh) / 2;
    ctx.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  async function ensureSourceVideo(video: HTMLVideoElement): Promise<void> {
    if (currentSrcKind !== 'source' && sourceUrl.value) {
      video.src = sourceUrl.value;
      currentSrcKind = 'source';
      await waitForLoadedData(video);
    }
  }

  async function ensureReverseSequence(clip: Clip): Promise<ReversePreviewSequence> {
    if (hasReversePreview(clip)) {
      return loadReversePreviewSequence(clip, sourceFile.value, sourceUrl.value);
    }
    callbacks.onBuffering?.(true);
    callbacks.onReverseProgress?.(0);
    try {
      return await loadReversePreviewSequence(clip, sourceFile.value, sourceUrl.value, (percent) => {
        callbacks.onReverseProgress?.(percent);
      });
    } finally {
      callbacks.onReverseProgress?.(100);
      callbacks.onBuffering?.(false);
    }
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
      callbacks.onReversePreview?.(false);
      reverseSequence = null;
      video.pause();
      await ensureSourceVideo(video);
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
      video.pause();
      await ensureSourceVideo(video);
      reverseSequence = await ensureReverseSequence(clip);
      if (disposed) return;
      reverseLocalTime = localTime;
      callbacks.onReversePreview?.(true);
      drawReverseFrame(clip, reverseLocalTime);
      return;
    }

    callbacks.onReversePreview?.(false);
    reverseSequence = null;
    await ensureSourceVideo(video);
    video.playbackRate = clip.speed > 0 ? clip.speed : 1;
    await seekVideoElement(video, localTimeToSourceTime(clip, localTime));

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

  function frameLoop(now: number): void {
    if (!playing || disposed) return;
    const video = videoEl.value;
    const clips = getClips();
    const clip = clips[activeIndex];
    const dt = lastRafTs ? (now - lastRafTs) / 1000 : 0;
    lastRafTs = now;

    if (clip?.reversed && reverseSequence) {
      // Safety check: ensure sequence is still valid
      if (!reverseSequence) {
        console.warn('[TimelinePreview] Reverse sequence missing during playback');
        pauseInternal();
        return;
      }
      
      reverseLocalTime += dt;
      const duration = getClipDuration(clip);
      callbacks.onTimeUpdate?.(activeClipStart + Math.min(reverseLocalTime, duration));
      // Reduced epsilon from 0.02 to 0.001 for more accurate end detection
      if (reverseLocalTime >= duration - 0.001) {
        void advanceToNextClip(clips);
        return;
      }
      drawReverseFrame(clip, reverseLocalTime);
      rafId = requestAnimationFrame(frameLoop);
      return;
    }

    if (video && clip && !clip.freeze) {
      const speed = clip.speed > 0 ? clip.speed : 1;
      const localTime = Math.max(0, video.currentTime - clip.sourceStart) / speed;
      callbacks.onTimeUpdate?.(activeClipStart + localTime);

      const reachedEnd = video.currentTime >= clip.sourceEnd - 0.02 || video.ended;
      if (reachedEnd) {
        void advanceToNextClip(clips);
        return;
      }
    }
    rafId = requestAnimationFrame(frameLoop);
  }

  async function applyScrub(timelineTime: number): Promise<void> {
    const clips = getClips();
    const pos = findClipAtTime(clips, timelineTime);
    if (!pos) return;
    const video = videoEl.value;
    if (!video) return;
    const clip = clips[pos.index];
    if (!clip) return;

    playing = false;
    stopFrameLoop();
    clearFreezeTimer();
    video.pause();

    if (clip.freeze) {
      if (activeIndex !== pos.index) {
        await activateClip(pos.index, clips, { autoplay: false, localTime: pos.localTime });
      } else {
        activeClipStart = timelineOffsetForIndex(clips, pos.index);
      }
      callbacks.onTimeUpdate?.(timelineTime);
      return;
    }

    if (clip.reversed) {
      if (activeIndex !== pos.index || !reverseSequence) {
        await activateClip(pos.index, clips, { autoplay: false, localTime: pos.localTime });
      } else {
        activeIndex = pos.index;
        activeClipStart = timelineOffsetForIndex(clips, pos.index);
        reverseLocalTime = pos.localTime;
        callbacks.onReversePreview?.(true);
        drawReverseFrame(clip, reverseLocalTime);
      }
      callbacks.onTimeUpdate?.(timelineTime);
      return;
    }

    if (activeIndex !== pos.index || currentSrcKind !== 'source') {
      await activateClip(pos.index, clips, { autoplay: false, localTime: pos.localTime });
      callbacks.onTimeUpdate?.(timelineTime);
      return;
    }

    activeClipStart = timelineOffsetForIndex(clips, pos.index);
    callbacks.onReversePreview?.(false);
    callbacks.onFreezeFrame?.(null);
    video.playbackRate = clip.speed > 0 ? clip.speed : 1;
    assignVideoTime(video, localTimeToSourceTime(clip, pos.localTime));
    callbacks.onTimeUpdate?.(timelineTime);
  }

  return {
    async seekTo(timelineTime: number, opts?: { scrub?: boolean }): Promise<void> {
      if (opts?.scrub) {
        pendingScrubTime = timelineTime;
        callbacks.onTimeUpdate?.(timelineTime);
        if (scrubSeekInFlight) return;
        scrubSeekInFlight = true;
        try {
          while (pendingScrubTime !== null && !disposed) {
            const next = pendingScrubTime;
            pendingScrubTime = null;
            await applyScrub(next);
          }
        } finally {
          scrubSeekInFlight = false;
        }
        return;
      }

      pendingScrubTime = null;
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
        } else if (clip?.reversed) {
          rafId = requestAnimationFrame(frameLoop);
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

      try {
        const startTime = fromTime ?? (activeIndex === -1 ? 0 : undefined);
        if (startTime !== undefined) {
          const pos = findClipAtTime(clips, startTime);
          if (pos) {
            await activateClip(pos.index, clips, { autoplay: true, localTime: pos.localTime });
          }
        } else if (clips[activeIndex]?.freeze) {
          await activateClip(activeIndex, clips, { autoplay: true, localTime: 0 });
        } else if (clips[activeIndex]?.reversed) {
          // Resume canvas reverse from reverseLocalTime — frameLoop keeps time.
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
      } catch (err) {
        console.error('[TimelinePreview] Play failed:', err);
        playing = false;
      }
    },

    pause(): void {
      pauseInternal();
    },

    dispose(): void {
      disposed = true;
      pauseInternal();
      reverseSequence = null;
      callbacks.onReversePreview?.(false);
      clearReversePreviewCache();
    },

    isPlaying(): boolean {
      return playing;
    },

    async prefetchReversedClips(clips: Clip[]): Promise<void> {
      if (disposed) return;
      await prefetchReversePreviews(clips, sourceFile.value, sourceUrl.value, (percent) => {
        callbacks.onReverseProgress?.(percent);
      });
    },
  };
}
