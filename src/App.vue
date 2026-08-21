<template>
  <ShimmerBackground />
  <div class="app-container">
    <StorageAlert
      :show="alert.show"
      :type="alert.type"
      :title="alert.title"
      :message="alert.message"
      :auto-dismiss="alert.autoDismiss"
      @dismiss="alert.show = false"
    />
    <div
      v-if="importProgress"
      class="import-progress-banner"
      role="status"
      aria-live="polite"
    >
      <div class="import-progress-banner__row">
        <div class="import-progress-banner__meta">
          <i
            class="fas"
            :class="importCancelling ? 'fa-circle-notch fa-spin' : 'fa-spinner fa-spin'"
            aria-hidden="true"
          ></i>
          <span>
            {{
              importCancelling
                ? `Cancelling… ${importProgress.current} / ${importProgress.total}`
                : `Importing ${importProgress.label} ${importProgress.current} / ${importProgress.total}`
            }}
          </span>
        </div>
        <button
          type="button"
          class="import-progress-banner__cancel"
          :disabled="importCancelling"
          title="Cancel import"
          @click="cancelImport"
        >
          <i class="fas fa-times" aria-hidden="true"></i>
          Cancel
        </button>
      </div>
      <div class="import-progress-banner__track">
        <div
          class="import-progress-banner__fill"
          :style="{ width: `${importProgressPercent}%` }"
        ></div>
      </div>
    </div>
    <div
      v-else-if="batchEditProgress"
      class="import-progress-banner"
      role="status"
      aria-live="polite"
    >
      <div class="import-progress-banner__row">
        <div class="import-progress-banner__meta">
          <i
            class="fas"
            :class="batchEditCancelling ? 'fa-circle-notch fa-spin' : 'fa-spinner fa-spin'"
            aria-hidden="true"
          ></i>
          <span>
            {{
              batchEditCancelling
                ? `Cancelling… ${batchEditProgress.current} / ${batchEditProgress.total}`
                : `${batchEditProgress.label} ${batchEditProgress.current} / ${batchEditProgress.total}`
            }}
          </span>
          <span
            v-if="!batchEditCancelling && batchEditEtaLabel"
            class="import-progress-banner__eta"
          >
            · {{ batchEditEtaLabel }}
          </span>
        </div>
        <button
          type="button"
          class="import-progress-banner__cancel"
          :disabled="batchEditCancelling"
          title="Cancel batch edit"
          @click="cancelBatchEdit"
        >
          <i class="fas fa-times" aria-hidden="true"></i>
          Cancel
        </button>
      </div>
      <div class="import-progress-banner__track">
        <div
          class="import-progress-banner__fill"
          :style="{ width: `${batchEditProgressPercent}%` }"
        ></div>
      </div>
    </div>
    <div class="app-top-controls">
      <div class="app-top-controls__left">
        <div class="app-brand" aria-label="JustCropIt">JustCropIt</div>
      </div>

      <div class="app-top-controls__center">
        <div class="mode-tabs">
          <button 
            class="mode-tab" 
            :class="{ active: appMode === 'photos' }"
            @click="appMode = 'photos'"
          >
            <i class="fas fa-images"></i>
            <span>Images</span>
          </button>
          <button 
            class="mode-tab" 
            :class="{ active: appMode === 'video' }"
            @click="appMode = 'video'"
          >
            <i class="fas fa-film"></i>
            <span>Video Frames</span>
          </button>
        </div>
      </div>

      <div class="app-top-controls__right">
        <div
          v-show="appMode === 'photos'"
          class="app-top-right-stack"
        >
          <div
            class="app-size-controls"
            v-show="photos.length > 0"
          >
            <label>Size:</label>
            <div class="size-buttons-container">
              <button
                v-for="(size, index) in photoSizes"
                :key="size.label"
                type="button"
                class="size-button"
                :class="{ active: selectedPhotoSize === index }"
                :title="size.label"
                @click="selectedPhotoSize = index"
              >
                {{ size.label }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <button
      v-show="!showFeedbackPanel"
      type="button"
      class="feedback-fab"
      title="Support, feedback, or report a bug"
      aria-label="Open support"
      @click="showFeedbackPanel = true"
    >
      <i class="fas fa-comment-dots" aria-hidden="true"></i>
      <span>Support</span>
    </button>

    <main class="main-content">
      <!-- Wrapper div required: PhotoGrid has multiple root nodes, so v-show on the
           component itself does not hide it. Wrapping preserves tab state. -->
      <div v-show="appMode === 'photos'" class="photos-page">
        <PhotoGrid
          :photos="photos"
          v-model:selected-photo-size="selectedPhotoSize"
          :selectedIndices="selectedIndices"
          :identity-miss-photo-ids="identityMissPhotoIds"
          :hasSelection="selectedIndices.length > 0"
          :allSelected="
            selectedIndices.length === photos.length && photos.length > 0
          "
          :hasCopiedSettings="hasCopiedSettings"
          :new-photos-count="newPhotosCount"
          :deleted-photos-count="deletedPhotosCount"
          :drag-selection-count="dragSelectionCount"
          :post-crop-cleanup="postCropCleanup"
          :is-loading-from-storage="isLoadingPhotosFromStorage"
          @upload="handleUpload"
          @flip="handleFlip"
          @crop="openCropModal"
          @download="handleDownload"
          @revert="handleRevert"
          @delete="handleDelete"
          @copy-settings="handleCopySettings"
          @paste-settings="handlePasteSettings"
          @toggle-select-all="handleToggleSelectAll"
          @toggle-select="handleToggleSelect"
          @batch-flip="handleBatchFlip"
          @batch-crop="handleBatchCrop"
          @batch-download="handleBatchDownload"
          @batch-revert="handleBatchRevert"
          @batch-delete="handleBatchDelete"
          @clear-clipboard="handleClearClipboard"
          @select-multiple="handleSelectMultiple"
          @deselect-multiple="handleDeselectMultiple"
          @drag-selection-progress="handleDragSelectionProgress"
          @photo-thumbnail-updated="handlePhotoThumbnailUpdated"
          @update:post-crop-delete-enabled="postCropDeleteEnabled = $event"
        />
      </div>

      <div v-show="appMode === 'video'" class="video-page">
        <VideoExtractor :add-to-photos="handleVideoFramesExtracted" />
      </div>
    </main>
    <BatchCropSelector
      v-if="showBatchCropSelector"
      :show="showBatchCropSelector"
      :imageIndices="batchCropIndices"
      :photos="photos"
      @select="handleBatchCropImageSelect"
      @close="handleBatchCropSelectorClose"
    />
    <FeedbackPanel
      :open="showFeedbackPanel"
      @close="showFeedbackPanel = false"
      @submitted="handleFeedbackSubmitted"
    />
    <CropModal
      v-if="showCropModal"
      :show="showCropModal"
      :imageSrc="cropImageSrc"
      :initialCrop="photos[cropIndex]?.crop"
      :initialRotation="photos[cropIndex]?.rotation"
      :suggested-crop="suggestedCrop"
      :suggestion-loading="suggestionLoading"
      :suggestion-error="suggestionError"
      :suggestion-no-subject="
        suggestionAttempted &&
        !suggestionLoading &&
        !suggestedCrop &&
        !suggestionError &&
        isDetectionSupported()
      "
      :detection-supported="isDetectionSupported()"
      :batchMode="isBatchCropMode"
      :batch-crop-mode="pendingBatchCropMode"
      :reference-faces="identityReferenceGallery"
      :currentBatchIndex="
        isBatchCropMode && batchCropIndices
          ? batchCropIndices.indexOf(cropIndex)
          : cropIndex
      "
      :totalBatchCount="
        isBatchCropMode && batchCropIndices
          ? batchCropIndices.length
          : photos.length
      "
      @cropped="handleCropModalCropped"
      @close="handleCropModalClose"
      @next-image="handleNextBatchImage"
      @previous-image="handlePreviousBatchImage"
      @request-suggest="handleRequestCropSuggest"
      @cancel-suggest="cancelCropSuggestion"
    />
    <!-- Debug tools (disabled)
    <PerformanceDashboard />
    <OptimizationCheckModal />
    <CopyPasteVisualizer />
    -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import PhotoGrid from "./components/PhotoGrid.vue";
import CropModal from "./components/CropModal.vue";
import BatchCropSelector from "./components/BatchCropSelector.vue";
import StorageAlert from "./components/StorageAlert.vue";
import ShimmerBackground from "./components/ShimmerBackground.vue";
// import PerformanceDashboard from "./components/PerformanceDashboard.vue";
// import OptimizationCheckModal from "./components/OptimizationCheckModal.vue";
// import CopyPasteVisualizer from "./components/CopyPasteVisualizer.vue";
import VideoExtractor from "./components/VideoExtractor.vue";
import FeedbackPanel from "./components/FeedbackPanel.vue";
import {
  getExportStripChunkSize,
} from "./constants/optimization";
import { trackEvent } from "./utils/analytics";
import { useCropSuggestion } from "./composables/useCropSuggestion";
import { useExportSettings } from "./composables/useExportSettings";
import { prepareExportFile } from "./utils/export/prepareExportBlob";
import {
  createDownloadStamp,
  stampDownloadFileName,
  stampDownloadZipName,
} from "./utils/downloadFileNames";
import {
  createStreamingZip,
  type StreamingZipWriter,
} from "./utils/export/streamingZip";
import type { ExportBatchStats } from "./types/export";
import { copyPasteLogger } from "./utils/copyPasteLogger";
import { performanceLogger } from "./utils/performanceLogger";
import {
  initDB,
  updatePhoto,
  updatePhotosBatch,
  loadAllPhotos,
  deletePhoto,
  deletePhotos,
  cleanupExpiredPhotos,
  getStorageStatus,
  updatePhotoMetadata,
} from "./utils/photoStorage";
import { cleanupExpiredVideoSession } from "./utils/videoSessionStorage";
import { imageWorkerPool } from "./utils/imageWorkerPool";
import {
  FlipCommand,
  CropCommand,
  PasteSettingsCommand,
  BatchFlipCommand,
  BatchCropCommand,
  BatchFollowSubjectCommand,
} from "./utils/undoRedo";
import type { Photo } from "./types/photo";
import type { CropTarget, DetectedFace } from "./types/detection";
import type {
  BatchCropMode,
  BatchCropRecipe,
  BatchCropSelectPayload,
  IdentityReferenceFace,
} from "./types/batchCrop";
import { buildGalleryFromPhotoIndices } from "./utils/identityAutoMultiView";
import { blobToFile, resolveImageMimeType } from "./utils/blobToFile";
import {
  pauseThumbnailBackfill,
  resumeThumbnailBackfill,
  scheduleThumbnailBackfill,
} from "./utils/thumbnailBackfill";
import { applyDisplayInvalidation } from "./utils/thumbnailInvalidation";
import { ingestAndPersistPhotos } from "./utils/import/ingestAndPersist";
import { formatBatchEta, isBatchAborted } from "./utils/batchEditProgress";
import { installDetectionLifecycle } from "./utils/detectionLifecycle";
import { shutdownDetectionRuntime } from "./utils/detectionWorkerPool";
import {
  embedFacesInFile,
  preloadDetectionRuntime,
  preloadIdentityRuntime,
} from "./utils/subjectDetection";

const photoSizes = [
  { label: "XS", minSize: 180 },
  { label: "S", minSize: 220 },
  { label: "M", minSize: 260 },
  { label: "L", minSize: 310 },
  { label: "XL", minSize: 360 },
];

interface CopiedSettings {
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
}

const photos = ref<Photo[]>([]);
const { settings: exportSettings } = useExportSettings();
const selectedPhotoSize = ref(2);
const newPhotosCount = ref(0);
const deletedPhotosCount = ref(0);
const importProgress = ref<{
  current: number;
  total: number;
  label: string;
} | null>(null);
const importCancelling = ref(false);
let importAbortController: AbortController | null = null;

const importProgressPercent = computed(() => {
  if (!importProgress.value || importProgress.value.total <= 0) return 0;
  return Math.min(
    100,
    Math.round(
      (importProgress.value.current / importProgress.value.total) * 100
    )
  );
});

const cancelImport = () => {
  if (!importAbortController || importCancelling.value) return;
  importCancelling.value = true;
  console.warn("[Import][UI] Cancel requested");
  importAbortController.abort();
};

const clearImportUiState = () => {
  importProgress.value = null;
  importCancelling.value = false;
  importAbortController = null;
};

const batchEditProgress = ref<{
  current: number;
  total: number;
  label: string;
  startedAt: number;
} | null>(null);
const batchEditCancelling = ref(false);
let batchEditAbortController: AbortController | null = null;

const batchEditProgressPercent = computed(() => {
  if (!batchEditProgress.value || batchEditProgress.value.total <= 0) return 0;
  return Math.min(
    100,
    Math.round(
      (batchEditProgress.value.current / batchEditProgress.value.total) * 100
    )
  );
});

const batchEditEtaLabel = computed(() => {
  if (!batchEditProgress.value) return null;
  return formatBatchEta(
    batchEditProgress.value.startedAt,
    batchEditProgress.value.current,
    batchEditProgress.value.total
  );
});

const cancelBatchEdit = () => {
  if (!batchEditAbortController || batchEditCancelling.value) return;
  batchEditCancelling.value = true;
  console.warn("[BatchEdit] Cancel requested");
  batchEditAbortController.abort();
};

const beginBatchEditProgress = (label: string, total: number) => {
  if (total <= 0) return;
  batchEditAbortController = new AbortController();
  batchEditCancelling.value = false;
  batchEditProgress.value = {
    current: 0,
    total,
    label,
    startedAt: Date.now(),
  };
};

const updateBatchEditProgress = (current: number, total?: number) => {
  if (!batchEditProgress.value) return;
  batchEditProgress.value = {
    ...batchEditProgress.value,
    current: Math.min(current, total ?? batchEditProgress.value.total),
    ...(total != null ? { total } : {}),
  };
};

const endBatchEditProgress = () => {
  const wasCancelled = batchEditCancelling.value;
  const snapshot = batchEditProgress.value;
  batchEditProgress.value = null;
  batchEditCancelling.value = false;
  batchEditAbortController = null;
  return { wasCancelled, snapshot };
};

const notifyBatchCancelled = (
  label: string,
  completed: number,
  total: number
) => {
  showAlert(
    "info",
    "Batch Cancelled",
    completed > 0
      ? `Stopped ${label.toLowerCase()} after ${completed} of ${total}. Already-applied changes were kept.`
      : `Cancelled ${label.toLowerCase()} before any changes were applied.`,
    5000
  );
};
let addedCountResetTimer: ReturnType<typeof setTimeout> | null = null;
let deletedCountResetTimer: ReturnType<typeof setTimeout> | null = null;
const ACTIVITY_COUNT_PERSIST_MS = 7000;

const trackPhotoAddition = (count: number) => {
  if (count <= 0) return;

  newPhotosCount.value += count;

  if (addedCountResetTimer) {
    clearTimeout(addedCountResetTimer);
  }

  addedCountResetTimer = setTimeout(() => {
    newPhotosCount.value = 0;
    addedCountResetTimer = null;
  }, ACTIVITY_COUNT_PERSIST_MS);
};

const trackPhotoDeletion = (count: number) => {
  if (count <= 0) return;

  deletedPhotosCount.value += count;

  if (deletedCountResetTimer) {
    clearTimeout(deletedCountResetTimer);
  }

  deletedCountResetTimer = setTimeout(() => {
    deletedPhotosCount.value = 0;
    deletedCountResetTimer = null;
  }, ACTIVITY_COUNT_PERSIST_MS);
};

// App mode: 'photos' for standard photo editing, 'video' for video frame extraction
const APP_MODE_STORAGE_KEY = 'justcropit-app-mode';

function getInitialAppMode(): 'photos' | 'video' {
  try {
    const stored = sessionStorage.getItem(APP_MODE_STORAGE_KEY);
    if (stored === 'photos' || stored === 'video') return stored;
  } catch {
    // sessionStorage unavailable
  }
  return 'photos';
}

const appMode = ref<'photos' | 'video'>(getInitialAppMode());
const showFeedbackPanel = ref(false);

watch(appMode, (mode) => {
  try {
    sessionStorage.setItem(APP_MODE_STORAGE_KEY, mode);
  } catch {
    // sessionStorage unavailable
  }
});

const handlePhotoThumbnailUpdated = (
  index: number,
  thumbnail: File,
  thumbhash?: string | null
) => {
  const photo = photos.value[index];
  if (!photo) return;
  photos.value[index] = {
    ...photo,
    thumbnail,
    ...(thumbhash !== undefined ? { thumbhash } : {}),
  };
};

const {
  suggestedCrop,
  loading: suggestionLoading,
  error: suggestionError,
  attempted: suggestionAttempted,
  isSupported: isDetectionSupported,
  suggestForPhotoImmediate,
  cancel: cancelCropSuggestion,
  reset: resetCropSuggestion,
} = useCropSuggestion();
const isBatchDeleting = ref(false);
const showCropModal = ref(false);
const showBatchCropSelector = ref(false);
const pendingBatchCropMode = ref<BatchCropMode>("same-box");
const identityReferenceGallery = ref<IdentityReferenceFace[]>([]);
let identityGalleryAbort: AbortController | null = null;
const cropImageSrc = ref("");
let cropImageSrcURL: string | null = null; // Track URL for cleanup
const cropIndex = ref(0);

function clearIdentityGallery() {
  identityGalleryAbort?.abort();
  identityGalleryAbort = null;
  identityReferenceGallery.value = [];
}

// Watch for changes to the photo at cropIndex when modal is open
// This ensures the modal updates when edits are applied
watch(
  () => (showCropModal.value ? photos.value[cropIndex.value] : null),
  (photo) => {
    if (photo && showCropModal.value) {
      // Revoke old URL to prevent memory leaks
      if (cropImageSrcURL) {
        URL.revokeObjectURL(cropImageSrcURL);
        cropImageSrcURL = null;
      }
      // Always use original image - crop coordinates are relative to original
      // The CropModal applies rotation visually, so user sees the same result
      // Tier 2 full-res — not for grid
      cropImageSrcURL = URL.createObjectURL(photo.original);
      cropImageSrc.value = cropImageSrcURL;
    }
  },
  { deep: true }
);
const selectedIndices = ref<number[]>([]);
/** Session-only: selected photos skipped by smart crop stay red until unchecked. */
const identityMissPhotoIds = ref<Set<string>>(new Set());
const dragSelectionCount = ref<number | null>(null);
/** After batch crop: offer download + gated delete for successful crops. */
const postCropCleanup = ref<{
  successCount: number;
  missCount: number;
  successIds: Set<string>;
} | null>(null);
const postCropDeleteEnabled = ref(false);

function clearIdentityMissForPhotoId(photoId: string | undefined): void {
  if (!photoId || !identityMissPhotoIds.value.has(photoId)) return;
  const next = new Set(identityMissPhotoIds.value);
  next.delete(photoId);
  identityMissPhotoIds.value = next;
}

function clearIdentityMissForIndex(index: number): void {
  clearIdentityMissForPhotoId(photos.value[index]?.id);
}

function clearIdentityMissForIndices(indices: number[]): void {
  if (!indices.length || identityMissPhotoIds.value.size === 0) return;
  const next = new Set(identityMissPhotoIds.value);
  let changed = false;
  for (const index of indices) {
    const id = photos.value[index]?.id;
    if (id && next.delete(id)) changed = true;
  }
  if (changed) identityMissPhotoIds.value = next;
}

function clearPostCropCleanup(): void {
  postCropCleanup.value = null;
  postCropDeleteEnabled.value = false;
}

/**
 * After a batch crop: keep the batch selected (misses stay red), open cleanup offer.
 * When delete-enabled is on, download/delete only touch successful crops.
 */
function activatePostCropCleanup(
  batchIndices: number[],
  skippedPhotoIds: string[] = []
): void {
  const skipped = new Set(skippedPhotoIds);
  const successIds = new Set<string>();
  const keepSelected: number[] = [];

  for (const index of batchIndices) {
    const photo = photos.value[index];
    if (!photo?.id) continue;
    keepSelected.push(index);
    if (!skipped.has(photo.id)) {
      successIds.add(photo.id);
    }
  }

  if (successIds.size === 0) {
    clearPostCropCleanup();
    return;
  }

  selectedIndices.value = keepSelected.sort((a, b) => a - b);
  postCropDeleteEnabled.value = false;
  postCropCleanup.value = {
    successCount: successIds.size,
    missCount: skipped.size,
    successIds,
  };
}

/** Indices for download/delete: successes only when post-crop delete mode is on. */
function getBatchActionIndices(): number[] {
  const indices = selectedIndices.value;
  const offer = postCropCleanup.value;
  if (!offer || !postCropDeleteEnabled.value) {
    return [...indices];
  }
  return indices.filter((index) => {
    const id = photos.value[index]?.id;
    return id != null && offer.successIds.has(id);
  });
}
const batchCropIndices = ref<number[]>([]);
const isBatchCropMode = computed(() => batchCropIndices.value.length > 0);
const copiedSettings = ref<CopiedSettings | null>(null);

const hasCopiedSettings = computed(() => copiedSettings.value !== null);

// Storage alert state
const alert = ref<{
  show: boolean;
  type: "info" | "warning" | "error";
  title: string;
  message: string;
  autoDismiss: number;
}>({
  show: false,
  type: "info",
  title: "",
  message: "",
  autoDismiss: 0,
});

const showAlert = (
  type: "info" | "warning" | "error",
  title: string,
  message: string,
  autoDismiss = 0
) => {
  alert.value = { show: true, type, title, message, autoDismiss };
};

const handleFeedbackSubmitted = () => {
  showAlert(
    "info",
    "Support",
    "A GitHub issue draft opened in a new tab. Sign in on GitHub and click Submit to send it.",
    8000
  );
};

// Cleanup interval
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let storageStatusInterval: ReturnType<typeof setInterval> | null = null;

const debounce = <T extends (...args: any[]) => void>(fn: T, delay: number) => {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
};

// Helper function to apply flips, rotation, and crop to an image
// All transformations are applied starting from the original image
// Crop coordinates are relative to the original (non-rotated, non-flipped) image
const applyFlipsRotationAndCrop = async (
  image: HTMLImageElement,
  flips: { horizontal: boolean; vertical: boolean },
  rotation: number,
  crop: { x: number; y: number; width: number; height: number },
  mimeType: string
): Promise<Blob | null> => {
  // Normalize rotation to 0-360 range
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const rotationRad = (normalizedRotation * Math.PI) / 180;

  const imgWidth = image.naturalWidth;
  const imgHeight = image.naturalHeight;

  // Step 1: Apply flips first (to original image)
  const flipCanvas = document.createElement("canvas");
  flipCanvas.width = imgWidth;
  flipCanvas.height = imgHeight;
  const flipCtx = flipCanvas.getContext("2d")!;

  if (flips.horizontal && flips.vertical) {
    flipCtx.scale(-1, -1);
    flipCtx.drawImage(image, -imgWidth, -imgHeight);
  } else if (flips.horizontal) {
    flipCtx.scale(-1, 1);
    flipCtx.drawImage(image, -imgWidth, 0);
  } else if (flips.vertical) {
    flipCtx.scale(1, -1);
    flipCtx.drawImage(image, 0, -imgHeight);
  } else {
    flipCtx.drawImage(image, 0, 0);
  }

  // Step 2: Apply rotation to flipped image
  // Determine dimensions after rotation
  let rotatedWidth: number;
  let rotatedHeight: number;
  let cropX: number;
  let cropY: number;
  let cropWidth: number;
  let cropHeight: number;

  // Transform crop coordinates based on rotation
  // Crop coordinates are in original image space, need to transform to rotated space
  if (normalizedRotation === 90) {
    rotatedWidth = imgHeight;
    rotatedHeight = imgWidth;
    cropX = crop.y;
    cropY = imgWidth - crop.x - crop.width;
    cropWidth = crop.height;
    cropHeight = crop.width;
  } else if (normalizedRotation === 180) {
    rotatedWidth = imgWidth;
    rotatedHeight = imgHeight;
    cropX = imgWidth - crop.x - crop.width;
    cropY = imgHeight - crop.y - crop.height;
    cropWidth = crop.width;
    cropHeight = crop.height;
  } else if (normalizedRotation === 270) {
    rotatedWidth = imgHeight;
    rotatedHeight = imgWidth;
    cropX = imgHeight - crop.y - crop.height;
    cropY = crop.x;
    cropWidth = crop.height;
    cropHeight = crop.width;
  } else if (normalizedRotation === 0) {
    rotatedWidth = imgWidth;
    rotatedHeight = imgHeight;
    cropX = crop.x;
    cropY = crop.y;
    cropWidth = crop.width;
    cropHeight = crop.height;
  } else {
    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);
    rotatedWidth = Math.round(
      Math.abs(imgWidth * cos) + Math.abs(imgHeight * sin)
    );
    rotatedHeight = Math.round(
      Math.abs(imgWidth * sin) + Math.abs(imgHeight * cos)
    );
    const cx = crop.x + crop.width / 2 - imgWidth / 2;
    const cy = crop.y + crop.height / 2 - imgHeight / 2;
    const rcx = cx * cos - cy * sin;
    const rcy = cx * sin + cy * cos;
    cropWidth = crop.width;
    cropHeight = crop.height;
    cropX = rotatedWidth / 2 + rcx - cropWidth / 2;
    cropY = rotatedHeight / 2 + rcy - cropHeight / 2;
  }

  const rotatedCanvas = document.createElement("canvas");
  rotatedCanvas.width = rotatedWidth;
  rotatedCanvas.height = rotatedHeight;
  const rotatedCtx = rotatedCanvas.getContext("2d")!;

  rotatedCtx.save();
  rotatedCtx.translate(rotatedWidth / 2, rotatedHeight / 2);
  rotatedCtx.rotate(rotationRad);
  rotatedCtx.drawImage(flipCanvas, -imgWidth / 2, -imgHeight / 2);
  rotatedCtx.restore();

  // Step 3: Apply crop to rotated image
  const canvas = document.createElement("canvas");
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const ctx = canvas.getContext("2d")!;

  ctx.drawImage(
    rotatedCanvas,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight
  );

  // Convert to blob
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType);
  });
};

