<template>
  <div class="photoGrid-container" @dblclick="handleContainerDoubleClick">
    <div class="header">
      <h1>JustCropIt</h1>
      <input
        class="photo-input"
        type="file"
        multiple
        accept="image/*"
        @change="$emit('upload', $event)"
      />
    </div>
    <div class="top-controls-container" v-show="photos.length > 0">
      <div class="global-feature-controls">
        <div
          class="select-controls"
          :class="{ 'select-mode-active': selectMode }"
        >
          <label v-show="selectMode">
            <input
              type="checkbox"
              :checked="allSelected"
              @change="handleToggleSelectAll($event)"
            />
            {{ hasSelection ? "Deselect All" : "Select All" }}
          </label>
          <button
            class="Select"
            @click="handleSelectModeClick"
            :title="selectMode ? 'Exit Select Mode' : 'Enter Select Mode'"
          >
            {{ selectMode ? "Exit Select" : "Select" }}
          </button>
        </div>
        <div class="batch-actions" v-show="selectMode">
          <button
            class="Flip H"
            :disabled="!hasSelection"
            @click="$emit('batch-flip', 'horizontal')"
          >
            Flip H
          </button>
          <button
            class="Flip V"
            :disabled="!hasSelection"
            @click="$emit('batch-flip', 'vertical')"
          >
            Flip V
          </button>
          <button
            class="Crop"
            :disabled="!hasSelection"
            @click="$emit('batch-crop')"
          >
            Crop
          </button>
          <button
            class="Revert"
            :disabled="!hasSelection"
            @click="$emit('batch-revert')"
          >
            Revert
          </button>
          <button
            class="Download"
            :disabled="!hasSelection"
            @click="$emit('batch-download')"
            title="Download Selected"
          >
            Download
          </button>
          <button
            class="Delete"
            :disabled="!hasSelection"
            @click="$emit('batch-delete')"
            title="Delete Selected"
          >
            Delete
          </button>
        </div>
        <div class="clipboard-actions" v-show="hasCopiedSettings">
          <button
            class="PasteSettings"
            @click="$emit('paste-settings')"
            title="Paste Settings"
          >
            Paste Settings
          </button>
          <button
            class="ClearClipboard"
            @click="$emit('clear-clipboard')"
            title="Clear Copied Settings"
          >
            Clear Clipboard
          </button>
        </div>
      </div>
      <div class="photos-size-controls">
        <label>Photo Size:</label>
        <button
          v-for="(size, index) in photoSizes"
          :key="index"
          @click="selectedPhotoSize = index"
          :class="{ active: selectedPhotoSize === index }"
          class="size-button"
          :title="size.label"
        >
          {{ size.label }}
        </button>
      </div>
    </div>
    <div class="grid" :style="{ gridTemplateColumns: currentGridTemplate }">
      <div
        v-for="(photo, index) in photos"
        :key="`${index}-${photo.current.name}`"
        class="photo-card"
        :data-photo-index="index"
        :class="{
          selected: isSelected(index),
          'select-mode': selectMode,
          'dragging-over': draggedOverIndices.has(index),
        }"
        @click="handlePhotoCardClick(index, $event)"
        @mousedown="handlePhotoCardMouseDown(index, $event)"
        @mouseup="handlePhotoCardMouseUp"
        @mouseleave="handlePhotoCardMouseUp"
        @touchstart="handlePhotoCardTouchStart(index, $event)"
      >
        <input
          type="checkbox"
          class="photo-checkbox"
          :checked="isSelected(index)"
          @change="handleToggleSelect(index, $event)"
          @click.stop
        />
        <img :src="photoUrl(photo.current)" alt="Uploaded photo" />
        <div class="actions">
          <button
            class="Flip H"
            @click="$emit('flip', index, 'horizontal')"
            title="Flip Horizontally"
          >
            <i class="fas fa-arrows-left-right"></i>
          </button>
          <button
            class="Flip V"
            @click="$emit('flip', index, 'vertical')"
            title="Flip Vertically"
          >
            <i class="fas fa-arrows-up-down"></i>
          </button>
          <button class="Crop" @click="$emit('crop', index)" title="Crop">
            <i class="fas fa-crop"></i>
          </button>
          <button
            class="CopySettings"
            @click="$emit('copy-settings', index)"
            title="Copy Settings"
          >
            <i class="fas fa-copy"></i>
          </button>
          <button
            class="PasteSettings"
            :disabled="!hasCopiedSettings"
            @click="$emit('paste-settings', index)"
            title="Paste Settings"
          >
            <i class="fas fa-paste"></i>
          </button>
          <button class="Revert" @click="$emit('revert', index)" title="Revert">
            <i class="fas fa-undo"></i>
          </button>
        </div>
        <div class="actions-bottom">
          <button
            class="Download"
            @click="$emit('download', index)"
            title="Download"
          >
            <i class="fas fa-download"></i>
          </button>
          <button class="Delete" @click="$emit('delete', index)" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from "vue";

