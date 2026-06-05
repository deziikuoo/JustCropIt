/**
 * Video Extraction Composable
 *
 * Manages video frame extraction state and logic.
 * Handles video loading, extraction options, progress tracking,
 * frame streaming, clip trimming, and session persistence.
 */

import { ref, computed, watch, onUnmounted } from 'vue';
import { videoWorkerPool } from '../utils/videoWorkerPool';
import {
  saveVideoSession,
  loadVideoSession,
  clearVideoSession,
} from '../utils/videoSessionStorage';
import type {
  ExtractionOptions,
  ExtractionProgress,
  VideoInfo,
} from '../types/video';

export interface ExtractedFrameFile {
  file: File;
  timestamp: number;
  index: number;
}

export function useVideoExtraction() {
  // Video file state
  const videoFile = ref<File | null>(null);
  const videoInfo = ref<VideoInfo | null>(null);
  const videoPreviewUrl = ref<string | null>(null);

  // Clip trim range (seconds)
  const trimStart = ref(0);
  const trimEnd = ref(0);

  // Extraction options
  const intervalMs = ref(1000);
  const outputFormat = ref<'png' | 'jpeg'>('jpeg');
  const quality = ref(0.98);
  const maxFrames = ref<number | undefined>(undefined);

  // Progress state
  const isExtracting = ref(false);
  const isExportingTrim = ref(false);
  const progress = ref<ExtractionProgress | null>(null);
  const trimExportProgress = ref<ExtractionProgress | null>(null);
  const extractedFrames = ref<ExtractedFrameFile[]>([]);
  const error = ref<string | null>(null);

  const isRestoringSession = ref(false);
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  // ETA tracking
  const extractionStartedAt = ref<number | null>(null);
  const etaTick = ref(Date.now());
  let etaInterval: ReturnType<typeof setInterval> | null = null;

  const MIN_FRAMES_FOR_ETA = 5;

  function startEtaTimer(): void {
    extractionStartedAt.value = Date.now();
    etaTick.value = Date.now();
    if (etaInterval) clearInterval(etaInterval);
    etaInterval = setInterval(() => {
      etaTick.value = Date.now();
    }, 1000);
  }

  function stopEtaTimer(): void {
    extractionStartedAt.value = null;
    if (etaInterval) {
      clearInterval(etaInterval);
      etaInterval = null;
    }
  }

  const estimatedRemainingMs = computed(() => {
    void etaTick.value;

    if (!isExtracting.value || !extractionStartedAt.value || !progress.value) {
      return null;
    }

    const { currentFrame, totalFrames, percent } = progress.value;
    const elapsed = Date.now() - extractionStartedAt.value;

    if (currentFrame >= MIN_FRAMES_FOR_ETA && totalFrames > currentFrame) {
      const msPerFrame = elapsed / currentFrame;
      return Math.max(0, (totalFrames - currentFrame) * msPerFrame);
    }

    if (percent > 2 && percent < 100 && totalFrames > 0) {
      const estimatedTotal = elapsed / (percent / 100);
      return Math.max(0, estimatedTotal - elapsed);
    }

    return null;
  });

  const extractionEtaLabel = computed(() => formatExtractionEta(estimatedRemainingMs.value));

  const isSupported = computed(() => videoWorkerPool.isSupported());

  const clipDuration = computed(() => {
    if (!videoInfo.value || videoInfo.value.duration <= 0) return 0;
    return Math.max(0, trimEnd.value - trimStart.value);
  });

  const estimatedFrameCount = computed(() => {
    if (clipDuration.value <= 0) return 0;
    const intervalSeconds = intervalMs.value / 1000;
    const count = Math.ceil(clipDuration.value / intervalSeconds);
    if (maxFrames.value) {
      return Math.min(count, maxFrames.value);
    }
    return count;
  });

  const options = computed<ExtractionOptions>(() => ({
    intervalMs: intervalMs.value,
    outputFormat: outputFormat.value,
    quality: quality.value,
    maxFrames: maxFrames.value,
    videoDuration: clipDuration.value,
    trimStartSeconds: trimStart.value,
  }));

  watch(videoFile, (newFile) => {
    if (videoPreviewUrl.value) {
      URL.revokeObjectURL(videoPreviewUrl.value);
      videoPreviewUrl.value = null;
    }
    if (newFile) {
      videoPreviewUrl.value = URL.createObjectURL(newFile);
    }
    if (isRestoringSession.value) return;

    videoInfo.value = null;
    extractedFrames.value = [];
    error.value = null;
    progress.value = null;
    trimStart.value = 0;
    trimEnd.value = 0;
  });

  watch(videoInfo, (info) => {
    if (!info || info.duration <= 0 || isRestoringSession.value) return;

    if (trimEnd.value <= 0 || trimEnd.value > info.duration) {
      trimEnd.value = info.duration;
    }
    if (trimStart.value < 0) {
      trimStart.value = 0;
    }
    if (trimStart.value >= trimEnd.value) {
      trimStart.value = 0;
      trimEnd.value = info.duration;
    }
  });

  function schedulePersist(): void {
    if (isRestoringSession.value || isExtracting.value || isExportingTrim.value || !videoFile.value) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistSession();
    }, 500);
  }

  watch(
    [videoFile, videoInfo, intervalMs, outputFormat, quality, trimStart, trimEnd, extractedFrames],
    schedulePersist,
    { deep: true },
  );

  watch(isExtracting, (extracting, wasExtracting) => {
    if (wasExtracting && !extracting) {
      schedulePersist();
    }
  });

  async function persistSession(): Promise<void> {
    if (!videoFile.value) return;

    try {
      await saveVideoSession({
        video: videoFile.value,
        videoName: videoFile.value.name,
        videoType: videoFile.value.type || 'video/mp4',
        videoInfo: videoInfo.value,
        intervalMs: intervalMs.value,
        outputFormat: outputFormat.value,
        quality: quality.value,
        trimStart: trimStart.value,
        trimEnd: trimEnd.value,
        extractedFrames: extractedFrames.value.map((frame) => ({
          index: frame.index,
          timestamp: frame.timestamp,
          blob: frame.file,
          fileName: frame.file.name,
          mimeType: frame.file.type,
        })),
      });
    } catch (err) {
      console.warn('Failed to persist video session:', err);
    }
  }

  async function restoreSession(): Promise<boolean> {
    try {
      const session = await loadVideoSession();
      if (!session) return false;

      isRestoringSession.value = true;

      intervalMs.value = session.intervalMs;
      outputFormat.value = session.outputFormat;
      quality.value = session.quality;
      trimStart.value = session.trimStart;
      trimEnd.value = session.trimEnd;
      videoInfo.value = session.videoInfo;

      const file = new File([session.video], session.videoName, {
        type: session.videoType || 'video/mp4',
      });
      videoFile.value = file;

      extractedFrames.value = session.extractedFrames.map((frame) => ({
        file: new File([frame.blob], frame.fileName, { type: frame.mimeType }),
        timestamp: frame.timestamp,
        index: frame.index,
      }));

      error.value = null;
      progress.value = null;
      return true;
    } catch (err) {
      console.warn('Failed to restore video session:', err);
      return false;
    } finally {
      isRestoringSession.value = false;
    }
  }

  function applyVideoMetadata(metadata: {
    duration: number;
    width: number;
    height: number;
  }): void {
    if (!videoFile.value) return;

    const duration = metadata.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    const width = metadata.width > 0 ? metadata.width : 0;
    const height = metadata.height > 0 ? metadata.height : 0;

    if (!videoInfo.value) {
      videoInfo.value = { duration, width, height };
      return;
    }

    videoInfo.value = {
      duration: videoInfo.value.duration > 0 ? videoInfo.value.duration : duration,
      width: videoInfo.value.width > 0 ? videoInfo.value.width : width,
      height: videoInfo.value.height > 0 ? videoInfo.value.height : height,
      frameRate: videoInfo.value.frameRate,
      codec: videoInfo.value.codec,
    };
  }

  async function loadVideo(file: File): Promise<void> {
    if (!isSupported.value) {
      error.value = 'Video processing is not supported in this browser. Web Workers are required.';
      return;
    }

    videoFile.value = file;
    error.value = null;

    videoWorkerPool.probeVideo(file).then((info) => {
      if (info.duration > 0) {
        videoInfo.value = {
          duration: info.duration,
          width: info.width > 0 ? info.width : (videoInfo.value?.width ?? 0),
          height: info.height > 0 ? info.height : (videoInfo.value?.height ?? 0),
          frameRate: info.frameRate,
          codec: info.codec,
        };
      }
    }).catch((err) => {
      console.warn('Video probe failed, using element metadata fallback:', err);
    });
  }

  async function startExtraction(): Promise<ExtractedFrameFile[]> {
    if (!videoFile.value || !videoInfo.value || videoInfo.value.duration <= 0) {
      error.value = 'No video loaded or duration unknown';
      return [];
    }

    if (clipDuration.value <= 0) {
      error.value = 'Invalid clip range — adjust the trim handles';
      return [];
    }

    if (isExtracting.value) {
      error.value = 'Extraction already in progress';
      return [];
    }

    if (isExportingTrim.value) {
      error.value = 'Trim export already in progress';
      return [];
    }

    isExtracting.value = true;
    extractedFrames.value = [];
    error.value = null;
    startEtaTimer();
    progress.value = {
      phase: 'loading',
      currentFrame: 0,
      totalFrames: estimatedFrameCount.value,
      percent: 0,
    };

    try {
      const result = await videoWorkerPool.extractFrames(
        videoFile.value,
        options.value,
        {
          onProgress: (p) => {
            progress.value = {
              ...p,
              totalFrames: p.totalFrames || estimatedFrameCount.value,
            };
          },
          onFrame: (frame) => {
            const extension = outputFormat.value === 'png' ? 'png' : 'jpg';
            const fileName = `frame_${String(frame.index + 1).padStart(4, '0')}.${extension}`;
            const file = new File([frame.blob], fileName, { type: frame.blob.type });

            extractedFrames.value.push({
              file,
              timestamp: frame.timestamp,
              index: frame.index,
            });
          },
        },
      );

      if (result.cancelled) {
        progress.value = {
          phase: 'complete',
          currentFrame: extractedFrames.value.length,
          totalFrames: extractedFrames.value.length,
          percent: 100,
          message: 'Extraction cancelled',
        };
      } else if (progress.value?.phase !== 'error') {
        progress.value = {
          phase: 'complete',
          currentFrame: result.framesExtracted,
          totalFrames: result.framesExtracted,
          percent: 100,
          message: `Extracted ${result.framesExtracted} frames`,
        };
      }

      return extractedFrames.value;
    } catch (err) {
      error.value = `Extraction failed: ${err instanceof Error ? err.message : String(err)}`;
      progress.value = {
        phase: 'error',
        currentFrame: 0,
        totalFrames: 0,
        percent: 0,
        message: error.value,
      };
      return [];
    } finally {
      isExtracting.value = false;
      stopEtaTimer();
    }
  }

  function cancelExtraction(): void {
    if (isExtracting.value || isExportingTrim.value) {
      videoWorkerPool.cancel();
    }
  }

  function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function downloadTrimmedVideo(): Promise<void> {
    if (!videoFile.value || !videoInfo.value || videoInfo.value.duration <= 0) {
      error.value = 'No video loaded or duration unknown';
      return;
    }

    if (clipDuration.value <= 0) {
      error.value = 'Invalid clip range — adjust the trim handles';
      return;
    }

    if (isExtracting.value) {
      error.value = 'Frame extraction is in progress';
      return;
    }

    if (isExportingTrim.value) {
      return;
    }

    isExportingTrim.value = true;
    trimExportProgress.value = {
      phase: 'loading',
      currentFrame: 0,
      totalFrames: 1,
      percent: 0,
      message: 'Preparing trim export...',
    };
    error.value = null;

    try {
      const { blob, fileName } = await videoWorkerPool.trimVideo(
        videoFile.value,
        {
          trimStartSeconds: trimStart.value,
          clipDurationSeconds: clipDuration.value,
        },
        (p) => {
          trimExportProgress.value = p;
        },
      );

      downloadBlob(blob, fileName);
      trimExportProgress.value = {
        phase: 'complete',
        currentFrame: 1,
        totalFrames: 1,
        percent: 100,
        message: 'Download started',
      };
    } catch (err) {
      error.value = `Trim export failed: ${err instanceof Error ? err.message : String(err)}`;
      trimExportProgress.value = {
        phase: 'error',
        currentFrame: 0,
        totalFrames: 0,
        percent: 0,
        message: error.value,
      };
    } finally {
      isExportingTrim.value = false;
    }
  }

  async function reset(): Promise<void> {
    cancelExtraction();
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    videoFile.value = null;
    videoInfo.value = null;
    extractedFrames.value = [];
    error.value = null;
    progress.value = null;
    trimExportProgress.value = null;
    isExportingTrim.value = false;
    intervalMs.value = 1000;
    outputFormat.value = 'jpeg';
    quality.value = 0.98;
    maxFrames.value = undefined;
    trimStart.value = 0;
    trimEnd.value = 0;
    try {
      await clearVideoSession();
    } catch (err) {
      console.warn('Failed to clear video session:', err);
    }
  }

  function formatExtractionEta(remainingMs: number | null): string {
    if (remainingMs === null) {
      return 'Estimating time remaining...';
    }

    const totalSec = Math.max(1, Math.ceil(remainingMs / 1000));

    if (totalSec < 60) {
      return `About ${totalSec} sec remaining`;
    }

    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;

    if (sec === 0) {
      return min === 1 ? 'About 1 min remaining' : `About ${min} min remaining`;
    }

    return `About ${min} min ${sec} sec remaining`;
  }

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  onUnmounted(() => {
    if (videoPreviewUrl.value) {
      URL.revokeObjectURL(videoPreviewUrl.value);
    }
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    stopEtaTimer();
    cancelExtraction();
  });

  return {
    videoFile,
    videoInfo,
    videoPreviewUrl,
    trimStart,
    trimEnd,
    clipDuration,
    intervalMs,
    outputFormat,
    quality,
    maxFrames,
    isExtracting,
    isExportingTrim,
    progress,
    trimExportProgress,
    extractedFrames,
    error,
    isSupported,
    estimatedFrameCount,
    options,
    extractionEtaLabel,
    loadVideo,
    applyVideoMetadata,
    startExtraction,
    cancelExtraction,
    downloadTrimmedVideo,
    reset,
    restoreSession,
    formatDuration,
    formatExtractionEta,
  };
}