// Load photos from IndexedDB / OPFS cache
const isLoadingPhotosFromStorage = ref(true);

const loadPhotosFromStorage = async () => {
  isLoadingPhotosFromStorage.value = true;
  try {
    await initDB();
    await cleanupExpiredPhotos();

    const storedPhotos = await loadAllPhotos();
    const loadedPhotos: Photo[] = [];

    for (const stored of storedPhotos) {
      const originalFile = blobToFile(
        stored.original,
        stored.metadata.name,
        resolveImageMimeType(stored.original, stored.metadata.name)
      );
      const currentFile =
        stored.current === stored.original
          ? originalFile
          : blobToFile(
              stored.current,
              stored.metadata.name,
              resolveImageMimeType(stored.current, stored.metadata.name)
            );

      console.log(
        "Loading photo:",
        stored.id,
        "crop:",
        stored.metadata.crop,
        "rotation:",
        stored.metadata.rotation
      );
      loadedPhotos.push({
        id: stored.id,
        original: originalFile,
        current: currentFile,
        fileName: stored.metadata.name,
        thumbnail: stored.thumbnail
          ? blobToFile(
              stored.thumbnail,
              `thumb-${stored.metadata.name}`,
              resolveImageMimeType(stored.thumbnail, stored.metadata.name)
            )
          : null,
        thumbhash: stored.metadata.thumbhash ?? null,
        thumbRevision: 0,
        flips: stored.metadata.flips,
        crop: stored.metadata.crop,
        rotation: stored.metadata.rotation,
      });
    }

    photos.value = loadedPhotos;
    scheduleThumbnailBackfill(photos, blobToFile);
    // Show notification if photos were loaded (triggers PhotoCounter animation)
    if (loadedPhotos.length > 0) {
      trackPhotoAddition(loadedPhotos.length);
    }
  } catch (error) {
    console.error("Failed to load photos from storage:", error);
    showAlert(
      "error",
      "Storage Error",
      "Failed to load photos from storage. Please refresh the page.",
      5000
    );
  } finally {
    isLoadingPhotosFromStorage.value = false;
  }
};

const handleUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files) return;

  const files = Array.from(input.files);
  importAbortController = new AbortController();
  importCancelling.value = false;
  importProgress.value = {
    current: 0,
    total: files.length,
    label: "photos",
  };
  await nextTick();

  try {
    const result = await ingestAndPersistPhotos(files, {
      operationIdPrefix: "upload",
      signal: importAbortController.signal,
      onError: (title, message) => {
        console.error(`[Import][UI] ${title}: ${message}`);
        showAlert("error", title, message, 5000);
      },
      onStorageWarning: (message) =>
        showAlert("warning", "Storage Warning", message, 6000),
      onProgress: (current, total) => {
        if (importProgress.value) {
          importProgress.value = { ...importProgress.value, current, total };
        }
      },
      onPhotosPersisted: (batch) => {
        photos.value.push(...batch);
      },
      onPhotosAdded: trackPhotoAddition,
    });

    if (result.photos.length > 0) {
      trackEvent("import");
    }

    if (result.cancelled) {
      console.warn("[Import][UI] Upload cancelled", result);
      showAlert(
        "info",
        "Import Cancelled",
        result.photos.length > 0
          ? `Kept ${result.photos.length} of ${files.length} photo(s) imported before cancel.`
          : "Import cancelled. No photos were added.",
        5000
      );
      return;
    }

    if (result.stoppedEarly || result.failedCount > 0) {
      console.error("[Import][UI] Upload finished incomplete", result);
      showAlert(
        "warning",
        "Import Incomplete",
        `Imported ${result.photos.length} of ${files.length}. ${
          result.stoppedEarly
            ? "Stopped early due to app or browser storage limits (partial import kept)."
            : `${result.failedCount} file(s) failed.`
        }`,
        7000
      );
    }
  } catch (error) {
    console.error("[Import][UI] Upload threw", error);
    throw error;
  } finally {
    clearImportUiState();
    input.value = "";
    scheduleThumbnailBackfill(photos, blobToFile);
  }
};