interface Photo {
  original: File;
  current: File;
  cropHistory: Blob[];
  cropFuture: Blob[];
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
}

const props = defineProps<{
  photos: Photo[];
  selectedIndices: number[];
  hasSelection: boolean;
  allSelected: boolean;
  hasCopiedSettings: boolean;
}>();

const emit = defineEmits<{
  (e: "upload", event: Event): void;
  (e: "flip", index: number, direction: "horizontal" | "vertical"): void;
  (e: "crop", index: number): void;
  (e: "download", index: number): void;
  (e: "revert", index: number): void;
  (e: "delete", index: number): void;
  (e: "copy-settings", index: number): void;
  (e: "paste-settings", index?: number): void;
  (e: "toggle-select-all", checked: boolean): void;
  (e: "toggle-select", index: number, checked: boolean): void;
  (e: "batch-flip", direction: "horizontal" | "vertical"): void;
  (e: "batch-crop"): void;
  (e: "batch-download"): void;
  (e: "batch-revert"): void;
  (e: "batch-delete"): void;
  (e: "clear-clipboard"): void;
  (e: "select-multiple", indices: number[]): void;
}>();

const urlCache = ref<Map<File, string>>(new Map());

const photoUrl = (file: File): string => {
  if (!urlCache.value.has(file)) {
    const url = URL.createObjectURL(file);
    urlCache.value.set(file, url);
  }
  return urlCache.value.get(file)!;
};

watch(
  () => props.photos,
  (newPhotos) => {
    const newFiles = new Set(newPhotos.map((p) => p.current));
    for (const [file, url] of urlCache.value) {
      if (!newFiles.has(file)) {
        URL.revokeObjectURL(url);
        urlCache.value.delete(file);
      }
    }
  },
  { deep: true }
);

onUnmounted(() => {
  for (const [, url] of urlCache.value) {
    URL.revokeObjectURL(url);
  }
  urlCache.value.clear();

  // Clean up drag selection event listeners on unmount
  document.removeEventListener("mousemove", handleDragMove);
  document.removeEventListener("mouseup", handleDragEnd);
  document.removeEventListener("touchmove", handleDragMove);
  document.removeEventListener("touchend", handleDragEnd);
  document.removeEventListener("touchcancel", handleDragEnd);
  stopAutoScroll();
  document.body.classList.remove("drag-selecting");
  dragIntent.value = "undetermined";
  touchStartPosition.value = null;
});

const isSelected = (index: number): boolean =>
  props.selectedIndices.includes(index);

const handleToggleSelectAll = (event: Event) => {
  const target = event.target as HTMLInputElement;
  emit("toggle-select-all", target.checked);
};

const handleToggleSelect = (index: number, event: Event) => {
  const target = event.target as HTMLInputElement;
  emit("toggle-select", index, target.checked);
};

const selectMode = ref(false);
const holdTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const isHolding = ref(false);
const heldPhotoIndex = ref<number | null>(null);
const justActivatedSelectMode = ref(false);

