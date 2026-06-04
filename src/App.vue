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
    <div class="add-delete-counters-container">
      <PhotoCounter
        :photo-count="photos.length"
        :new-photos-count="newPhotosCount"
      />
      <DeletedCounter :deleted-photos-count="deletedPhotosCount" />
    </div>
    <div class="counters-container">
      <PrimaryPhotoCounter :photo-count="photos.length" />
      <SelectCounter
        :selected-count="
          dragSelectionCount !== null
            ? dragSelectionCount
            : selectedIndices.length
        "
        :total-photos="photos.length"
      />
    </div>
    <DeletionNotification />
    <PhotoGrid
      :photos="photos"
      :selectedIndices="selectedIndices"
      :hasSelection="selectedIndices.length > 0"
      :allSelected="
        selectedIndices.length === photos.length && photos.length > 0
      "
      :hasCopiedSettings="hasCopiedSettings"
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
    <BatchCropSelector
      v-if="showBatchCropSelector"
      :show="showBatchCropSelector"
      :imageIndices="batchCropIndices"
      :photos="photos"
      @select="handleBatchCropImageSelect"
      @close="handleBatchCropSelectorClose"
    />
    <CropModal
      v-if="showCropModal"
      :show="showCropModal"
      :imageSrc="cropImageSrc"
      :initialCrop="photos[cropIndex]?.crop"
      :initialRotation="photos[cropIndex]?.rotation"
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
    />
    <PerformanceDashboard />
    <OptimizationCheckModal />
    <CopyPasteVisualizer />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import PhotoGrid from "./components/PhotoGrid.vue";
import CropModal from "./components/CropModal.vue";
import BatchCropSelector from "./components/BatchCropSelector.vue";
import StorageAlert from "./components/StorageAlert.vue";
import ShimmerBackground from "./components/ShimmerBackground.vue";
import DeletionNotification from "./components/DeletionNotification.vue";
import PhotoCounter from "./components/PhotoCounter.vue";
import DeletedCounter from "./components/DeletedCounter.vue";
import SelectCounter from "./components/SelectCounter.vue";
import PrimaryPhotoCounter from "./components/PrimaryPhotoCounter.vue";
import PerformanceDashboard from "./components/PerformanceDashboard.vue";
import OptimizationCheckModal from "./components/OptimizationCheckModal.vue";
import CopyPasteVisualizer from "./components/CopyPasteVisualizer.vue";
import JSZip from "jszip";
import { DOWNLOAD_PARALLEL_BATCH_SIZE } from "./constants/optimization";
import { copyPasteLogger } from "./utils/copyPasteLogger";
import { performanceLogger } from "./utils/performanceLogger";
import {
  initDB,
  savePhoto,
  updatePhoto,
  updatePhotosBatch,
  loadAllPhotos,
  deletePhoto,
  deletePhotos,
  cleanupExpiredPhotos,
  canStorePhoto,
  getStorageStatus,
} from "./utils/photoStorage";
import { runBatchFlip, runBatchCropRemaining, runBatchPaste } from "./utils/batchImageOps";
import { UndoRedoManager, FlipCommand } from "./utils/undoRedo";
import type { Photo } from "./types/photo";
import { blobToFile } from "./utils/blobToFile";
import { createThumbnailFromFile } from "./utils/thumbnailGenerator";
import { createThumbhashFromBlob } from "./utils/thumbhashGenerator";
import { scheduleThumbnailBackfill } from "./utils/thumbnailBackfill";
import { applyDisplayInvalidation } from "./utils/thumbnailInvalidation";
import { processInChunks } from "./utils/scheduler";

interface CopiedSettings {
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
}

const photos = ref<Photo[]>([]);
const newPhotosCount = ref(0);
const deletedPhotosCount = ref(0);

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

const UPLOAD_THUMB_CHUNK_SIZE = 3;

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