// Handle video frames extracted from VideoExtractor (awaitable; video gallery is kept)
const handleVideoFramesExtracted = async (files: File[]) => {
  if (files.length === 0) {
    console.error("[Import][UI] No frames to import");
    throw new Error("No frames to import");
  }

  appMode.value = "photos";
  importAbortController = new AbortController();
  importCancelling.value = false;
  importProgress.value = {
    current: 0,
    total: files.length,
    label: "frames",
  };
  // Let the banner paint before heavy ingest work
  await nextTick();

  try {
    const result = await ingestAndPersistPhotos(files, {
      operationIdPrefix: "video-frames",
      preferLargerChunks: true,
      fromVideoSession: true,
      signal: importAbortController.signal,
      onError: (title, message) => {
        console.error(`[Import][UI] ${title}: ${message}`);
        showAlert("error", title, message, 6000);
      },
      onStorageWarning: (message) =>
        showAlert("warning", "Storage Warning", message, 6000),
      onProgress: (current, total) => {
        if (importProgress.value) {
          importProgress.value = { ...importProgress.value, current, total };
        }
      },
      onPhotosPersisted: (batch) => {
        photos.value.push(...batch);
      },
      onPhotosAdded: trackPhotoAddition,
    });

    if (result.photos.length > 0) {
      trackEvent("import_frames");
    }

    if (result.cancelled) {
      console.warn("[Import][UI] Video-frame import cancelled", result);
      showAlert(
        "info",
        "Import Cancelled",
        result.photos.length > 0
          ? `Kept ${result.photos.length} of ${files.length} frame(s). Remaining frames are still on the Video tab.`
          : "Import cancelled. No frames were added. Your Video tab is unchanged.",
        6000
      );
      // Soft-complete: keep video gallery; do not throw a failure error
      return;
    }

    const complete =
      result.photos.length === files.length &&
      !result.stoppedEarly &&
      result.failedCount === 0;

    if (result.photos.length === 0) {
      console.error("[Import][UI] Video-frame import imported 0 frames", result);
      showAlert(
        "error",
        "Import Failed",
        "No video frames could be imported. Check storage limits (DevTools → Application → Storage) or the browser console for [Import] logs.",
        8000
      );
      throw new Error("No video frames imported");
    }

    if (!complete) {
      console.error(
        "[Import][UI] Video-frame import incomplete — keeping Video tab frames",
        result
      );
      showAlert(
        "warning",
        "Import Incomplete",
        `Only ${result.photos.length} of ${files.length} frames were added${
          result.stoppedEarly
            ? " (app or browser storage limit — partial import kept)"
            : ""
        }${
          result.failedCount > 0 ? ` (${result.failedCount} failed)` : ""
        }. Your remaining frames are still on the Video tab.`,
        9000
      );
      throw new Error(
        `Incomplete import: ${result.photos.length}/${files.length} frames`
      );
    }

    showAlert(
      "info",
      "Frames Added",
      `${result.photos.length} video frames have been added to your photos.`,
      4000
    );
  } catch (error) {
    console.error("[Import][UI] Video-frame import error", error);
    throw error;
  } finally {
    clearImportUiState();
    scheduleThumbnailBackfill(photos, blobToFile);
  }
};

const handleFlip = async (
  index: number,
  direction: "horizontal" | "vertical"
) => {
  const photo = photos.value[index];
  if (!photo.id) {
    console.error("Photo must have an ID to flip");
    return;
  }

  try {
    const command = new FlipCommand(
      photo.id,
      direction,
      photos,
      updatePhoto,
      applyFlipsRotationAndCrop
    );
    await command.execute();
  } catch (error) {
    console.error("Failed to execute flip command:", error);
    showAlert("error", "Flip Failed", "Failed to flip photo. Please try again.");
  }
};

const startCropSuggestionForIndex = (index: number) => {
  const photo = photos.value[index];
  if (!photo) return;
  resetCropSuggestion();
};

const handleRequestCropSuggest = (target: CropTarget) => {
  const photo = photos.value[cropIndex.value];
  if (!photo) return;
  suggestForPhotoImmediate(photo, undefined, target);
};

const openCropModal = (index: number) => {
  batchCropIndices.value = [];
  cropIndex.value = index;
  if (cropImageSrcURL) {
    URL.revokeObjectURL(cropImageSrcURL);
  }
  cropImageSrcURL = URL.createObjectURL(photos.value[index].original);
  cropImageSrc.value = cropImageSrcURL;
  showCropModal.value = true;
  startCropSuggestionForIndex(index);
};

const handleCrop = async (
  blob: Blob,
  crop: { x: number; y: number; width: number; height: number },
  rotation: number
) => {
  const photo = photos.value[cropIndex.value];
  if (!photo?.id) {
    console.error("Photo must have an ID to crop");
    showAlert("error", "Crop Failed", "Failed to crop photo. Please try again.");
    return;
  }

  try {
    const command = new CropCommand(
      photo.id,
      crop,
      rotation,
      photos,
      updatePhoto,
      applyFlipsRotationAndCrop,
      blob
    );
    await command.execute();
    trackEvent("crop");
  } catch (error) {
    console.error("Failed to execute crop command:", error);
    showAlert("error", "Crop Failed", "Failed to crop photo. Please try again.");
  }
};