// Drag-to-select state
const isDragSelecting = ref(false);
const dragStartIndex = ref<number | null>(null);
const draggedOverIndices = ref<Set<number>>(new Set());
const lastProcessedIndex = ref<number | null>(null);
const autoScrollInterval = ref<number | null>(null);
const autoScrollDirection = ref<"up" | "down" | null>(null);
const dragIntent = ref<"undetermined" | "scroll" | "select">("undetermined");
const touchStartPosition = ref<{ x: number; y: number } | null>(null);
const hasDragMoved = ref(false);
const dragStartedFromTouch = ref(false);

// Helper function to extract photo index from DOM element
const getPhotoIndexFromElement = (element: Element | null): number | null => {
  if (!element) return null;
  const photoCard = element.closest(".photo-card");
  if (!photoCard) return null;
  const indexAttr = photoCard.getAttribute("data-photo-index");
  if (indexAttr === null) return null;
  const index = parseInt(indexAttr, 10);
  return isNaN(index) ? null : index;
};

const stopAutoScroll = () => {
  if (autoScrollInterval.value !== null) {
    clearInterval(autoScrollInterval.value);
    autoScrollInterval.value = null;
  }
  autoScrollDirection.value = null;
};

const startAutoScroll = (direction: "up" | "down") => {
  if (autoScrollDirection.value === direction) {
    return;
  }
  stopAutoScroll();
  autoScrollDirection.value = direction;
  autoScrollInterval.value = window.setInterval(() => {
    const scrollAmount = direction === "down" ? 20 : -20;
    window.scrollBy({ top: scrollAmount, behavior: "auto" });
  }, 16);
};

// Drag-to-select handlers
const handleDragStart = (index: number, event: MouseEvent | TouchEvent) => {
  // Only activate if in select mode
  if (!selectMode.value) return;

  const target = event.target as HTMLElement;
  // Ignore drags starting on action buttons, checkboxes, or action containers
  if (
    target.closest(".actions") ||
    target.closest(".actions-bottom") ||
    target.closest(".photo-checkbox")
  ) {
    return;
  }

  // Prevent default to avoid text selection
  event.preventDefault();

  hasDragMoved.value = false;
  dragStartedFromTouch.value = event.type === "touchstart";
  isDragSelecting.value = true;
  dragStartIndex.value = index;
  draggedOverIndices.value = new Set([index]);
  lastProcessedIndex.value = index;
  dragIntent.value = "undetermined";
  touchStartPosition.value =
    "touches" in event && event.touches.length > 0
      ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
      : { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };

  // Add class to body to prevent text selection
  document.body.classList.add("drag-selecting");

  // Add global event listeners
  if (event.type === "mousedown") {
    document.addEventListener("mousemove", handleDragMove);
    document.addEventListener("mouseup", handleDragEnd);
  } else if (event.type === "touchstart") {
    // For touch, use passive: false but only preventDefault when over photo cards
    document.addEventListener("touchmove", handleDragMove, { passive: false });
    document.addEventListener("touchend", handleDragEnd);
    document.addEventListener("touchcancel", handleDragEnd);
  }
};

