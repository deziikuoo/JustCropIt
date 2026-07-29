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
            <span>Photos</span>
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
          <DeletionNotification />
        </div>
      </div>
    </div>

    <main class="main-content">
      <!-- Wrapper div required: PhotoGrid has multiple root nodes, so v-show on the
           component itself does not hide it. Wrapping preserves tab state. -->
      <div v-show="appMode === 'photos'" class="photos-page">
        <PhotoGrid
          :photos="photos"
          v-model:selected-photo-size="selectedPhotoSize"
          :selectedIndices="selectedIndices"
          :hasSelection="selectedIndices.length > 0"
          :allSelected="
            selectedIndices.length === photos.length && photos.length > 0
          "
          :hasCopiedSettings="hasCopiedSettings"
          :new-photos-count="newPhotosCount"
          :deleted-photos-count="deletedPhotosCount"
          :drag-selection-count="dragSelectionCount"
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
        />
      </div>

      <div v-show="appMode === 'video'" class="video-page">
        <VideoExtractor @frames-extracted="handleVideoFramesExtracted" />
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
    <OperationHistoryPanel v-if="appMode === 'photos'" />
    <CropModal
      v-if="showCropModal"
      :show="showCropModal"
      :imageSrc="cropImageSrc"
      :initialCrop="photos[cropIndex]?.crop"
      :initialRotation="photos[cropIndex]?.rotation"
      :suggested-crop="suggestedCrop"
      :detection-debug="detectionDebug"
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
import { ref, computed, onMounted, onUnmounted, watch, provide } from "vue";
import PhotoGrid from "./components/PhotoGrid.vue";
import CropModal from "./components/CropModal.vue";
import BatchCropSelector from "./components/BatchCropSelector.vue";
import StorageAlert from "./components/StorageAlert.vue";
import ShimmerBackground from "./components/ShimmerBackground.vue";
import DeletionNotification from "./components/DeletionNotification.vue";
// import PerformanceDashboard from "./components/PerformanceDashboard.vue";
// import OptimizationCheckModal from "./components/OptimizationCheckModal.vue";
// import CopyPasteVisualizer from "./components/CopyPasteVisualizer.vue";
import VideoExtractor from "./components/VideoExtractor.vue";
import OperationHistoryPanel from "./components/OperationHistoryPanel.vue";
import JSZip from "jszip";
import { getExportStripChunkSize, HISTORY_MAX_SIZE } from "./constants/optimization";
import { UNDO_REDO_MANAGER_KEY } from "./types/history";
import { useOperationHistory } from "./composables/useOperationHistory";
import { useCropSuggestion } from "./composables/useCropSuggestion";
import { scheduleIdleTask } from "./utils/scheduler";
import { useExportSettings } from "./composables/useExportSettings";
import { prepareExportFile } from "./utils/export/prepareExportBlob";
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
} from "./utils/photoStorage";
import { imageWorkerPool } from "./utils/imageWorkerPool";
import {
  UndoRedoManager,
  FlipCommand,
  CropCommand,
  PasteSettingsCommand,
  BatchFlipCommand,
  BatchCropCommand,
} from "./utils/undoRedo";
import type { Photo } from "./types/photo";
import { blobToFile } from "./utils/blobToFile";
import { scheduleThumbnailBackfill } from "./utils/thumbnailBackfill";
import { applyDisplayInvalidation } from "./utils/thumbnailInvalidation";
import { ingestAndPersistPhotos } from "./utils/import/ingestAndPersist";

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

// Initialize UndoRedoManager
const undoRedoManager = new UndoRedoManager();
undoRedoManager.setMaxHistorySize(HISTORY_MAX_SIZE);
provide(UNDO_REDO_MANAGER_KEY, undoRedoManager);
const { undo: historyUndo, redo: historyRedo } =
  useOperationHistory(undoRedoManager);