// Helper function to apply rotation and crop to an image
// Crop coordinates are relative to the original (non-rotated) image
const applyRotationAndCrop = async (
  image: HTMLImageElement,
  rotation: number,
  crop: { x: number; y: number; width: number; height: number },
  mimeType: string
): Promise<Blob | null> => {
  // Normalize rotation to 0-360 range
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const rotationRad = (normalizedRotation * Math.PI) / 180;

  const imgWidth = image.naturalWidth;
  const imgHeight = image.naturalHeight;

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
    // 90 degrees clockwise: dimensions swap, coordinates transform
    rotatedWidth = imgHeight;
    rotatedHeight = imgWidth;
    cropX = crop.y;
    cropY = imgWidth - crop.x - crop.width;
    cropWidth = crop.height;
    cropHeight = crop.width;
  } else if (normalizedRotation === 180) {
    // 180 degrees: dimensions stay same, coordinates flip
    rotatedWidth = imgWidth;
    rotatedHeight = imgHeight;
    cropX = imgWidth - crop.x - crop.width;
    cropY = imgHeight - crop.y - crop.height;
    cropWidth = crop.width;
    cropHeight = crop.height;
  } else if (normalizedRotation === 270) {
    // 270 degrees (or -90): dimensions swap, coordinates transform
    rotatedWidth = imgHeight;
    rotatedHeight = imgWidth;
    cropX = imgHeight - crop.y - crop.height;
    cropY = crop.x;
    cropWidth = crop.height;
    cropHeight = crop.width;
  } else {
    // 0 degrees: no transformation
    rotatedWidth = imgWidth;
    rotatedHeight = imgHeight;
    cropX = crop.x;
    cropY = crop.y;
    cropWidth = crop.width;
    cropHeight = crop.height;
  }

  // Create canvas for the rotated full image
  const rotatedCanvas = document.createElement("canvas");
  rotatedCanvas.width = rotatedWidth;
  rotatedCanvas.height = rotatedHeight;
  const rotatedCtx = rotatedCanvas.getContext("2d")!;

  // Apply rotation transformation
  rotatedCtx.save();
  rotatedCtx.translate(rotatedWidth / 2, rotatedHeight / 2);
  rotatedCtx.rotate(rotationRad);
  rotatedCtx.drawImage(image, -imgWidth / 2, -imgHeight / 2);
  rotatedCtx.restore();

  // Create canvas for the final cropped result
  const canvas = document.createElement("canvas");
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const ctx = canvas.getContext("2d")!;

  // Crop from the rotated image
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
      newPhotosCount.value = loadedPhotos.length;
      // Reset after animation completes (2 seconds) plus small buffer
      setTimeout(() => {
        newPhotosCount.value = 0;
      }, 2100);
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
  if (input.files) {
    const validFiles = Array.from(input.files).filter((file) =>
      file.type.startsWith("image/")
    );

    if (validFiles.length === 0) return;

    // Check storage quota before uploading
    const uploadPromises = validFiles.map(async (file) => {
      const check = await canStorePhoto(file);
      if (!check.canStore) {
        showAlert(
          "error",
          "Storage Limit",
          check.reason || "Cannot store photo",
          5000
        );
        return null;
      }
      return file;
    });

    const checkedFiles = (await Promise.all(uploadPromises)).filter(
      (f): f is File => f !== null
    );

    if (checkedFiles.length === 0) return;

    // Check storage status for warnings
    const status = await getStorageStatus();
    if (status.shouldWarn) {
      showAlert("warning", "Storage Warning", status.message || "", 6000);
    }

    // Start performance measurement
    const operationId = `upload-${Date.now()}`;
    performanceLogger.startMeasurement(operationId);

    // Save to IndexedDB and add to photos array
    const newPhotos: Photo[] = [];
    const uploadResults = await processInChunks(
      checkedFiles,
      async (file) => {
        try {
          const thumbnailBlob = await createThumbnailFromFile(file);
          const thumbhash = await createThumbhashFromBlob(thumbnailBlob);
          const id = await savePhoto(
            file,
            file,
            {
              name: file.name,
              flips: { horizontal: false, vertical: false },
              ...(thumbhash ? { thumbhash } : {}),
            },
            thumbnailBlob
          );
          const thumbnailFile = blobToFile(
            thumbnailBlob,
            `thumb-${file.name}`,
            "image/jpeg"
          );
          return { id, file, thumbnailFile, thumbhash };
        } catch (error) {
          console.error("Failed to save photo to storage:", error);
          showAlert(
            "error",
            "Upload Error",
            `Failed to save ${file.name}. Please try again.`,
            5000
          );
          return null;
        }
      },
      UPLOAD_THUMB_CHUNK_SIZE
    );

    for (const result of uploadResults) {
      if (!result) continue;
      newPhotos.push({
        id: result.id,
        original: result.file,
        current: result.file,
        thumbnail: result.thumbnailFile,
        thumbhash: result.thumbhash,
        thumbRevision: 0,
        cropHistory: [],
        cropFuture: [],
        flips: { horizontal: false, vertical: false },
        rotation: undefined,
      });
    }

    photos.value.push(...newPhotos);

    // End performance measurement
    await performanceLogger.endMeasurement(
      operationId,
      "upload",
      newPhotos.length,
      false // Upload doesn't use workers
    );
    // Show notification for new photos
    if (newPhotos.length > 0) {
      newPhotosCount.value = newPhotos.length;
      // Reset after animation completes (2 seconds) plus small buffer
      setTimeout(() => {
        newPhotosCount.value = 0;
      }, 2100);
    }

    // Clear input
    input.value = "";
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
    await undoRedoManager.executeCommand(command);
  } catch (error) {
    console.error("Failed to execute flip command:", error);
    showAlert("error", "Flip Failed", "Failed to flip photo. Please try again.");
  }
};