const handleDragMove = (event: MouseEvent | TouchEvent) => {
  if (!isDragSelecting.value) return;

  // Get client coordinates
  let clientX: number;
  let clientY: number;

  if ("touches" in event && event.touches.length > 0) {
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  } else if ("clientX" in event) {
    clientX = event.clientX;
    clientY = event.clientY;
    // Prevent default for mouse events to avoid text selection
    event.preventDefault();
  } else {
    return;
  }

  // Determine intent for touch events based on initial movement
  if (
    "touches" in event &&
    dragIntent.value === "undetermined" &&
    touchStartPosition.value
  ) {
    const deltaX = Math.abs(clientX - touchStartPosition.value.x);
    const deltaY = Math.abs(clientY - touchStartPosition.value.y);
    const threshold = 10;
    if (deltaX > threshold || deltaY > threshold) {
      dragIntent.value = deltaX >= deltaY ? "select" : "scroll";
    }
  }

  // If intent is scroll, allow default behavior and handle auto-scroll
  if ("touches" in event && dragIntent.value === "scroll") {
    const edgeThreshold = 80;
    if (clientY >= window.innerHeight - edgeThreshold) {
      startAutoScroll("down");
    } else if (clientY <= edgeThreshold) {
      startAutoScroll("up");
    } else {
      stopAutoScroll();
    }
    return;
  }

  // For mouse events, stop auto scroll
  if (!("touches" in event)) {
    stopAutoScroll();
  }

  // If intent is still undetermined (no significant movement yet), exit
  if ("touches" in event && dragIntent.value === "undetermined") {
    return;
  }

  hasDragMoved.value = true;

  // Check multiple points around cursor to catch photos we might skip when dragging quickly
  const checkPoints = [
    { x: clientX, y: clientY }, // Center
    { x: clientX - 12, y: clientY }, // Left
    { x: clientX + 12, y: clientY }, // Right
    { x: clientX, y: clientY - 12 }, // Top
    { x: clientX, y: clientY + 12 }, // Bottom
  ];

  const foundIndices = new Set<number>();
  let primaryIndex: number | null = null;

  // Check all points around cursor
  for (const point of checkPoints) {
    const element = document.elementFromPoint(point.x, point.y);
    const index = getPhotoIndexFromElement(element);
    if (index !== null) {
      if (primaryIndex === null) {
        primaryIndex = index;
      }
      foundIndices.add(index);
    }
  }

  // If we have a valid primary index and a starting index, include the full range between them
  if (primaryIndex !== null && dragStartIndex.value !== null) {
    const start = Math.min(dragStartIndex.value, primaryIndex);
    const end = Math.max(dragStartIndex.value, primaryIndex);
    for (let i = start; i <= end; i += 1) {
      foundIndices.add(i);
    }
  }

  // Add all found indices to draggedOverIndices
  if (foundIndices.size > 0) {
    draggedOverIndices.value = new Set([
      ...draggedOverIndices.value,
      ...foundIndices,
    ]);

    // Update last processed index to the primary index (closest to cursor)
    if (primaryIndex !== null) {
      lastProcessedIndex.value = primaryIndex;
    }
  }

  // For touch events, prevent default when selecting to avoid scrolling
  if ("touches" in event && dragIntent.value === "select") {
    if (foundIndices.size > 0) {
      event.preventDefault();
    }
    const edgeThreshold = 80;
    if (clientY >= window.innerHeight - edgeThreshold) {
      startAutoScroll("down");
    } else if (clientY <= edgeThreshold) {
      startAutoScroll("up");
    } else {
      stopAutoScroll();
    }
  } else if (!("touches" in event)) {
    stopAutoScroll();
  }
};

const handleDragEnd = () => {
  if (!isDragSelecting.value) return;

  // Select all photos that were dragged over
  // Convert Set to Array and sort to ensure consistent selection order
  const indicesToSelect = Array.from(draggedOverIndices.value).sort(
    (a, b) => a - b
  );

  const performedDragSelection =
    hasDragMoved.value || draggedOverIndices.value.size > 1;

  if (performedDragSelection && indicesToSelect.length > 0) {
    emit("select-multiple", indicesToSelect);
  } else if (!performedDragSelection && dragStartedFromTouch.value) {
    const index = dragStartIndex.value;
    if (index !== null) {
      const currentlySelected = isSelected(index);
      emit("toggle-select", index, !currentlySelected);
    }
  }

  // Cleanup state
  isDragSelecting.value = false;
  dragStartIndex.value = null;
  draggedOverIndices.value = new Set();
  lastProcessedIndex.value = null;
  dragIntent.value = "undetermined";
  touchStartPosition.value = null;
  hasDragMoved.value = false;
  dragStartedFromTouch.value = false;
  stopAutoScroll();

  // Remove class from body
  document.body.classList.remove("drag-selecting");

  // Remove global event listeners
  document.removeEventListener("mousemove", handleDragMove);
  document.removeEventListener("mouseup", handleDragEnd);
  document.removeEventListener("touchmove", handleDragMove);
  document.removeEventListener("touchend", handleDragEnd);
  document.removeEventListener("touchcancel", handleDragEnd);
};