const {
  suggestedCrop,
  detectionDebug,
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
const cropImageSrc = ref("");
let cropImageSrcURL: string | null = null; // Track URL for cleanup
const cropIndex = ref(0);

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
const dragSelectionCount = ref<number | null>(null);
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

// Cleanup interval
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

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
  } else {
    rotatedWidth = imgWidth;
    rotatedHeight = imgHeight;
    cropX = crop.x;
    cropY = crop.y;
    cropWidth = crop.width;
    cropHeight = crop.height;
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

// Load photos from IndexedDB
const loadPhotosFromStorage = async () => {
  try {
    await initDB();
    await cleanupExpiredPhotos();

    const storedPhotos = await loadAllPhotos();
    const loadedPhotos: Photo[] = [];

    for (const stored of storedPhotos) {
      // Convert Blobs back to Files
      const originalFile = blobToFile(
        stored.original,
        stored.metadata.name,
        stored.original.type || "image/jpeg"
      );
      const currentFile = blobToFile(
        stored.current,
        stored.metadata.name,
        stored.current.type || "image/jpeg"
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
        thumbnail: stored.thumbnail
          ? blobToFile(
              stored.thumbnail,
              `thumb-${stored.metadata.name}`,
              stored.thumbnail.type || "image/jpeg"
            )
          : null,
        thumbhash: stored.metadata.thumbhash ?? null,
        thumbRevision: 0,
        cropHistory: [],
        cropFuture: [],
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
  }
};

const handleUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files) return;

  const { photos: newPhotos } = await ingestAndPersistPhotos(
    Array.from(input.files),
    {
      operationIdPrefix: "upload",
      onError: (title, message) => showAlert("error", title, message, 5000),
      onStorageWarning: (message) =>
        showAlert("warning", "Storage Warning", message, 6000),
      onPhotosAdded: trackPhotoAddition,
    }
  );

  if (newPhotos.length > 0) {
    photos.value.push(...newPhotos);
  }

  input.value = "";
};

// Handle video frames extracted from VideoExtractor
const handleVideoFramesExtracted = async (files: File[]) => {
  if (files.length === 0) return;

  appMode.value = 'photos';

  const { photos: newPhotos } = await ingestAndPersistPhotos(files, {
    operationIdPrefix: "video-frames",
    onError: (title, message) => showAlert("error", title, message, 5000),
    onStorageWarning: (message) =>
      showAlert("warning", "Storage Warning", message, 6000),
    onPhotosAdded: (count) => {
      trackPhotoAddition(count);
      showAlert(
        "info",
        "Frames Added",
        `${count} video frames have been added to your photos.`,
        4000
      );
    },
  });

  if (newPhotos.length === 0 && files.length > 0) {
    showAlert(
      "error",
      "Import Failed",
      "No video frames could be imported. Check storage limits or file format.",
      5000
    );
    return;
  }

  photos.value.push(...newPhotos);
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
    await undoRedoManager.executeCommand(command);
  } catch (error) {
    console.error("Failed to execute flip command:", error);
    showAlert("error", "Flip Failed", "Failed to flip photo. Please try again.");
  }
};

const startCropSuggestionForIndex = (index: number) => {
  const photo = photos.value[index];
  if (!photo) return;
  resetCropSuggestion();
  scheduleIdleTask(() => {
    suggestForPhotoImmediate(photo);
  }, { timeout: 500 });
};

const handleRequestCropSuggest = () => {
  const photo = photos.value[cropIndex.value];
  if (!photo) return;
  suggestForPhotoImmediate(photo);
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
  _blob: Blob,
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
      applyFlipsRotationAndCrop
    );
    await undoRedoManager.executeCommand(command);
  } catch (error) {
    console.error("Failed to execute crop command:", error);
    showAlert("error", "Crop Failed", "Failed to crop photo. Please try again.");
  }
};

const handleCropModalCropped = async (
  blob: Blob,
  crop: { x: number; y: number; width: number; height: number },
  rotation: number
) => {
  // Route to the appropriate handler based on batch mode
  if (isBatchCropMode.value) {
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
  }
}, 100);