const handleCropModalCropped = async (
  blob: Blob,
  crop: { x: number; y: number; width: number; height: number },
  rotation: number,
  recipe?: BatchCropRecipe
) => {
  if (isBatchCropMode.value) {
    if (recipe && recipe.mode !== "same-box") {
      await handleBatchSmartCrop(recipe);
      return;
    }
    await handleBatchCropNext(blob, crop, rotation);
  } else {
    await handleCrop(blob, crop, rotation);
  }
};

const handleToggleSelectAll = debounce(async (checked: boolean) => {
  if (checked) {
    const operationId = `select-all-${Date.now()}`;
    performanceLogger.startMeasurement(operationId);

    selectedIndices.value = photos.value.map((_, i) => i);

    // Use nextTick to ensure Vue reactivity completes before measurement
    await performanceLogger.endMeasurement(
      operationId,
      "select-all",
      photos.value.length,
      false
    );
  } else {
    selectedIndices.value = [];
    identityMissPhotoIds.value = new Set();
    clearPostCropCleanup();
  }
}, 100);

const handleToggleSelect = debounce((index: number, checked: boolean) => {
  if (checked) {
    if (!selectedIndices.value.includes(index)) {
      selectedIndices.value = [...selectedIndices.value, index];
    }
  } else {
    clearIdentityMissForIndex(index);
    selectedIndices.value = selectedIndices.value.filter((i) => i !== index);
  }
}, 100);

const handleSelectMultiple = async (indices: number[]) => {
  if (!indices.length) {
    return;
  }

  const operationId = `select-drag-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  const merged = new Set(selectedIndices.value);
  indices.forEach((index) => merged.add(index));
  selectedIndices.value = Array.from(merged).sort((a, b) => a - b);
  dragSelectionCount.value = null;

  // End measurement after operation completes
  await performanceLogger.endMeasurement(
    operationId,
    "select-drag",
    indices.length,
    false
  );
};

const handleDeselectMultiple = (indices: number[]) => {
  if (!indices.length) {
    return;
  }
  clearIdentityMissForIndices(indices);
  const indicesSet = new Set(indices);
  selectedIndices.value = selectedIndices.value
    .filter((index) => !indicesSet.has(index))
    .sort((a, b) => a - b);
  dragSelectionCount.value = null;
};

const handleDragSelectionProgress = (count: number) => {
  if (count === -1) {
    dragSelectionCount.value = null;
  } else {
    dragSelectionCount.value = count;
  }
};

const handleBatchFlip = async (direction: "horizontal" | "vertical") => {
  const operationType =
    direction === "horizontal" ? "flip-horizontal" : "flip-vertical";
  const operationId = `batch-flip-${direction}-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  const total = selectedIndices.value.length;
  const workerUsed = imageWorkerPool.shouldUseWorkers(total);
  const label =
    direction === "horizontal" ? "Flipping horizontally" : "Flipping vertically";
  beginBatchEditProgress(label, total);

  try {
    const command = new BatchFlipCommand(
      selectedIndices.value,
      direction,
      photos,
      updatePhoto,
      updatePhotosBatch,
      applyFlipsRotationAndCrop,
      blobToFile,
      (current, progressTotal) =>
        updateBatchEditProgress(current, progressTotal),
      batchEditAbortController?.signal
    );
    await command.execute();
  } catch (error) {
    console.error("Failed to execute batch flip command:", error);
    showAlert(
      "error",
      "Batch Flip Failed",
      "Failed to flip selected photos. Please try again."
    );
  } finally {
    const { wasCancelled, snapshot } = endBatchEditProgress();
    if (wasCancelled && snapshot) {
      notifyBatchCancelled(label, snapshot.current, snapshot.total);
    }
    await performanceLogger.endMeasurement(
      operationId,
      operationType,
      selectedIndices.value.length,
      workerUsed
    );
  }
};

const handleBatchCrop = () => {
  if (selectedIndices.value.length > 0) {
    batchCropIndices.value = [...selectedIndices.value];
    // Show the selector modal first to let user choose template image
    showBatchCropSelector.value = true;
  }
};

const handleBatchCropImageSelect = async (payload: BatchCropSelectPayload) => {
  const { mode, templateIndex, referencePhotoIndices } = payload;
  pendingBatchCropMode.value = mode;
  clearIdentityGallery();
  cropIndex.value = templateIndex;
  if (cropImageSrcURL) {
    URL.revokeObjectURL(cropImageSrcURL);
  }
  cropImageSrcURL = URL.createObjectURL(photos.value[cropIndex.value].original);
  cropImageSrc.value = cropImageSrcURL;
  showBatchCropSelector.value = false;

  if (mode !== "same-box") {
    void preloadDetectionRuntime();
  }

  if (mode === "this-person") {
    void preloadIdentityRuntime().catch((error) => {
      console.warn("Identity preload failed:", error);
    });
    const indices =
      referencePhotoIndices && referencePhotoIndices.length > 0
        ? referencePhotoIndices
        : [templateIndex];
    identityGalleryAbort?.abort();
    identityGalleryAbort = new AbortController();
    const signal = identityGalleryAbort.signal;
    beginBatchEditProgress("Finding faces in references", indices.length);
    try {
      const gallery = await buildGalleryFromPhotoIndices(indices, photos, {
        signal,
      });
      if (signal.aborted) {
        endBatchEditProgress();
        return;
      }
      if (gallery.length === 0) {
        showAlert(
          "error",
          "No faces found",
          "Could not find a face in the selected reference images. Pick clearer frames and try again."
        );
        endBatchEditProgress();
        batchCropIndices.value = [];
        clearIdentityGallery();
        return;
      }
      identityReferenceGallery.value = gallery;
    } catch (error) {
      console.error("Failed to build identity references:", error);
      showAlert(
        "error",
        "Face matching unavailable",
        "Could not prepare reference faces. Try again or use Follow subject."
      );
      endBatchEditProgress();
      batchCropIndices.value = [];
      clearIdentityGallery();
      return;
    }
    endBatchEditProgress();
  }

  showCropModal.value = true;
  startCropSuggestionForIndex(templateIndex);
};

const handleBatchCropSelectorClose = () => {
  showBatchCropSelector.value = false;
  batchCropIndices.value = [];
  clearIdentityGallery();
  pendingBatchCropMode.value = "same-box";
};