const handleSelectModeClick = () => {
  if (selectMode.value) {
    // Exiting select mode - deselect all images
    emit("toggle-select-all", false);
  }
  selectMode.value = !selectMode.value;
};

const handleContainerDoubleClick = (event: MouseEvent) => {
  // Only exit select mode if we're in select mode and the double-click is outside photo cards
  if (!selectMode.value) {
    return;
  }

  const target = event.target as HTMLElement;

  // Don't exit if double-clicked on interactive elements
  if (
    target.closest(".photo-card") ||
    target.closest(".global-feature-controls") ||
    target.closest("button") ||
    target.closest("input") ||
    target.closest("label")
  ) {
    return;
  }

  // Double-clicked outside photo cards and interactive elements - exit select mode
  emit("toggle-select-all", false);
  selectMode.value = false;
};

const handlePhotoCardMouseDown = (index: number, event: MouseEvent) => {
  const target = event.target as HTMLElement;

  // If in select mode, use drag selection
  if (selectMode.value) {
    handleDragStart(index, event);
    return;
  }

  // Don't activate hold-to-select if clicking on interactive elements
  if (
    target.closest(".actions") ||
    target.closest(".actions-bottom") ||
    target.closest(".photo-checkbox")
  ) {
    return;
  }

  isHolding.value = true;
  heldPhotoIndex.value = index;
  justActivatedSelectMode.value = false;

  // Set timeout to activate select mode after 500ms of holding
  holdTimeout.value = setTimeout(() => {
    if (isHolding.value && !selectMode.value) {
      selectMode.value = true;
      justActivatedSelectMode.value = true;
      // Also select the photo that was being held
      if (!isSelected(index)) {
        emit("toggle-select", index, true);
      }
    }
    holdTimeout.value = null;
  }, 500);
};

// Touch start handler for mobile drag selection
const handlePhotoCardTouchStart = (index: number, event: TouchEvent) => {
  const target = event.target as HTMLElement;

  // If in select mode, use drag selection
  if (selectMode.value) {
    handleDragStart(index, event);
    return;
  }

  // Don't activate hold-to-select if touching on interactive elements
  if (
    target.closest(".actions") ||
    target.closest(".actions-bottom") ||
    target.closest(".photo-checkbox")
  ) {
    return;
  }

  isHolding.value = true;
  heldPhotoIndex.value = index;
  justActivatedSelectMode.value = false;

  // Set timeout to activate select mode after 500ms of holding
  holdTimeout.value = setTimeout(() => {
    if (isHolding.value && !selectMode.value) {
      selectMode.value = true;
      justActivatedSelectMode.value = true;
      // Also select the photo that was being held
      if (!isSelected(index)) {
        emit("toggle-select", index, true);
      }
    }
    holdTimeout.value = null;
  }, 500);
};

const handlePhotoCardMouseUp = () => {
  isHolding.value = false;
  if (holdTimeout.value) {
    clearTimeout(holdTimeout.value);
    holdTimeout.value = null;
  }
  // Reset the flag after a delay to allow the click event to be prevented
  if (justActivatedSelectMode.value) {
    setTimeout(() => {
      justActivatedSelectMode.value = false;
      heldPhotoIndex.value = null;
    }, 150);
  } else {
    heldPhotoIndex.value = null;
  }
};

// Photo size options: smallest, small, medium (default), large, largest
const photoSizes = [
  { label: "XS", minSize: 180 },
  { label: "S", minSize: 220 },
  { label: "M", minSize: 280 }, // Default
  { label: "L", minSize: 350 },
  { label: "XL", minSize: 400 },
];