const handleToggleSelect = debounce((index: number, checked: boolean) => {
  if (checked) {
    if (!selectedIndices.value.includes(index)) {
      selectedIndices.value = [...selectedIndices.value, index];
    }
  } else {
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

  const workerUsed = imageWorkerPool.shouldUseWorkers(
    selectedIndices.value.length
  );

  try {
    const command = new BatchFlipCommand(
      selectedIndices.value,
      direction,
      photos,
      updatePhoto,
      updatePhotosBatch,
      applyFlipsRotationAndCrop,
      blobToFile
    );
    await undoRedoManager.executeCommand(command);
  } catch (error) {
    console.error("Failed to execute batch flip command:", error);
    showAlert(
      "error",
      "Batch Flip Failed",
      "Failed to flip selected photos. Please try again."
    );
  } finally {
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

const handleBatchCropImageSelect = (index: number) => {
  cropIndex.value = index;
  if (cropImageSrcURL) {
    URL.revokeObjectURL(cropImageSrcURL);
  }
  cropImageSrcURL = URL.createObjectURL(photos.value[cropIndex.value].original);
  cropImageSrc.value = cropImageSrcURL;
  showBatchCropSelector.value = false;
  showCropModal.value = true;
  startCropSuggestionForIndex(index);
};

const handleBatchCropSelectorClose = () => {
  // User cancelled the selector
  showBatchCropSelector.value = false;
  batchCropIndices.value = [];
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
      blobFromFile
    );
    await undoRedoManager.executeCommand(command);
  } catch (error) {
    console.error("Failed to execute batch crop command:", error);
    showAlert(
      "error",
      "Batch Crop Failed",
      "Failed to crop selected photos. Please try again."
    );
  } finally {
    await performanceLogger.endMeasurement(
      operationId,
      "crop",
      savedBatchCropIndices.length,
      workerUsed
    );
    batchCropIndices.value = [];
  }
};

const handleCropModalClose = () => {
  cancelCropSuggestion();
  resetCropSuggestion();
  showCropModal.value = false;
  batchCropIndices.value = [];
  if (cropImageSrcURL) {
    URL.revokeObjectURL(cropImageSrcURL);
    cropImageSrcURL = null;
  }
  cropImageSrc.value = "";
};

const handleNextBatchImage = () => {
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

const handlePreviousBatchImage = () => {
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

const handleBatchDownload = async () => {
  if (selectedIndices.value.length === 0) {
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

  try {
    const zip = new JSZip();
    const indices = selectedIndices.value;
    const chunkSize = getExportStripChunkSize();
    const settings = exportSettings();

    for (let i = 0; i < indices.length; i += chunkSize) {
      const chunk = indices.slice(i, i + chunkSize);

      const results = await Promise.all(
        chunk.map(async (index) => {
          const photo = photos.value[index];
          const prepared = await prepareExportFile(photo, settings);
          return prepared;
        })
      );

      for (const prepared of results) {
        if (prepared.path === 'passthrough') batchStats.passThroughCount++;
        else if (prepared.path === 'fast-path') batchStats.fastPathCount++;
        else batchStats.slowPathCount++;
        if (prepared.workerUsed) batchStats.workerUsed = true;

        zip.file(prepared.fileName, prepared.buffer);
      }
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `photos-${selectedIndices.value.length}-files.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error creating ZIP file:", error);
    for (const index of selectedIndices.value) {
      await handleDownload(index);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  } finally {
    performanceLogger.recordExportBatchStats(operationId, batchStats);
    await performanceLogger.endMeasurement(
      operationId,
      "download",
      selectedIndices.value.length,
      batchStats.workerUsed
    );
  }
};

const handleBatchRevert = async () => {
  const operationId = `batch-revert-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  try {
    await Promise.all(
      selectedIndices.value.map((index) => handleRevert(index))
    );
  } finally {
    await performanceLogger.endMeasurement(
      operationId,
      "revert",
      selectedIndices.value.length,
      false // Set to true once Web Workers are implemented (if applicable)
    );
  }
};

const handleBatchDelete = async () => {
  const indices = [...selectedIndices.value].sort((a, b) => b - a);
  const deleteCount = indices.length;

  const operationId = `batch-delete-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  isBatchDeleting.value = true;

  try {
    const idsToDelete: string[] = [];

    // 1. Collect IDs and notify UndoRedo
    for (const index of indices) {
      const photo = photos.value[index];
      if (photo && photo.id) {
        idsToDelete.push(photo.id);
        undoRedoManager.onPhotoDeleted(photo.id);
      }
    }

    // 2. Batch DB delete
    if (idsToDelete.length > 0) {
      await deletePhotos(idsToDelete);
    }

    // 3. UI updates (loop backwards to handle splices safely)
    for (const index of indices) {
      // Replicate UI cleanup logic from handleDelete
      if (cropIndex.value === index && showCropModal.value) {
        showCropModal.value = false;
        if (cropImageSrcURL) {
          URL.revokeObjectURL(cropImageSrcURL);
          cropImageSrcURL = null;
        }
        cropImageSrc.value = "";
        cropIndex.value = 0;
      }
      // Adjust cropIndex if needed
      if (cropIndex.value > index) {
        cropIndex.value--;
      }
      
      // Remove from array
      photos.value.splice(index, 1);
    }
  } catch (error) {
    console.error("Batch delete failed:", error);
    showAlert("error", "Delete Failed", "Failed to delete photos. Please try again.");
  } finally {
    isBatchDeleting.value = false;
    selectedIndices.value = [];

    await performanceLogger.endMeasurement(
      operationId,
      "delete",
      deleteCount,
      false 
    );

    trackPhotoDeletion(deleteCount);
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
    a.download = prepared.fileName;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
};

const handleRevert = async (index: number) => {
  const photo = photos.value[index];
  photos.value[index] = applyDisplayInvalidation(photo, {
    current: photo.original,
    cropHistory: [],
    cropFuture: [],
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

    // Delete from IndexedDB if photo has an ID
    if (photo.id) {
      try {
        // Clean up undo/redo history for this photo
        undoRedoManager.onPhotoDeleted(photo.id);
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

  try {
    const command = new PasteSettingsCommand(
      photoIds,
      copiedSettings.value,
      photos,
      updatePhoto,
      applyFlipsRotationAndCrop
    );
    await undoRedoManager.executeCommand(command);
  } catch (error) {
    console.error("Failed to execute paste settings command:", error);
    showAlert(
      "error",
      "Paste Failed",
      "Failed to paste settings. Please try again."
    );
  } finally {
    await performanceLogger.endMeasurement(
      operationId,
      "paste",
      photoIds.length,
      false
    );
  }
};

const blobFromFile = async (file: File): Promise<Blob> => {
  return new Blob([await file.arrayBuffer()], { type: file.type });
};

// Keyboard shortcuts handler for undo/redo
let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

// Initialize storage and load photos on mount
onMounted(async () => {
  try {
    await initDB();

    // Load photos from storage
    await loadPhotosFromStorage();

    // Keyboard shortcuts for undo/redo
    keyboardHandler = (e: KeyboardEvent) => {
      // Ctrl+Z (Cmd+Z on Mac) for undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        historyUndo().catch((error) => {
          console.error("Undo failed:", error);
        });
      }
      // Ctrl+Y or Ctrl+Shift+Z for redo
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        historyRedo().catch((error) => {
          console.error("Redo failed:", error);
        });
      }
    };

    document.addEventListener("keydown", keyboardHandler);

    // Set up cleanup interval (run every hour)
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
        console.error("Cleanup error:", error);
      }
    }, 60 * 60 * 1000); // 1 hour

    // Check storage status periodically
    setInterval(async () => {
      const status = await getStorageStatus();
      if (status.shouldWarn && status.message) {
        showAlert("warning", "Storage Warning", status.message, 6000);
      }
    }, 15 * 60 * 1000); // Every 15 minutes
  } catch (error) {
    console.error("Failed to initialize storage:", error);
    showAlert(
      "error",
      "Storage Error",
      "Failed to initialize storage. Photos will not be saved.",
      5000
    );
  }
});

onUnmounted(() => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
    keyboardHandler = null;
  }
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

.app-brand {
  flex: 0 0 auto;
  padding-top: 8px;
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1;
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
    padding-top: 7px;
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

  .size-button {
    min-width: 24px;
    padding: 2px 5px;
    font-size: 0.6rem;
  }
}
</style>