const handleBatchCropNext = async (
  _blob: Blob,
  crop: { x: number; y: number; width: number; height: number },
  rotation: number
) => {
  const savedBatchCropIndices = [...batchCropIndices.value];
  const operationId = `batch-crop-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  const workerUsed = imageWorkerPool.shouldUseWorkers(
    savedBatchCropIndices.length
  );

  showCropModal.value = false;

  beginBatchEditProgress("Cropping", savedBatchCropIndices.length);

  try {
    const command = new BatchCropCommand(
      savedBatchCropIndices,
      crop,
      rotation,
      photos,
      updatePhoto,
      updatePhotosBatch,
      applyFlipsRotationAndCrop,
      blobToFile,
      (current, progressTotal) =>
        updateBatchEditProgress(current, progressTotal),
      batchEditAbortController?.signal
    );
    await command.execute();
    trackEvent("crop");
    activatePostCropCleanup(savedBatchCropIndices);
  } catch (error) {
    console.error("Failed to execute batch crop command:", error);
    showAlert(
      "error",
      "Batch Crop Failed",
      "Failed to crop selected photos. Please try again."
    );
  } finally {
    const { wasCancelled, snapshot } = endBatchEditProgress();
    if (wasCancelled && snapshot) {
      notifyBatchCancelled("Cropping", snapshot.current, snapshot.total);
      clearPostCropCleanup();
    }
    await performanceLogger.endMeasurement(
      operationId,
      "crop",
      savedBatchCropIndices.length,
      workerUsed
    );
    batchCropIndices.value = [];
    pendingBatchCropMode.value = "same-box";
    clearIdentityGallery();
  }
};

const handleBatchSmartCrop = async (recipe: BatchCropRecipe) => {
  const savedBatchCropIndices = [...batchCropIndices.value];
  const operationId = `batch-smart-crop-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  showCropModal.value = false;

  let referenceEmbeddings: Float32Array[] | null = null;
  if (recipe.mode === "this-person") {
    const refs =
      recipe.referenceFaces && recipe.referenceFaces.length > 0
        ? recipe.referenceFaces
        : identityReferenceGallery.value;
    if (!refs.length) {
      showAlert(
        "error",
        "Select a person",
        "Add at least one reference face before applying to the batch."
      );
      return;
    }
    beginBatchEditProgress("Loading face matching", refs.length);
    try {
      const embeddings: Float32Array[] = [];
      for (const ref of refs) {
        const photo = photos.value[ref.photoIndex];
        if (!photo?.id || photo.id !== ref.photoId) continue;
        const referenceFace: DetectedFace = {
          bbox: ref.bbox,
          score: 1,
          keypoints: ref.keypoints,
        };
        const embedded = await embedFacesInFile(photo.original, photo.id, [
          referenceFace,
        ]);
        const emb = embedded.embeddings[0];
        if (emb?.length) embeddings.push(emb);
      }
      if (embeddings.length === 0) {
        showAlert(
          "error",
          "Face matching unavailable",
          "Could not create face matches for the selected references."
        );
        endBatchEditProgress();
        batchCropIndices.value = [];
        clearIdentityGallery();
        return;
      }
      referenceEmbeddings = embeddings;
    } catch (error) {
      console.error("Failed to embed reference faces:", error);
      showAlert(
        "error",
        "Face matching unavailable",
        "Could not load the identity model. Try Follow subject instead."
      );
      endBatchEditProgress();
      batchCropIndices.value = [];
      clearIdentityGallery();
      return;
    }
    endBatchEditProgress();
  }

  beginBatchEditProgress("Finding subject", savedBatchCropIndices.length);

  try {
    const command = new BatchFollowSubjectCommand(
      savedBatchCropIndices,
      {
        ...recipe,
        referenceFaces:
          recipe.mode === "this-person"
            ? recipe.referenceFaces ?? identityReferenceGallery.value
            : undefined,
      },
      referenceEmbeddings,
      photos,
      updatePhoto,
      updatePhotosBatch,
      applyFlipsRotationAndCrop,
      (current, progressTotal) =>
        updateBatchEditProgress(current, progressTotal),
      (label) => {
        if (batchEditProgress.value) {
          batchEditProgress.value = {
            ...batchEditProgress.value,
            label,
          };
        }
      },
      batchEditAbortController?.signal
    );
    await command.execute();
    trackEvent(
      recipe.mode === "this-person" ? "batch_crop_identity" : "batch_crop_follow"
    );
    const result = command.result;
    if (result && !result.cancelled && result.skippedCount > 0) {
      const nextMisses = new Set(identityMissPhotoIds.value);
      for (const id of result.skippedPhotoIds) {
        nextMisses.add(id);
      }
      identityMissPhotoIds.value = nextMisses;
    }
    if (
      result &&
      (result.identityLoadModelMs || result.identityInferenceMs)
    ) {
      performanceLogger.recordDetectionStageTimings(operationId, {
        identityLoadModelMs: result.identityLoadModelMs,
        identityInferenceMs: result.identityInferenceMs,
      });
    }
    if (result && !result.cancelled) {
      activatePostCropCleanup(
        savedBatchCropIndices,
        result.skippedPhotoIds ?? []
      );
      if (
        result.skippedCount > 0 ||
        (result.neighborFilledCount ?? 0) > 0
      ) {
        const neighborNote =
          (result.neighborFilledCount ?? 0) > 0
            ? ` (${result.neighborFilledCount} via nearby frames)`
            : "";
        showAlert(
          "info",
          "Batch crop complete",
          `Cropped ${result.croppedCount} of ${savedBatchCropIndices.length}${neighborNote}. ${result.skippedCount} had no match.`,
          6000
        );
      }
    }
  } catch (error) {
    console.error("Failed to execute smart batch crop:", error);
    showAlert(
      "error",
      "Batch Crop Failed",
      "Failed to crop selected photos. Please try again."
    );
  } finally {
    const { wasCancelled, snapshot } = endBatchEditProgress();
    if (wasCancelled && snapshot) {
      notifyBatchCancelled(
        snapshot.label || "Cropping",
        snapshot.current,
        snapshot.total
      );
      clearPostCropCleanup();
    }
    await performanceLogger.endMeasurement(
      operationId,
      "crop",
      savedBatchCropIndices.length,
      true
    );
    batchCropIndices.value = [];
    pendingBatchCropMode.value = "same-box";
    clearIdentityGallery();
  }
};

const handleCropModalClose = () => {
  cancelCropSuggestion();
  resetCropSuggestion();
  showCropModal.value = false;
  batchCropIndices.value = [];
  clearIdentityGallery();
  pendingBatchCropMode.value = "same-box";
  if (cropImageSrcURL) {
    URL.revokeObjectURL(cropImageSrcURL);
    cropImageSrcURL = null;
  }
  cropImageSrc.value = "";
};

const handleNextBatchImage = async () => {
  if (
    isBatchCropMode.value &&
    batchCropIndices.value &&
    batchCropIndices.value.length > 0
  ) {
    // Batch mode: navigate through selected images
    const currentIndexInBatch = batchCropIndices.value.indexOf(cropIndex.value);
    if (
      currentIndexInBatch >= 0 &&
      currentIndexInBatch < batchCropIndices.value.length - 1
    ) {
      cropIndex.value = batchCropIndices.value[currentIndexInBatch + 1];
      // Revoke old URL
      if (cropImageSrcURL) {
        URL.revokeObjectURL(cropImageSrcURL);
      }
      cropImageSrcURL = URL.createObjectURL(
        photos.value[cropIndex.value].original
      );
      cropImageSrc.value = cropImageSrcURL;
      startCropSuggestionForIndex(cropIndex.value);
    }
  } else {
    // Non-batch mode: navigate through all images
    if (cropIndex.value < photos.value.length - 1) {
      cropIndex.value++;
      // Revoke old URL
      if (cropImageSrcURL) {
        URL.revokeObjectURL(cropImageSrcURL);
      }
      cropImageSrcURL = URL.createObjectURL(
        photos.value[cropIndex.value].original
      );
      cropImageSrc.value = cropImageSrcURL;
      startCropSuggestionForIndex(cropIndex.value);
    }
  }
};

const handlePreviousBatchImage = async () => {
  if (
    isBatchCropMode.value &&
    batchCropIndices.value &&
    batchCropIndices.value.length > 0
  ) {
    // Batch mode: navigate through selected images
    const currentIndexInBatch = batchCropIndices.value.indexOf(cropIndex.value);
    if (currentIndexInBatch > 0) {
      cropIndex.value = batchCropIndices.value[currentIndexInBatch - 1];
      // Revoke old URL
      if (cropImageSrcURL) {
        URL.revokeObjectURL(cropImageSrcURL);
      }
      cropImageSrcURL = URL.createObjectURL(
        photos.value[cropIndex.value].original
      );
      cropImageSrc.value = cropImageSrcURL;
      startCropSuggestionForIndex(cropIndex.value);
    }
  } else {
    // Non-batch mode: navigate through all images
    if (cropIndex.value > 0) {
      cropIndex.value--;
      // Revoke old URL
      if (cropImageSrcURL) {
        URL.revokeObjectURL(cropImageSrcURL);
      }
      cropImageSrcURL = URL.createObjectURL(
        photos.value[cropIndex.value].original
      );
      cropImageSrc.value = cropImageSrcURL;
      startCropSuggestionForIndex(cropIndex.value);
    }
  }
};