const selectedPhotoSize = ref(2); // Default to medium (index 2)

const currentGridTemplate = computed(() => {
  const size = photoSizes[selectedPhotoSize.value];

  // On mobile, ensure minimum 2 columns for better layout
  if (typeof window !== "undefined" && window.innerWidth <= 480) {
    if (selectedPhotoSize.value >= 3) {
      // Large sizes on mobile - cap at 50% minus gap
      return `repeat(auto-fill, minmax(min(${size.minSize}px, calc(50% - 6px)), 1fr))`;
    }
    // Smaller sizes on mobile - allow more columns but ensure minimum size
    return `repeat(auto-fill, minmax(${Math.max(size.minSize, 140)}px, 1fr))`;
  }

  if (selectedPhotoSize.value === 4) {
    // Largest size - ensure at least 2 columns by capping max at 50% minus gap
    return `repeat(auto-fill, minmax(min(${size.minSize}px, calc(50% - 12px)), 1fr))`;
  }
  return `repeat(auto-fill, minmax(${size.minSize}px, 1fr))`;
});

const handlePhotoCardClick = (index: number, event: Event) => {
  // Prevent click if select mode was just activated via hold gesture on this specific photo
  if (justActivatedSelectMode.value && heldPhotoIndex.value === index) {
    return;
  }

  // Only allow card click selection when in select mode
  if (selectMode.value) {
    const target = event.target as HTMLElement;
    // Don't trigger if clicking on action buttons or checkbox
    if (
      !target.closest(".actions") &&
      !target.closest(".actions-bottom") &&
      !target.closest(".photo-checkbox")
    ) {
      const isCurrentlySelected = isSelected(index);
      emit("toggle-select", index, !isCurrentlySelected);
    }
  }
};
</script>

<style scoped>
.header {
  margin: 60px 0 40px 0;
  text-align: center;
}

.photoGrid-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  width: 92%;
  max-width: 1600px;
  margin: 0 auto;
  padding: 0 20px;
}

@media (max-width: 768px) {
  .photoGrid-container {
    width: 95%;
    padding: 0 12px;
  }
}

@media (max-width: 480px) {
  .photoGrid-container {
    width: 100%;
    padding: 0 8px;
  }
}

h1 {
  margin-top: 80px;
  font-size: 2.5rem;
  margin-bottom: 8px;
  background: linear-gradient(
    135deg,
    #ffffff 0%,
    #fff9e6 30%,
    #ffd700 70%,
    #d4af37 100%
  );
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

@media (max-width: 480px) {
  h1 {
    margin-top: 100px;
    font-size: 1.5rem;
    margin-bottom: 4px;
  }
}

.photo-input {
  margin-top: 16px;
}

/* Top Controls Container */
.top-controls-container {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 20px;
  width: 96%;
  max-width: 1600px;
  z-index: 100;
}

@media (max-width: 768px) {
  .top-controls-container {
    width: 95%;
    top: 10px;
    gap: 12px;
  }
}

@media (max-width: 480px) {
  .top-controls-container {
    width: 98%;
    top: 8px;
    gap: 8px;
    flex-wrap: wrap;
  }
}

/* Global Feature Controls */
.global-feature-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 5px;
  padding: 12px 20px;
  border-radius: var(--border-radius);
  border: 1px solid var(--surface-border);
  background: var(--surface-color);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-lg);
  flex: 1;
  max-width: 50%;
}

@media (max-width: 768px) {
  .global-feature-controls {
    padding: 10px 12px;
    gap: 6px;
    max-width: none;
  }
}

@media (max-width: 480px) {
  .global-feature-controls {
    padding: 8px 10px;
    gap: 5px;
    max-width: none;
    width: 100%;
  }
}

.global-feature-controls label {
  white-space: nowrap;
  font-weight: 500;
}

.batch-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  width: 100%;
  justify-content: center;
}

