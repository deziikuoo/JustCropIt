import { ref, onUnmounted } from 'vue';
import type { Photo } from '../types/photo';
import type {
  SuggestedCrop,
  DetectionStageTimings,
  PortraitDebugOverlay,
} from '../types/detection';
import { DETECTION_DEBUG_OVERLAY } from '../constants/optimization';
import { detectSubject, isDetectionSupported } from '../utils/subjectDetection';
import { bboxToSuggestedCrop } from '../utils/cropSuggestion';
import { createDetectionQueue } from '../utils/detectionQueue';
import { DETECTION_SUGGEST_DEBOUNCE_MS } from '../constants/optimization';
import { performanceLogger } from '../utils/performanceLogger';
import { scheduleIdleTask } from '../utils/scheduler';

const detectionQueue = createDetectionQueue();

export function useCropSuggestion() {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const suggestedCrop = ref<SuggestedCrop | null>(null);
  const detectionDebug = ref<PortraitDebugOverlay | null>(null);
  const lastBboxFound = ref(false);
  const attempted = ref(false);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activePhotoId: string | null = null;
  let activeRevision = 0;

  const reset = () => {
    loading.value = false;
    error.value = null;
    suggestedCrop.value = null;
    detectionDebug.value = null;
    lastBboxFound.value = false;
    attempted.value = false;
    activePhotoId = null;
    activeRevision = 0;
  };

  const cancel = () => {
    if (activePhotoId) {
      detectionQueue.cancelForPhoto(activePhotoId);
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    loading.value = false;
  };

  async function runSuggest(
    photo: Photo,
    aspectRatio?: number | null
  ): Promise<void> {
    if (!photo.id) {
      error.value = 'Photo must have an ID for detection';
      return;
    }

    if (!isDetectionSupported()) {
      error.value = null;
      suggestedCrop.value = null;
      return;
    }

    const photoId = photo.id;
    const revision = detectionQueue.bumpRevision(photoId);
    activePhotoId = photoId;
    activeRevision = revision;

    loading.value = true;
    error.value = null;

    const operationId = `crop-suggest-${Date.now()}`;
    performanceLogger.startMeasurement(operationId);

    try {
      const result = await detectionQueue.enqueue(photoId, revision, async () => {
        if (revision !== detectionQueue.getRevision(photoId)) {
          return null;
        }
        return detectSubject(photo.original, photoId);
      });

      if (
        revision !== activeRevision ||
        revision !== detectionQueue.getRevision(photoId)
      ) {
        return;
      }

      const stageTimings: DetectionStageTimings = result?.timings ?? {};
      performanceLogger.recordDetectionStageTimings(operationId, stageTimings);

      if (stageTimings.portraitMethod) {
        console.debug(
          `[crop-suggest] method=${stageTimings.portraitMethod}`,
          {
            poseMs: stageTimings.poseInferenceMs,
            faceLandmarkMs: stageTimings.faceLandmarkInferenceMs,
            faceDetectorMs: stageTimings.faceDetectorInferenceMs,
          }
        );
      }

      if (!result) {
        return;
      }

      if (result.error && !result.error.includes('cancelled')) {
        lastBboxFound.value = false;
        suggestedCrop.value = null;
        detectionDebug.value = null;
        error.value = 'Detection failed — try Suggest crop again';
        return;
      }

      if (!result.bbox) {
        detectionDebug.value =
          DETECTION_DEBUG_OVERLAY && result.debug
            ? { ...result.debug, appliedCrop: null }
            : null;
        lastBboxFound.value = false;
        suggestedCrop.value = null;
        error.value = null;
        return;
      }

      const bitmap = await createImageBitmap(photo.original);
      let imageSize = { width: bitmap.width, height: bitmap.height };
      bitmap.close();

      const postStart = performance.now();
      const crop = bboxToSuggestedCrop(result.bbox, imageSize, { aspectRatio });
      const postProcessMs = performance.now() - postStart;

      performanceLogger.recordDetectionStageTimings(operationId, {
        ...stageTimings,
        postProcessMs,
      });

      if (!crop) {
        lastBboxFound.value = false;
        suggestedCrop.value = null;
        detectionDebug.value = null;
        return;
      }

      lastBboxFound.value = true;
      suggestedCrop.value = crop;
      detectionDebug.value =
        DETECTION_DEBUG_OVERLAY && result.debug
          ? {
              ...result.debug,
              appliedCrop: {
                x: crop.x,
                y: crop.y,
                width: crop.width,
                height: crop.height,
              },
            }
          : null;
      error.value = null;
    } catch (err) {
      if (revision === activeRevision) {
        console.error('Crop suggestion failed:', err);
        error.value = 'Detection failed';
        suggestedCrop.value = null;
        detectionDebug.value = null;
      }
    } finally {
      if (revision === activeRevision) {
        loading.value = false;
        attempted.value = true;
      }
      await performanceLogger.endMeasurement(
        operationId,
        'crop-suggest',
        1,
        false
      );
    }
  }

  function suggestForPhoto(
    photo: Photo,
    aspectRatio?: number | null,
    defer = false
  ): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    const execute = () => {
      void runSuggest(photo, aspectRatio);
    };

    if (defer) {
      scheduleIdleTask(execute, { timeout: 500 });
    } else {
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        execute();
      }, DETECTION_SUGGEST_DEBOUNCE_MS);
    }
  }

  function suggestForPhotoImmediate(
    photo: Photo,
    aspectRatio?: number | null
  ): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    void runSuggest(photo, aspectRatio);
  }

  onUnmounted(() => {
    cancel();
    reset();
  });

  return {
    loading,
    error,
    suggestedCrop,
    detectionDebug,
    lastBboxFound,
    attempted,
    isSupported: isDetectionSupported,
    suggestForPhoto,
    suggestForPhotoImmediate,
    cancel,
    reset,
  };
}