const downloadZip = async (zip: StreamingZipWriter, fileName: string) => {
  const blob = await zip.finish();

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give Chrome time to read the blob before the URL is released.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const handleBatchDownload = async () => {
  const indices = getBatchActionIndices();
  if (indices.length === 0) {
    return;
  }

  const operationId = `batch-download-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  const batchStats: ExportBatchStats = {
    passThroughCount: 0,
    fastPathCount: 0,
    slowPathCount: 0,
    workerUsed: false,
  };

  beginBatchEditProgress("Preparing download", indices.length);

  try {
    const zip = createStreamingZip();
    const chunkSize = getExportStripChunkSize();
    const settings = exportSettings();
    const stamp = createDownloadStamp();
    let completed = 0;
    const signal = batchEditAbortController?.signal;

    for (let i = 0; i < indices.length; i += chunkSize) {
      if (isBatchAborted(signal)) break;

      const chunk = indices.slice(i, i + chunkSize);

      const results = await Promise.all(
        chunk.map(async (index) => {
          if (isBatchAborted(signal)) return null;
          const photo = photos.value[index];
          const prepared = await prepareExportFile(photo, settings);
          if (isBatchAborted(signal)) return null;
          completed += 1;
          updateBatchEditProgress(completed, indices.length);
          return prepared;
        })
      );

      for (const prepared of results) {
        if (!prepared) continue;
        if (prepared.path === 'passthrough') batchStats.passThroughCount++;
        else if (prepared.path === 'fast-path') batchStats.fastPathCount++;
        else batchStats.slowPathCount++;
        if (prepared.workerUsed) batchStats.workerUsed = true;

        zip.add(stampDownloadFileName(prepared.fileName, stamp), prepared.buffer);
      }
    }

    if (isBatchAborted(signal)) {
      // Still offer whatever was prepared
      if (completed > 0) {
        await downloadZip(
          zip,
          stampDownloadZipName(`photos-${completed}-files.zip`, stamp)
        );
      }
      return;
    }

    updateBatchEditProgress(indices.length, indices.length);
    batchEditProgress.value = batchEditProgress.value
      ? { ...batchEditProgress.value, label: "Zipping" }
      : null;

    await downloadZip(
      zip,
      stampDownloadZipName(`photos-${indices.length}-files.zip`, stamp)
    );
    trackEvent("download");
  } catch (error) {
    console.error("Error creating ZIP file:", error);
    if (!isBatchAborted(batchEditAbortController?.signal)) {
      for (const index of indices) {
        await handleDownload(index);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  } finally {
    const { wasCancelled, snapshot } = endBatchEditProgress();
    if (wasCancelled && snapshot) {
      notifyBatchCancelled("Preparing download", snapshot.current, snapshot.total);
    }
    performanceLogger.recordExportBatchStats(operationId, batchStats);
    await performanceLogger.endMeasurement(
      operationId,
      "download",
      indices.length,
      batchStats.workerUsed
    );
  }
};

const handleBatchRevert = async () => {
  const operationId = `batch-revert-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  const indices = [...selectedIndices.value];
  beginBatchEditProgress("Resetting", indices.length);

  try {
    let completed = 0;
    const signal = batchEditAbortController?.signal;
    await Promise.all(
      indices.map(async (index) => {
        if (isBatchAborted(signal)) return;
        await handleRevert(index);
        completed += 1;
        updateBatchEditProgress(completed, indices.length);
      })
    );
  } finally {
    const { wasCancelled, snapshot } = endBatchEditProgress();
    if (wasCancelled && snapshot) {
      notifyBatchCancelled("Resetting", snapshot.current, snapshot.total);
    }
    await performanceLogger.endMeasurement(
      operationId,
      "revert",
      selectedIndices.value.length,
      false // Set to true once Web Workers are implemented (if applicable)
    );
  }
};

const handleBatchDelete = async () => {
  const indices = getBatchActionIndices().sort((a, b) => b - a);
  const deleteCount = indices.length;
  if (deleteCount === 0) return;

  const wasPostCropSuccessDelete =
    Boolean(postCropCleanup.value) && postCropDeleteEnabled.value;

  const operationId = `batch-delete-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  isBatchDeleting.value = true;
  pauseThumbnailBackfill();
  beginBatchEditProgress("Deleting", deleteCount);

  try {
    const idsToDelete: string[] = [];
    const signal = batchEditAbortController?.signal;

    // 1. Collect IDs first (don't splice until delete succeeds)
    for (const index of indices) {
      if (isBatchAborted(signal)) break;
      const photo = photos.value[index];
      if (photo && photo.id) {
        idsToDelete.push(photo.id);
      }
    }
    updateBatchEditProgress(Math.max(1, Math.floor(deleteCount * 0.2)), deleteCount);

    if (isBatchAborted(signal)) {
      return;
    }

    // 2. Batch DB delete
    if (idsToDelete.length > 0) {
      await deletePhotos(idsToDelete);
      if (identityMissPhotoIds.value.size > 0) {
        const next = new Set(identityMissPhotoIds.value);
        for (const id of idsToDelete) next.delete(id);
        identityMissPhotoIds.value = next;
      }
    }
    updateBatchEditProgress(Math.max(1, Math.floor(deleteCount * 0.6)), deleteCount);

    // 3. UI updates (loop backwards to handle splices safely)
    let removed = 0;
    for (const index of indices) {
      if (cropIndex.value === index && showCropModal.value) {
        showCropModal.value = false;
        if (cropImageSrcURL) {
          URL.revokeObjectURL(cropImageSrcURL);
          cropImageSrcURL = null;
        }
        cropImageSrc.value = "";
        cropIndex.value = 0;
      }
      if (cropIndex.value > index) {
        cropIndex.value--;
      }

      photos.value.splice(index, 1);
      removed += 1;
      updateBatchEditProgress(
        Math.min(
          deleteCount,
          Math.floor(deleteCount * 0.6) + removed
        ),
        deleteCount
      );
    }
    updateBatchEditProgress(deleteCount, deleteCount);
    trackPhotoDeletion(deleteCount);
  } catch (error) {
    console.error("Batch delete failed:", error);
    showAlert("error", "Delete Failed", "Failed to delete photos. Please try again.");
  } finally {
    isBatchDeleting.value = false;
    clearPostCropCleanup();
    if (wasPostCropSuccessDelete && identityMissPhotoIds.value.size > 0) {
      // Keep unsuccessful crops selected (red checks).
      selectedIndices.value = photos.value
        .map((photo, index) =>
          photo.id && identityMissPhotoIds.value.has(photo.id) ? index : -1
        )
        .filter((index) => index >= 0);
    } else {
      selectedIndices.value = [];
      identityMissPhotoIds.value = new Set();
    }
    const { wasCancelled, snapshot } = endBatchEditProgress();
    if (wasCancelled && snapshot) {
      notifyBatchCancelled("Deleting", snapshot.current, snapshot.total);
    }

    await performanceLogger.endMeasurement(
      operationId,
      "delete",
      deleteCount,
      false
    );
    resumeThumbnailBackfill();
    scheduleThumbnailBackfill(photos, blobToFile);
  }
};

const handleDownload = async (index: number) => {
  const photo = photos.value[index];
  const prepared = await prepareExportFile(photo, exportSettings());

  const blob = new Blob([prepared.buffer], { type: prepared.mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = stampDownloadFileName(
      prepared.fileName,
      createDownloadStamp()
    );
    a.click();
    trackEvent("download");
  } finally {
    URL.revokeObjectURL(url);
  }
};

const handleRevert = async (index: number) => {
  const photo = photos.value[index];
  clearIdentityMissForPhotoId(photo?.id);

  // Deferred flips only: reset metadata without rewriting blobs / regenerating thumbs
  if (
    !photo.crop &&
    !photo.rotation &&
    (photo.flips.horizontal || photo.flips.vertical)
  ) {
    photos.value[index] = {
      ...photo,
      flips: { horizontal: false, vertical: false },
      crop: undefined,
      rotation: undefined,
    };
    if (photo.id) {
      try {
        await updatePhotoMetadata(photo.id, {
          flips: { horizontal: false, vertical: false },
          crop: undefined,
          rotation: undefined,
        });
      } catch (error) {
        console.error("Failed to update photo metadata:", error);
      }
    }
    return;
  }

  photos.value[index] = applyDisplayInvalidation(photo, {
    current: photo.original,
    flips: { horizontal: false, vertical: false },
    crop: undefined,
    rotation: undefined,
  });

  // Save to IndexedDB if photo has an ID
  if (photo.id) {
    try {
      await updatePhoto(photo.id, photo.original, {
        flips: { horizontal: false, vertical: false },
        crop: undefined,
        rotation: undefined,
      });
    } catch (error) {
      console.error("Failed to update photo in storage:", error);
    }
  }
};

const handleDelete = async (index: number) => {
  if (index >= 0 && index < photos.value.length) {
    const photo = photos.value[index];

    pauseThumbnailBackfill();
    try {
    // Delete from IndexedDB if photo has an ID
    if (photo.id) {
      clearIdentityMissForPhotoId(photo.id);
      try {
        await deletePhoto(photo.id);
      } catch (error) {
        console.error("Failed to delete photo from storage:", error);
      }
    }

    photos.value.splice(index, 1);

    // Track user deletion for counter animation (only if not part of batch delete)
    // Batch delete will set the count after all deletions complete
    if (!isBatchDeleting.value) {
      trackPhotoDeletion(1);
    }

    if (cropIndex.value === index && showCropModal.value) {
      showCropModal.value = false;
      // Clean up URL
      if (cropImageSrcURL) {
        URL.revokeObjectURL(cropImageSrcURL);
        cropImageSrcURL = null;
      }
      cropImageSrc.value = "";
      cropIndex.value = 0;
    }
    if (cropIndex.value > index) {
      cropIndex.value--;
    }
    selectedIndices.value = selectedIndices.value
      .filter((i) => i !== index)
      .map((i) => (i > index ? i - 1 : i));
    } finally {
      resumeThumbnailBackfill();
      scheduleThumbnailBackfill(photos, blobToFile);
    }
  } else {
    console.warn("Invalid index in handleDelete:", index);
  }
};

const handleCopySettings = (index: number) => {
  console.log("=== COPY SETTINGS ===");
  console.log("Copying from photo index:", index);
  const photo = photos.value[index];
  console.log("Photo flips:", photo.flips);
  console.log("Photo crop:", photo.crop);
  console.log("Photo rotation:", photo.rotation);
  copiedSettings.value = {
    flips: { ...photo.flips },
    crop: photo.crop ? { ...photo.crop } : undefined,
    rotation: photo.rotation,
  };
  console.log("Copied settings:", copiedSettings.value);

  // Log copy operation
  copyPasteLogger.logCopy(index, copiedSettings.value);

  console.log("=== END COPY SETTINGS ===");
};

const handleClearClipboard = () => {
  copiedSettings.value = null;
  console.log("Clipboard cleared");
};

const handlePasteSettings = async (singleIndex?: number) => {
  if (!copiedSettings.value) {
    console.warn("No copied settings to paste");
    return;
  }

  const indicesToPaste =
    singleIndex !== undefined ? [singleIndex] : selectedIndices.value;
  const photoIds = indicesToPaste
    .map((index) => photos.value[index]?.id)
    .filter((id): id is string => !!id);

  if (photoIds.length === 0) {
    console.warn("No valid photos to paste settings to");
    return;
  }

  const operationId = `batch-paste-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);
  beginBatchEditProgress("Pasting settings", photoIds.length);

  try {
    const command = new PasteSettingsCommand(
      photoIds,
      copiedSettings.value,
      photos,
      updatePhoto,
      applyFlipsRotationAndCrop,
      (current, progressTotal) =>
        updateBatchEditProgress(current, progressTotal),
      batchEditAbortController?.signal
    );
    await command.execute();
  } catch (error) {
    console.error("Failed to execute paste settings command:", error);
    showAlert(
      "error",
      "Paste Failed",
      "Failed to paste settings. Please try again."
    );
  } finally {
    const { wasCancelled, snapshot } = endBatchEditProgress();
    if (wasCancelled && snapshot) {
      notifyBatchCancelled("Pasting settings", snapshot.current, snapshot.total);
    }
    await performanceLogger.endMeasurement(
      operationId,
      "paste",
      photoIds.length,
      false
    );
  }
};