@media (max-width: 480px) {
  .batch-actions {
    flex-wrap: wrap;
    gap: 6px;
  }

  .batch-actions button {
    font-size: 0.75rem;
    padding: 6px 10px;
    min-height: 36px;
  }
}

.select-controls {
  display: flex;
  width: 100%;
  gap: 8px;
  justify-content: center;
  align-items: center;
}

.select-controls.select-mode-active {
  justify-content: space-between;
}

@media (max-width: 480px) {
  .select-controls {
    gap: 6px;
  }

  .select-controls button {
    font-size: 0.75rem;
    padding: 6px 10px;
    min-height: 36px;
  }

  .select-controls label {
    font-size: 0.75rem;
  }
}

.clipboard-actions {
  display: flex;
  width: 100%;
  gap: 8px;
  justify-content: space-between;
  align-items: center;
}

@media (max-width: 480px) {
  .clipboard-actions {
    gap: 6px;
  }

  .clipboard-actions button {
    font-size: 0.75rem;
    padding: 6px 10px;
    min-height: 36px;
    flex: 1;
  }
}

/* Photos Size Controls */
.photos-size-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: var(--border-radius);
  border: 1px solid var(--surface-border);
  background: var(--surface-color);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-lg);
}

.photos-size-controls label {
  white-space: nowrap;
  font-weight: 500;
  margin-right: 4px;
}

.size-button {
  padding: 4px 10px;
  min-width: 32px;
  font-size: 0.75rem;
}

@media (max-width: 768px) {
  .photos-size-controls {
    padding: 10px 12px;
    gap: 6px;
  }
}

@media (max-width: 480px) {
  .photos-size-controls {
    padding: 8px 10px;
    gap: 4px;
    width: 100%;
  }

  .size-button {
    padding: 6px 8px;
    min-width: 36px;
    min-height: 36px;
    font-size: 0.7rem;
  }

  .photos-size-controls label {
    font-size: 0.75rem;
  }
}

.size-button.active {
  background: rgba(255, 255, 255, 0.25);
  border-color: #aaa;
}

/* Photo Grid */
.grid {
  display: grid;
  gap: 24px;
  margin-top: 24px;
  margin-bottom: 60px;
  width: 100%;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
}

@media (max-width: 768px) {
  .grid {
    gap: 16px;
    margin-top: 20px;
    margin-bottom: 40px;
  }
}

@media (max-width: 480px) {
  .grid {
    gap: 12px;
    margin-top: 16px;
    margin-bottom: 30px;
  }
}

/* Photo Card */
.photo-card {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--border-radius);
  border: 1px solid var(--surface-border);
  background: var(--surface-color);
  overflow: hidden;
  transition: all var(--transition-normal);
  box-shadow: var(--shadow-sm);
  touch-action: pan-y; /* Allow vertical scrolling on touch */
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
}

.photo-card.select-mode {
  cursor: grab;
}

.photo-card.select-mode:active {
  cursor: grabbing;
}

/* Only apply hover effects on devices that support hover (desktop) */
@media (hover: hover) {
  .photo-card:hover {
    border-color: #ffffff;
    box-shadow: 0 0 8px rgba(255, 215, 0, 0.15), var(--shadow-md);
    transform: translateY(-4px);
  }

  .photo-card.select-mode:hover {
    border-color: #ffffff;
  }

  .photo-card:hover .photo-checkbox,
  .photo-card:hover .actions,
  .photo-card:hover .actions-bottom {
    opacity: 1;
  }

  .photo-card:hover img {
    transform: translate(-50%, -50%) scale(1.02);
  }
}

.photo-card.selected {
  border: 2px solid #ffffff;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.2),
    0 0 12px rgba(255, 255, 255, 0.3), var(--shadow-md);
}

/* Drag-to-select visual feedback */
.photo-card.dragging-over {
  border-color: #ffffff;
  background: rgba(255, 215, 0, 0.08);
  box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.3), 0 0 8px rgba(255, 215, 0, 0.2),
    var(--shadow-md);
}

