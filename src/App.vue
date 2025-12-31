<template>
  <div class="container">
    <StorageAlert
      :show="alert.show"
      :type="alert.type"
      :title="alert.title"
      :message="alert.message"
      :auto-dismiss="alert.autoDismiss"
      @dismiss="alert.show = false"
    />
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
    />
    <CropModal
      v-if="showCropModal"
      :show="showCropModal"
      :imageSrc="cropImageSrc"
      :initialCrop="photos[cropIndex]?.crop"
      @cropped="handleBatchCropNext"
      @close="handleCropModalClose"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from "vue";
import PhotoGrid from "./components/PhotoGrid.vue";
import CropModal from "./components/CropModal.vue";
import StorageAlert from "./components/StorageAlert.vue";
import JSZip from "jszip";
import {
  initDB,
  savePhoto,
  updatePhoto,
  loadAllPhotos,
  deletePhoto,
  cleanupExpiredPhotos,
  canStorePhoto,
  getStorageStatus,
  getExpirationInfo,
} from "./utils/photoStorage";

interface Photo {
  id?: string; // IndexedDB ID
  original: File;
  current: File;
  cropHistory: Blob[];
  cropFuture: Blob[];
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
}

interface CopiedSettings {
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
}

const photos = ref<Photo[]>([]);
const showCropModal = ref(false);
const cropImageSrc = ref("");
let cropIndex = 0;
const selectedIndices = ref<number[]>([]);
const batchCropIndices = ref<number[]>([]);
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

// Convert Blob to File helper
const blobToFile = (blob: Blob, fileName: string, mimeType: string): File => {
  return new File([blob], fileName, { type: mimeType });
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

      loadedPhotos.push({
        id: stored.id,
        original: originalFile,
        current: currentFile,
        cropHistory: [],
        cropFuture: [],
        flips: stored.metadata.flips,
        crop: stored.metadata.crop,
      });
    }

    photos.value = loadedPhotos;
    
    // Show info alert on first load if photos exist
    if (loadedPhotos.length > 0) {
      const expirationInfo = getExpirationInfo();
      showAlert(
        "info",
        "Photos Loaded",
        `${loadedPhotos.length} photo(s) loaded. ${expirationInfo.message}`,
        8000
      );
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
        showAlert("error", "Storage Limit", check.reason || "Cannot store photo", 5000);
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

    // Save to IndexedDB and add to photos array
    const newPhotos: Photo[] = [];
    for (const file of checkedFiles) {
      try {
        const id = await savePhoto(file, file, {
          name: file.name,
          flips: { horizontal: false, vertical: false },
        });

        newPhotos.push({
          id,
          original: file,
          current: file,
          cropHistory: [],
          cropFuture: [],
          flips: { horizontal: false, vertical: false },
        });
      } catch (error) {
        console.error("Failed to save photo to storage:", error);
        showAlert(
          "error",
          "Upload Error",
          `Failed to save ${file.name}. Please try again.`,
          5000
        );
      }
    }

    photos.value.push(...newPhotos);
    
    // Clear input
    input.value = "";
  }
};

const handleFlip = async (
  index: number,
  direction: "horizontal" | "vertical"
) => {
  const photo = photos.value[index];
  const img = new Image();
  img.src = URL.createObjectURL(photo.current);

  await new Promise((resolve) => {
    img.onload = resolve;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;

  if (direction === "horizontal") {
    ctx.scale(-1, 1);
    ctx.drawImage(img, -img.width, 0);
  } else {
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, -img.height);
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, photo.current.type)
  );
  if (blob) {
    const newFile = new File([blob], photo.current.name, {
      type: photo.current.type,
    });
    const updatedFlips = {
      ...photo.flips,
      [direction]: !photo.flips[direction],
    };
    
    photos.value[index] = {
      ...photo,
      current: newFile,
      flips: updatedFlips,
    };

    // Save to IndexedDB if photo has an ID
    if (photo.id) {
      try {
        await updatePhoto(photo.id, newFile, {
          flips: updatedFlips,
          crop: photo.crop,
        });
      } catch (error) {
        console.error("Failed to update photo in storage:", error);
      }
    }
  } else {
    console.warn("Failed to create blob in handleFlip");
  }
};