// Initialize storage and load photos on mount
onMounted(async () => {
  installDetectionLifecycle();
  try {
    await initDB();

    // Load photos from storage
    await loadPhotosFromStorage();

    // Video session has its own 24h timer (independent of photo expiresAt)
    try {
      await cleanupExpiredVideoSession();
    } catch (error) {
      console.error("Video session cleanup error:", error);
    }

    cleanupInterval = setInterval(async () => {
      try {
        const deleted = await cleanupExpiredPhotos();
        if (deleted > 0) {
          // Reload photos after cleanup
          await loadPhotosFromStorage();
          showAlert(
            "info",
            "Storage Cleanup",
            `${deleted} expired photo(s) were automatically deleted.`,
            5000
          );
        }
      } catch (error) {
        console.error("Photo cleanup error:", error);
      }

      try {
        const videoCleared = await cleanupExpiredVideoSession();
        if (videoCleared) {
          window.dispatchEvent(
            new CustomEvent("justcropit:video-session-expired")
          );
          showAlert(
            "info",
            "Video Session Expired",
            "Your saved video session expired after 24 hours and was cleared. Photos were not affected.",
            5000
          );
        }
      } catch (error) {
        console.error("Video session cleanup error:", error);
      }
    }, 60 * 60 * 1000); // 1 hour

    // Check storage status periodically
    storageStatusInterval = setInterval(async () => {
      const status = await getStorageStatus();
      if (status.shouldWarn && status.message) {
        showAlert("warning", "Storage Warning", status.message, 6000);
      }
    }, 15 * 60 * 1000); // Every 15 minutes
  } catch (error) {
    console.error("Failed to initialize storage:", error);
    isLoadingPhotosFromStorage.value = false;
    showAlert(
      "error",
      "Storage Error",
      "Failed to initialize storage. Photos will not be saved.",
      5000
    );
  }
});

onUnmounted(() => {
  if (importAbortController) {
    importAbortController.abort();
    importAbortController = null;
  }
  importProgress.value = null;
  importCancelling.value = false;
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (storageStatusInterval) {
    clearInterval(storageStatusInterval);
    storageStatusInterval = null;
  }
  shutdownDetectionRuntime();
  identityMissPhotoIds.value = new Set();
});
</script>

<style scoped>
.app-container {
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 100vh;
  text-align: center;
}

.main-content {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.import-progress-banner {
  position: fixed;
  top: calc(72px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  width: min(560px, calc(100vw - 32px));
  z-index: 1400;
  margin: 0;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(212, 175, 55, 0.45);
  background: rgba(18, 18, 20, 0.92);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(12px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: auto;
}

.import-progress-banner__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.import-progress-banner__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.85);
  min-width: 0;
}

.import-progress-banner__meta i {
  color: #e8c96a;
  flex-shrink: 0;
}

.import-progress-banner__eta {
  color: rgba(255, 255, 255, 0.55);
  font-weight: 400;
  white-space: nowrap;
}

.import-progress-banner__cancel {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.88);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.import-progress-banner__cancel:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.18);
  border-color: rgba(239, 68, 68, 0.45);
  color: #fca5a5;
}

.import-progress-banner__cancel:disabled {
  opacity: 0.55;
  cursor: wait;
}

.import-progress-banner__track {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.import-progress-banner__fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #c9a227, #e8c96a);
  transition: width 0.2s ease;
}

.photos-page {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  padding-top: calc(72px + env(safe-area-inset-top, 0px));
}

.video-page {
  flex: 1;
  width: 100%;
  display: flex;
  justify-content: center;
  padding-top: calc(72px + env(safe-area-inset-top, 0px));
  padding-bottom: 56px;
}

.app-top-controls {
  position: fixed;
  top: calc(12px + env(safe-area-inset-top, 0px));
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: start;
  padding-left: calc(12px + env(safe-area-inset-left, 0px));
  padding-right: calc(12px + env(safe-area-inset-right, 0px));
  z-index: 1200;
  pointer-events: none;
  background: transparent;
  border: 0;
}

.app-top-controls__left {
  justify-self: start;
  pointer-events: auto;
}

.app-top-controls__center {
  justify-self: center;
  pointer-events: auto;
}

.app-top-controls__right {
  justify-self: end;
  pointer-events: auto;
}

.feedback-fab {
  position: fixed;
  right: calc(12px + env(safe-area-inset-right, 0px));
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  z-index: 1100;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  min-height: 0;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(18, 18, 26, 0.98);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

.feedback-fab:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.95);
  transform: none;
}

.app-brand {
  flex: 0 0 auto;
  display: inline-block;
  padding-top: 6px;
  padding-bottom: 4px;
  overflow: visible;
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1.25;
  background: linear-gradient(
    135deg,
    #d4af37 0%,
    #ffd700 35%,
    #ffffff 100%
  );
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.mode-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  padding: 6px;
  background: rgba(18, 18, 26, 0.98);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
}

.mode-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.mode-tab:hover:not(.active) {
  background: linear-gradient(135deg, rgba(212, 175, 55, 0.22) 0%, rgba(212, 175, 55, 0.1) 100%);
  color: #ffd700;
  box-shadow: 0 2px 8px rgba(212, 175, 55, 0.2);
}

.mode-tab.active {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.95);
  border-color: rgba(255, 255, 255, 0.15);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.mode-tab.active:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.22);
  box-shadow: 0 2px 12px rgba(255, 255, 255, 0.12);
}

.mode-tab i {
  font-size: 1rem;
}

.app-top-right-stack {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.app-size-controls {
  flex: 0 0 auto;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 10px;
  background: rgba(18, 18, 26, 0.98);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.app-size-controls label {
  white-space: nowrap;
  font-weight: 600;
  font-size: 0.65rem;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  margin: 0;
  padding: 0 2px;
}

.size-buttons-container {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  width: auto;
}

.size-button {
  padding: 3px 7px;
  width: auto;
  min-width: 28px;
  min-height: 24px;
  font-size: 0.65rem;
  font-weight: 600;
  border-radius: 6px;
  line-height: 1;
}

.size-button:hover:not(:disabled) {
  transform: none;
}

.size-button.active {
  background: rgba(255, 255, 255, 0.25);
  border-color: #aaa;
}

@media (max-width: 768px) {
  .app-brand {
    font-size: 1.05rem;
    padding-top: 5px;
    padding-bottom: 3px;
  }

  .mode-tab {
    padding: 8px 16px;
    font-size: 0.85rem;
  }

  .mode-tab {
    padding: 8px 12px;
    font-size: 0.8rem;
  }

  .mode-tab i {
    font-size: 1rem;
  }

}

@media (max-width: 480px) {
  .app-top-controls {
    padding-left: calc(8px + env(safe-area-inset-left, 0px));
    padding-right: calc(8px + env(safe-area-inset-right, 0px));
  }

  .mode-tabs {
    padding: 3px;
    border-radius: 12px;
  }

  .mode-tab {
    padding: 8px 14px;
    border-radius: 9px;
  }

  .app-size-controls {
    padding: 3px 6px;
    gap: 4px;
  }

  .feedback-fab {
    right: calc(8px + env(safe-area-inset-right, 0px));
    bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    padding: 3px 6px;
    gap: 4px;
  }

  .size-button {
    min-width: 24px;
    padding: 2px 5px;
    font-size: 0.6rem;
  }
}
</style>