.photo-card.dragging-over.selected {
  border-color: #ffffff;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35),
    0 0 12px rgba(255, 255, 255, 0.3), var(--shadow-md);
}

/* Photo Checkbox */
.photo-checkbox {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 3;
  width: 22px;
  height: 22px;
  opacity: 0;
  transition: opacity var(--transition-fast);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  background: rgba(30, 30, 46, 0.6);
  backdrop-filter: blur(8px);
}

.photo-checkbox:checked {
  background: linear-gradient(135deg, #ffd700 0%, #d4af37 100%);
  border-color: #ffffff;
  box-shadow: 0 0 8px rgba(255, 215, 0, 0.4), 0 0 0 2px rgba(255, 215, 0, 0.2);
}

.photo-checkbox:checked::after {
  content: "✓";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #1e1e2e;
  font-size: 14px;
  font-weight: bold;
}

.photo-card.selected .photo-checkbox {
  opacity: 1;
}

/* Show checkbox on mobile when in select mode */
@media (max-width: 768px) {
  .photo-card.select-mode .photo-checkbox {
    opacity: 1;
  }
}

/* Photo Image */
img {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  max-height: 90%;
  max-width: 90%;
  object-fit: contain;
  z-index: 1;
  border-radius: var(--border-radius-sm);
  transition: transform var(--transition-normal);
}

/* Top Actions */
.actions {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.7) 0%,
    transparent 100%
  );
  opacity: 0;
  transition: opacity var(--transition-normal);
}

.actions button {
  padding: 8px 12px;
  font-size: 0.8rem;
  background: rgba(30, 30, 46, 0.9);
  backdrop-filter: blur(8px);
}

.actions button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
}

/* Show actions on mobile (not just hover) */
@media (max-width: 768px) {
  .actions {
    opacity: 1;
    padding: 8px;
    gap: 6px;
  }

  .actions button {
    padding: 8px 10px;
    font-size: 0.75rem;
    min-height: 36px;
    min-width: 36px;
  }
}

@media (max-width: 480px) {
  .actions {
    padding: 6px;
    gap: 4px;
  }

  .actions button {
    padding: 6px 8px;
    font-size: 0.7rem;
    min-height: 32px;
    min-width: 32px;
  }

  .actions button i {
    font-size: 0.85rem;
  }
}

/* Bottom Actions */
.actions-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  padding: 12px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7) 0%, transparent 100%);
  opacity: 0;
  transition: opacity var(--transition-normal);
}

.actions-bottom button {
  padding: 8px 12px;
  font-size: 0.8rem;
  background: rgba(30, 30, 46, 0.9);
  backdrop-filter: blur(8px);
}

.actions-bottom button.Download:hover:not(:disabled) {
  background: var(--success-color);
  border-color: var(--success-color);
}

.actions-bottom button.Delete:hover:not(:disabled) {
  background: var(--danger-color);
  border-color: var(--danger-color);
}

/* Show bottom actions on mobile (not just hover) */
@media (max-width: 768px) {
  .actions-bottom {
    opacity: 1;
    padding: 8px;
  }

  .actions-bottom button {
    padding: 8px 14px;
    font-size: 0.75rem;
    min-height: 36px;
  }
}

@media (max-width: 480px) {
  .actions-bottom {
    padding: 6px;
  }

  .actions-bottom button {
    padding: 6px 10px;
    font-size: 0.7rem;
    min-height: 32px;
  }
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .photoGrid-container {
    width: 95%;
    padding: 0 12px;
  }

  .photo-checkbox {
    width: 24px;
    height: 24px;
    top: 8px;
    right: 8px;
  }
}

@media (max-width: 480px) {
  .photoGrid-container {
    width: 100%;
    padding: 0 8px;
  }

  .photo-input {
    margin-top: 12px;
  }

  .photo-input input[type="file"] {
    font-size: 0.8rem;
    padding: 8px 12px;
  }

  .photo-checkbox {
    width: 26px;
    height: 26px;
    top: 6px;
    right: 6px;
  }
}
</style>