const openCropModal = (index: number) => {
  console.log("Opening crop modal for index:", index);
  cropIndex = index;
  // Always use original image for cropping, not the current (cropped) version
  cropImageSrc.value = URL.createObjectURL(photos.value[index].original);
  showCropModal.value = true;
};

const handleCrop = async (
  blob: Blob,
  crop: { x: number; y: number; width: number; height: number }
) => {
  console.log("=== HANDLE CROP ===");
  console.log("Crop index:", cropIndex);
  console.log("Received crop coordinates:", crop);
  const photo = photos.value[cropIndex];
  const newFile = new File([blob], photo.current.name, {
    type: photo.current.type,
  });
  photos.value[cropIndex] = {
    ...photo,
    current: newFile,
    original: photo.original,
    cropHistory: [...photo.cropHistory, await blobFromFile(photo.current)],
    cropFuture: [],
    crop,
  };
  
  // Save to IndexedDB if photo has an ID
  if (photo.id) {
    try {
      await updatePhoto(photo.id, newFile, {
        flips: photo.flips,
        crop,
      });
    } catch (error) {
      console.error("Failed to update photo in storage:", error);
    }
  }
  
  console.log("Stored crop in photo:", photos.value[cropIndex].crop);
  console.log("=== END HANDLE CROP ===");
};