const openCropModal = (index: number) => {
  console.log("Opening crop modal for index:", index);
  // Clear batch crop mode for individual crops
  batchCropIndices.value = [];
  cropIndex.value = index;
  // Revoke old URL if exists
  if (cropImageSrcURL) {
    URL.revokeObjectURL(cropImageSrcURL);
  }
  // Always use original image for cropping - crop coordinates are relative to original
  // The CropModal will apply rotation visually via initialRotation prop
  // This prevents double-rotation and ensures crop coordinates work correctly
  // Tier 2 full-res — not for grid
  cropImageSrcURL = URL.createObjectURL(photos.value[index].original);
  cropImageSrc.value = cropImageSrcURL;
  showCropModal.value = true;
};

const handleCrop = async (
  blob: Blob,
  crop: { x: number; y: number; width: number; height: number },
  rotation: number
) => {
  console.log("=== HANDLE CROP ===");
  console.log("Crop index:", cropIndex.value);
  console.log("Received crop coordinates:", crop);
  console.log("Received rotation angle:", rotation);
  const photo = photos.value[cropIndex.value];
  console.log("Photo ID:", photo.id);
  const newFile = new File([blob], photo.current.name, {
    type: photo.current.type,
  });
  photos.value[cropIndex.value] = applyDisplayInvalidation(photo, {
    current: newFile,
    original: photo.original,
    cropHistory: [...photo.cropHistory, await blobFromFile(photo.current)],
    cropFuture: [],
    crop,
    rotation,
  });

  // Save to IndexedDB if photo has an ID
  if (photo.id) {
    try {
      console.log(
        "Saving to IndexedDB with crop:",
        crop,
        "rotation:",
        rotation
      );
      await updatePhoto(photo.id, newFile, {
        flips: photo.flips,
        crop,
        rotation,
      });
      console.log("Successfully saved to IndexedDB");
    } catch (error) {
      console.error("Failed to update photo in storage:", error);
    }
  } else {
    console.warn("Photo does not have an ID - cannot save to IndexedDB");
  }

  console.log("Stored crop in photo:", photos.value[cropIndex.value].crop);
  console.log(
    "Stored rotation in photo:",
    photos.value[cropIndex.value].rotation
  );
  console.log("=== END HANDLE CROP ===");
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

  let workerUsed = false;

  try {
    const result = await runBatchFlip(
      selectedIndices.value,
      direction,
      photos,
      updatePhotosBatch,
      blobToFile,
      (index, dir) => handleFlip(index, dir)
    );
    workerUsed = result.workerUsed;
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
  // User selected an image from the selector
  cropIndex.value = index;
  // Revoke old URL if exists
  if (cropImageSrcURL) {
    URL.revokeObjectURL(cropImageSrcURL);
  }
  // Always use original image for cropping - crop coordinates are relative to original
  // Tier 2 full-res — not for grid
  cropImageSrcURL = URL.createObjectURL(photos.value[cropIndex.value].original);
  cropImageSrc.value = cropImageSrcURL;
  // Close selector and open crop modal
  showBatchCropSelector.value = false;
  showCropModal.value = true;
};

const handleBatchCropSelectorClose = () => {
  // User cancelled the selector
  showBatchCropSelector.value = false;
  batchCropIndices.value = [];
};

const handleBatchCropNext = async (
  blob: Blob,
  crop: { x: number; y: number; width: number; height: number },
  rotation: number
) => {
  console.log("=== BATCH CROP NEXT ===");
  console.log("Batch crop indices:", batchCropIndices.value);
  console.log("Crop coordinates:", crop);

  // Save the batch crop indices BEFORE any operations that might clear them
  const savedBatchCropIndices = [...batchCropIndices.value];
  console.log("Saved batch crop indices:", savedBatchCropIndices);

  // Start performance measurement for batch crop
  const operationId = `batch-crop-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  // Crop the first image (the one shown in the modal)
  await handleCrop(blob, crop, rotation);

  // Close the modal
  showCropModal.value = false;

  // Get the remaining indices to crop (all except the first one we just cropped)
  const remainingIndices = savedBatchCropIndices.slice(1);
  console.log("Remaining indices to crop:", remainingIndices);

  let workerUsed = false;

  if (remainingIndices.length > 0) {
    console.log(`Applying crop to ${remainingIndices.length} remaining images`);
    
    // Use worker helper
    const result = await runBatchCropRemaining(
      remainingIndices,
      crop,
      rotation,
      photos,
      updatePhotosBatch,
      blobToFile,
      blobFromFile,
      async (index) => {
        // Fallback logic (original main thread implementation)
        console.log(`Batch cropping photo index ${index}`);
        const photo = photos.value[index];

        // Start with original image
        const img = new Image();
        img.src = URL.createObjectURL(photo.original);
        await new Promise((resolve) => {
          img.onload = resolve;
        });

        // Apply rotation and crop using helper function
        const cropBlob = await applyRotationAndCrop(
          img,
          rotation,
          crop,
          photo.current.type
        );

        if (cropBlob) {
          const newFile = new File([cropBlob], photo.current.name, {
            type: photo.current.type,
          });
          photos.value[index] = applyDisplayInvalidation(photo, {
            current: newFile,
            crop: {
              x: crop.x,
              y: crop.y,
              width: crop.width,
              height: crop.height,
            },
            rotation,
            cropHistory: [
              ...photo.cropHistory,
              await blobFromFile(photo.current),
            ],
            cropFuture: [],
          });

          // Save to IndexedDB if photo has an ID
          if (photo.id) {
            try {
              await updatePhoto(photo.id, newFile, {
                flips: photo.flips,
                crop: {
                  x: crop.x,
                  y: crop.y,
                  width: crop.width,
                  height: crop.height,
                },
                rotation,
              });
            } catch (error) {
              console.error(
                `Failed to update photo ${index} in storage:`,
                error
              );
            }
          }

          console.log(`Successfully batch cropped photo ${index}`);
        } else {
          console.warn(
            `Failed to create blob for batch crop on photo ${index}`
          );
        }
      }
    );
    workerUsed = result.workerUsed;
    console.log("Finished batch cropping all remaining images");
  } else {
    console.log("No remaining indices to crop");
  }

  // End performance measurement
  await performanceLogger.endMeasurement(
    operationId,
    "crop",
    savedBatchCropIndices.length,
    workerUsed
  );

  // Clear the batch crop indices
  batchCropIndices.value = [];
  console.log("=== END BATCH CROP NEXT ===");
};

const handleCropModalClose = () => {
  showCropModal.value = false;
  batchCropIndices.value = [];
  // Clean up URL
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
    }
  }
};

const handleBatchDownload = async () => {
  if (selectedIndices.value.length === 0) {
    return;
  }

  const operationId = `batch-download-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  try {
    const zip = new JSZip();
    const indices = selectedIndices.value;

    // Process in chunks to parallelize reads without OOM
    for (let i = 0; i < indices.length; i += DOWNLOAD_PARALLEL_BATCH_SIZE) {
      const chunk = indices.slice(i, i + DOWNLOAD_PARALLEL_BATCH_SIZE);
      
      const results = await Promise.all(
        chunk.map(async (index) => {
          const photo = photos.value[index];
          // Read buffer in parallel
          const buffer = await photo.current.arrayBuffer();
          return { name: photo.current.name, buffer };
        })
      );

      // Add to zip (synchronous add, lightweight)
      for (const result of results) {
        zip.file(result.name, result.buffer);
      }
    }

    // Generate and download the ZIP file
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
    // Fallback to individual downloads if ZIP fails
    for (const index of selectedIndices.value) {
      await handleDownload(index);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  } finally {
    await performanceLogger.endMeasurement(
      operationId,
      "download",
      selectedIndices.value.length,
      false
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

    // Track batch deletion for counter animation
    deletedPhotosCount.value = deleteCount;
    setTimeout(() => {
      deletedPhotosCount.value = 0;
    }, 2100);
  }
};

const handleDownload = async (index: number) => {
  const photo = photos.value[index];
  // Tier 2 full-res — not for grid
  const url = URL.createObjectURL(photo.current);
  const a = document.createElement("a");
  a.href = url;
  a.download = photo.current.name;
  a.click();
  URL.revokeObjectURL(url);
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
      deletedPhotosCount.value = 1;
      setTimeout(() => {
        deletedPhotosCount.value = 0;
      }, 2100);
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
  console.log("=== PASTE SETTINGS ===");
  if (!copiedSettings.value) {
    console.warn("No copied settings to paste");
    return;
  }
  const settings = copiedSettings.value;
  console.log("Pasting settings:", settings);

  // If singleIndex is provided, paste to just that photo; otherwise paste to all selected
  const indicesToPaste =
    singleIndex !== undefined ? [singleIndex] : selectedIndices.value;
  console.log("Target indices:", indicesToPaste);

  const operationId = `batch-paste-${Date.now()}`;
  performanceLogger.startMeasurement(operationId);

  let workerUsed = false;

  try {
    const result = await runBatchPaste(
      indicesToPaste,
      settings,
      photos,
      updatePhotosBatch,
      blobToFile,
      blobFromFile,
      async (index) => {
        // Fallback logic
        console.log(`--- Processing photo index ${index} ---`);
        const photo = photos.value[index];
        
        // Apply transformations starting from original image to ensure absolute values are applied
        if (settings.crop) {
          console.log("Applying crop with coordinates:", settings.crop);
          const img = new Image();
          img.src = URL.createObjectURL(photo.original);
          await new Promise((resolve) => {
            img.onload = resolve;
          });

          const rotationToApply = settings.rotation || 0;
          const blob = await applyFlipsRotationAndCrop(
            img,
            settings.flips,
            rotationToApply,
            settings.crop,
            photo.original.type
          );
          if (blob) {
            const newFile = new File([blob], photo.original.name, {
              type: photo.original.type,
            });
            const updatedCrop = {
              x: settings.crop.x,
              y: settings.crop.y,
              width: settings.crop.width,
              height: settings.crop.height,
            };
            photos.value[index] = applyDisplayInvalidation(photo, {
              current: newFile,
              flips: { ...settings.flips },
              crop: updatedCrop,
              rotation: rotationToApply,
              cropHistory: [
                ...photo.cropHistory,
                await blobFromFile(photo.current),
              ],
              cropFuture: [],
            });

            if (photo.id) {
              try {
                await updatePhoto(photo.id, newFile, {
                  flips: settings.flips,
                  crop: updatedCrop,
                  rotation: settings.rotation,
                });
              } catch (error) {
                console.error(
                  `Failed to update photo ${index} in storage:`,
                  error
                );
              }
            }
            console.log(
              `Photo ${index} crop applied successfully. Final crop:`,
              photos.value[index].crop
            );
          } else {
            console.warn("Failed to create blob in handlePasteSettings");
          }
        } else {
          // No crop, but we may still need to apply flips
          if (settings.flips.horizontal !== photo.flips.horizontal) {
            console.log("Applying horizontal flip to match copied settings...");
            await handleFlip(index, "horizontal");
          }
          if (settings.flips.vertical !== photo.flips.vertical) {
            console.log("Applying vertical flip to match copied settings...");
            await handleFlip(index, "vertical");
          }
          // Update rotation if provided (even without crop)
          if (
            settings.rotation !== undefined &&
            settings.rotation !== photo.rotation
          ) {
            const updatedPhoto = photos.value[index];
            photos.value[index] = {
              ...updatedPhoto,
              rotation: settings.rotation,
            };
          }
        }
        console.log(`--- Finished processing photo index ${index} ---`);
      }
    );
    workerUsed = result.workerUsed;

    // Log paste operation (simplified logging, original detailed logging was removed/simplified)
    // The original code had complex logging logic inside the loop which gathered results.
    // We lost that detailed gathering with runBatchPaste.
    // But basic logging is fine. The logger utility might need updates if it depends on return value.
    // copyPasteLogger.logPaste(...) requires detailed results.
    // For now, we skip detailed paste logging or implement it later.
    // Or we could return results from runBatchPaste?
    // runBatchPaste returns { workerUsed }.
    // Let's assume basic performance logging is sufficient for P0.
    
  } finally {
    await performanceLogger.endMeasurement(
      operationId,
      "paste",
      indicesToPaste.length,
      workerUsed
    );
  }
  console.log("=== END PASTE SETTINGS ===");
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
        undoRedoManager.undo().catch((error) => {
          console.error("Undo failed:", error);
        });
      }
      // Ctrl+Y or Ctrl+Shift+Z for redo
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        undoRedoManager.redo().catch((error) => {
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
  flex-direction: row;
  width: 100%;
  height: 100%;
  text-align: center;
}

.counters-container {
  position: fixed;
  top: calc(20px + env(safe-area-inset-top, 0px));
  right: 9%;
  padding-right: env(safe-area-inset-right, 0px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1001;
  pointer-events: none;
  align-items: flex-end;
}

.add-delete-counters-container {
  position: fixed;
  top: calc(20px + env(safe-area-inset-top, 0px));
  left: 9%;
  padding-left: env(safe-area-inset-left, 0px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1001;
  pointer-events: none;
  align-items: flex-start;
}
</style>