const handleToggleSelectAll = debounce((checked: boolean) => {
  if (checked) {
    selectedIndices.value = photos.value.map((_, i) => i);
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

const handleSelectMultiple = (indices: number[]) => {
  if (!indices.length) {
    return;
  }
  const merged = new Set(selectedIndices.value);
  indices.forEach((index) => merged.add(index));
  selectedIndices.value = Array.from(merged).sort((a, b) => a - b);
};

const handleBatchFlip = async (direction: "horizontal" | "vertical") => {
  await Promise.all(
    selectedIndices.value.map((index) => handleFlip(index, direction))
  );
};

const handleBatchCrop = () => {
  if (selectedIndices.value.length > 0) {
    batchCropIndices.value = [...selectedIndices.value];
    cropIndex = batchCropIndices.value[0];
    // Always use original image for cropping
    cropImageSrc.value = URL.createObjectURL(photos.value[cropIndex].original);
    showCropModal.value = true;
  }
};

const handleBatchCropNext = async (
  blob: Blob,
  crop: { x: number; y: number; width: number; height: number }
) => {
  console.log("=== BATCH CROP NEXT ===");
  console.log("Batch crop indices:", batchCropIndices.value);
  console.log("Crop coordinates:", crop);
  
  // Save the batch crop indices BEFORE any operations that might clear them
  const savedBatchCropIndices = [...batchCropIndices.value];
  console.log("Saved batch crop indices:", savedBatchCropIndices);
  
  // Crop the first image (the one shown in the modal)
  await handleCrop(blob, crop);
  
  // Close the modal
  showCropModal.value = false;
  
  // Get the remaining indices to crop (all except the first one we just cropped)
  const remainingIndices = savedBatchCropIndices.slice(1);
  console.log("Remaining indices to crop:", remainingIndices);
  
  if (remainingIndices.length > 0) {
    console.log(`Applying crop to ${remainingIndices.length} remaining images`);
    // Apply the same crop coordinates to all remaining selected images
    // Preserve existing edits (flips, rotations, etc.) and apply crop on top
    await Promise.all(
      remainingIndices.map(async (index) => {
        console.log(`Batch cropping photo index ${index}`);
        const photo = photos.value[index];
        
        // Use current state to preserve existing edits (flips, rotations, etc.)
        let workingPhoto = photo;

        // Apply crop with the same coordinates to the current image state
        const img = new Image();
        img.src = URL.createObjectURL(workingPhoto.current);
        await new Promise((resolve) => {
          img.onload = resolve;
        });

        const canvas = document.createElement("canvas");
        const { x, y, width, height } = crop;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

        const cropBlob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, workingPhoto.current.type)
        );
        if (cropBlob) {
          const newFile = new File([cropBlob], workingPhoto.current.name, {
            type: workingPhoto.current.type,
          });
          const updatedPhoto = {
            ...workingPhoto,
            current: newFile,
            crop: { x, y, width, height },
            cropHistory: [
              ...workingPhoto.cropHistory,
              await blobFromFile(workingPhoto.current),
            ],
            cropFuture: [],
          };
          photos.value[index] = updatedPhoto;
          
          // Save to IndexedDB if photo has an ID
          if (workingPhoto.id) {
            try {
              await updatePhoto(workingPhoto.id, newFile, {
                flips: workingPhoto.flips,
                crop: { x, y, width, height },
              });
            } catch (error) {
              console.error(`Failed to update photo ${index} in storage:`, error);
            }
          }
          
          console.log(`Successfully batch cropped photo ${index}`);
        } else {
          console.warn(`Failed to create blob for batch crop on photo ${index}`);
        }
      })
    );
    console.log("Finished batch cropping all remaining images");
  } else {
    console.log("No remaining indices to crop");
  }
  
  // Clear the batch crop indices
  batchCropIndices.value = [];
  console.log("=== END BATCH CROP NEXT ===");
};

const handleCropModalClose = () => {
  showCropModal.value = false;
  batchCropIndices.value = [];
  cropImageSrc.value = "";
};

const handleBatchDownload = async () => {
  if (selectedIndices.value.length === 0) {
    return;
  }

  try {
    const zip = new JSZip();

    // Add all selected photos to the ZIP
    for (const index of selectedIndices.value) {
      const photo = photos.value[index];
      const arrayBuffer = await photo.current.arrayBuffer();
      zip.file(photo.current.name, arrayBuffer);
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
  }
};

const handleBatchRevert = async () => {
  await Promise.all(selectedIndices.value.map((index) => handleRevert(index)));
};

const handleBatchDelete = async () => {
  const indices = [...selectedIndices.value].sort((a, b) => b - a);
  await Promise.all(indices.map((index) => handleDelete(index)));
  selectedIndices.value = [];
};

const handleDownload = async (index: number) => {
  const photo = photos.value[index];
  const url = URL.createObjectURL(photo.current);
  const a = document.createElement("a");
  a.href = url;
  a.download = photo.current.name;
  a.click();
  URL.revokeObjectURL(url);
};

const handleRevert = async (index: number) => {
  const photo = photos.value[index];
  const revertedPhoto = {
    ...photo,
    current: photo.original,
    cropHistory: [],
    cropFuture: [],
    flips: { horizontal: false, vertical: false },
    crop: undefined,
  };
  photos.value[index] = revertedPhoto;
  
  // Save to IndexedDB if photo has an ID
  if (photo.id) {
    try {
      await updatePhoto(photo.id, photo.original, {
        flips: { horizontal: false, vertical: false },
        crop: undefined,
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
        await deletePhoto(photo.id);
      } catch (error) {
        console.error("Failed to delete photo from storage:", error);
      }
    }
    
    photos.value.splice(index, 1);
    if (cropIndex === index && showCropModal.value) {
      showCropModal.value = false;
      cropImageSrc.value = "";
      cropIndex = 0;
    }
    if (cropIndex > index) {
      cropIndex--;
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
  copiedSettings.value = {
    flips: { ...photo.flips },
    crop: photo.crop ? { ...photo.crop } : undefined,
  };
  console.log("Copied settings:", copiedSettings.value);
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
  const indicesToPaste = singleIndex !== undefined ? [singleIndex] : selectedIndices.value;
  console.log("Target indices:", indicesToPaste);
  
  await Promise.all(
    indicesToPaste.map(async (index) => {
      console.log(`--- Processing photo index ${index} ---`);
      const photo = photos.value[index];
      console.log("Current photo state - flips:", photo.flips, "crop:", photo.crop);
      
      // Preserve existing edits - use current state
      let workingPhoto = photo;

      // Apply flips to match the copied settings (only flip if current state doesn't match desired state)
      if (settings.flips.horizontal !== workingPhoto.flips.horizontal) {
        console.log("Applying horizontal flip to match copied settings...");
        await handleFlip(index, "horizontal");
        workingPhoto = photos.value[index];
      }
      if (settings.flips.vertical !== workingPhoto.flips.vertical) {
        console.log("Applying vertical flip to match copied settings...");
        await handleFlip(index, "vertical");
        workingPhoto = photos.value[index];
      }

      // Apply crop to the flipped (or original) image
      if (settings.crop) {
        console.log("Applying crop with coordinates:", settings.crop);
        const img = new Image();
        img.src = URL.createObjectURL(workingPhoto.current);
        await new Promise((resolve) => {
          img.onload = resolve;
        });

        console.log("Target image natural dimensions:", {
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight
        });
        console.log("Target image displayed dimensions:", {
          width: img.width,
          height: img.height
        });

        const canvas = document.createElement("canvas");
        const { x, y, width, height } = settings.crop;
        
        // Use natural coordinates directly (they were saved in natural px)
        const cropX = x;
        const cropY = y;
        const cropWidth = width;
        const cropHeight = height;
        
        console.log("Crop coordinates to apply:", { cropX, cropY, cropWidth, cropHeight });
        console.log("Crop bounds check:", {
          xInBounds: cropX >= 0 && cropX <= img.naturalWidth,
          yInBounds: cropY >= 0 && cropY <= img.naturalHeight,
          widthInBounds: cropX + cropWidth <= img.naturalWidth,
          heightInBounds: cropY + cropHeight <= img.naturalHeight
        });
        
        canvas.width = cropWidth;
        canvas.height = cropHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, workingPhoto.current.type)
        );
        if (blob) {
          const newFile = new File([blob], workingPhoto.current.name, {
            type: workingPhoto.current.type,
          });
          const updatedCrop = { x: cropX, y: cropY, width: cropWidth, height: cropHeight };
          const updatedPhoto = {
            ...workingPhoto,
            current: newFile,
            crop: updatedCrop,
            cropHistory: [
              ...workingPhoto.cropHistory,
              await blobFromFile(workingPhoto.current),
            ],
            cropFuture: [],
          };
          photos.value[index] = updatedPhoto;
          
          // Save to IndexedDB if photo has an ID
          if (workingPhoto.id) {
            try {
              await updatePhoto(workingPhoto.id, newFile, {
                flips: workingPhoto.flips,
                crop: updatedCrop,
              });
            } catch (error) {
              console.error(`Failed to update photo ${index} in storage:`, error);
            }
          }
          
          console.log(`Photo ${index} crop applied successfully. Final crop:`, photos.value[index].crop);
        } else {
          console.warn("Failed to create blob in handlePasteSettings");
        }
      } else {
        console.log("No crop to apply");
      }
      console.log(`--- Finished processing photo index ${index} ---`);
    })
  );
  console.log("=== END PASTE SETTINGS ===");
};

const blobFromFile = async (file: File): Promise<Blob> => {
  return new Blob([await file.arrayBuffer()], { type: file.type });
};

// Initialize storage and load photos on mount
onMounted(async () => {
  try {
    await initDB();
    
    // Show expiration info alert on first visit
    const hasSeenAlert = localStorage.getItem("photo-editor-seen-expiration-alert");
    if (!hasSeenAlert) {
      const expirationInfo = getExpirationInfo();
      showAlert(
        "info",
        "Important: Photo Storage",
        expirationInfo.message,
        10000
      );
      localStorage.setItem("photo-editor-seen-expiration-alert", "true");
    }
    
    // Load photos from storage
    await loadPhotosFromStorage();
    
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
});
</script>

<style scoped>
.container {
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  text-align: center;
  align-items: center;
}
</style>
