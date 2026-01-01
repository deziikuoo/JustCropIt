<template>
  <div class="LeftSide-container">
    <div
      class="tools-container"
      :class="{ collapsed: leftSidebarCollapsed }"
      v-show="photos.length > 0"
    >
      <div
        class="sidebar-toggle"
        @click="leftSidebarCollapsed = !leftSidebarCollapsed"
      >
        <i
          :class="
            leftSidebarCollapsed
              ? 'fas fa-chevron-right'
              : 'fas fa-chevron-left'
          "
        ></i>
      </div>
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
            title="Flip Horizontally"
          >
            <i class="fas fa-arrows-left-right"></i>
            <span>Flip H</span>
          </button>
          <button
            class="Flip V"
            :disabled="!hasSelection"
            @click="$emit('batch-flip', 'vertical')"
            title="Flip Vertically"
          >
            <i class="fas fa-arrows-up-down"></i>
            <span>Flip V</span>
          </button>
          <button
            class="Crop"
            :disabled="!hasSelection"
            @click="$emit('batch-crop')"
            title="Crop"
          >
            <i class="fas fa-crop"></i>
            <span>Crop</span>
          </button>
          <button
            class="Revert"
            :disabled="!hasSelection"
            @click="$emit('batch-revert')"
            title="Revert"
          >
            <i class="fas fa-undo"></i>
            <span>Revert</span>
          </button>
          <button
            class="Download"
            :disabled="!hasSelection"
            @click="$emit('batch-download')"
            title="Download Selected"
          >
            <i class="fas fa-download"></i>
            <span>Download</span>
          </button>
          <button
            class="Delete"
            :disabled="!hasSelection"
            @click="$emit('batch-delete')"
            title="Delete Selected"
          >
            <i class="fas fa-trash"></i>
            <span>Delete</span>
          </button>
        </div>
        <div class="clipboard-actions" v-show="hasCopiedSettings">
          <button
            class="PasteSettings"
            @click="$emit('paste-settings')"
            title="Paste Settings"
          >
            <i class="fas fa-paste"></i>
            <span>Paste</span>
          </button>
          <button
            class="ClearClipboard"
            @click="$emit('clear-clipboard')"
            title="Clear Copied Settings"
          >
            <i class="fas fa-times"></i>
            <span>Clear</span>
          </button>
        </div>
      </div>
    </div>
  </div>
  <div class="photoGrid-container" @dblclick="handleContainerDoubleClick">
    <div class="header">
      <h1>JustCropIt</h1>
      <div class="photo-input-wrapper">
        <input
          class="photo-input"
          type="file"
          multiple
          accept="image/*"
          @change="$emit('upload', $event)"
        />
      </div>
    </div>
    <div class="grid-wrapper" ref="gridWrapperRef">
      <PrimaryPhotoCounter :photo-count="photos.length" />
      <div class="grid" :style="{ gridTemplateColumns: currentGridTemplate }">
        <div
          v-for="(photo, index) in photos"
          :key="`${index}-${photo.current.name}`"
          :ref="(el) => setPhotoCardRef(el as HTMLElement, index)"
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
          <div class="image-container">
            <img
              v-if="photoUrl(photo.current, index)"
              :src="photoUrl(photo.current, index)!"
              alt="Uploaded photo"
              @error="handleImageError(index)"
              draggable="false"
              @dragstart.prevent
            />
            <div v-else class="image-placeholder"></div>
          </div>
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
            <button
              class="Revert"
              @click="$emit('revert', index)"
              title="Revert"
            >
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
            <button
              class="Delete"
              @click="$emit('delete', index)"
              title="Delete"
            >
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="RightSide-container">
    <div
      class="size-controls-container"
      :class="{ dimmed: sizeControlsDimmed }"
      @mouseenter="handleSizeControlsMouseEnter"
      @mouseleave="handleSizeControlsMouseLeave"
      v-show="photos.length > 0"
    >
      <div class="photos-size-controls">
        <label>Size:</label>
        <div class="size-buttons-container">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  watch,
  onMounted,
  onUnmounted,
  computed,
  nextTick,
  type Ref,
} from "vue";
import { useLazyImage } from "../composables/useLazyImage";
import { useTouchCapability } from "../composables/useTouchCapability";
import { usePinchZoom } from "../composables/usePinchZoom";
import PrimaryPhotoCounter from "./PrimaryPhotoCounter.vue";

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
  (e: "deselect-multiple", indices: number[]): void;
  (e: "drag-selection-progress", count: number): void;
}>();

const urlCache = ref<Map<File, string>>(new Map());
const photoCardRefs = ref<Map<number, HTMLElement>>(new Map());
const visibleIndices = ref<Set<number>>(new Set());

// Set template ref for photo card
const setPhotoCardRef = (el: HTMLElement | null, index: number) => {
  if (el) {
    photoCardRefs.value.set(index, el);
  } else {
    photoCardRefs.value.delete(index);
  }
};

const photoUrl = (file: File, index: number): string | null => {
  // Only create URL if image is visible
  if (!visibleIndices.value.has(index)) {
    return null;
  }

  if (!urlCache.value.has(file)) {
    const url = URL.createObjectURL(file);
    urlCache.value.set(file, url);
  }
  return urlCache.value.get(file)!;
};

const handleImageError = (index: number) => {
  // Handle image load error - could add error state tracking here if needed
  console.warn(`Failed to load image at index ${index}`);
};

// Track observers to clean them up
const observerStops = ref<Map<number, () => void>>(new Map());
const elementRefs = ref<Map<number, Ref<HTMLElement | null | undefined>>>(new Map());

// Setup intersection observers when photo cards are added
watch(
  () => photoCardRefs.value.size,
  () => {
    nextTick(() => {
      for (const [index, element] of photoCardRefs.value) {
        // Only setup observer if not already visible and no observer exists
        if (!visibleIndices.value.has(index) && !elementRefs.value.has(index)) {
          const elementRef = ref<HTMLElement | null | undefined>(element);
          elementRefs.value.set(index, elementRef);

          const { isVisible, stop } = useLazyImage(elementRef);
          observerStops.value.set(index, stop);

          watch(
            isVisible,
            (visible) => {
              if (visible) {
                visibleIndices.value.add(index);
                // Clean up observer after visibility is set
                observerStops.value.delete(index);
                elementRefs.value.delete(index);
              }
            },
            { immediate: true }
          );
        }
      }
    });
  },
  { flush: "post" }
);

watch(
  () => props.photos,
  (newPhotos, oldPhotos) => {
    // Cleanup URL cache for removed photos
    const newFiles = new Set(newPhotos.map((p) => p.current));
    for (const [file, url] of urlCache.value) {
      if (!newFiles.has(file)) {
        URL.revokeObjectURL(url);
        urlCache.value.delete(file);
      }
    }

    // Clean up observers and visibility tracking for removed photos
    if (oldPhotos) {
      const oldIndices = new Set(oldPhotos.map((_, i) => i));
      const newIndices = new Set(newPhotos.map((_, i) => i));
      for (const index of oldIndices) {
        if (!newIndices.has(index)) {
          visibleIndices.value.delete(index);
          const stopObserver = observerStops.value.get(index);
          if (stopObserver) {
            stopObserver();
            observerStops.value.delete(index);
          }
        }
      }
    }
  },
  { deep: true }
);

onMounted(() => {
  resetSizeControlsDimTimer();
});

onUnmounted(() => {
  for (const [, url] of urlCache.value) {
    URL.revokeObjectURL(url);
  }
  urlCache.value.clear();

  // Clean up pinch zoom instance
  if (pinchZoomInstance?.cleanup) {
    pinchZoomInstance.cleanup();
    pinchZoomInstance = null;
  }

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

  // Clean up size controls dim timer
  if (sizeControlsDimTimer) {
    clearTimeout(sizeControlsDimTimer);
    sizeControlsDimTimer = null;
  }
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
const leftSidebarCollapsed = ref(false);
const sizeControlsDimmed = ref(false);
let sizeControlsDimTimer: ReturnType<typeof setTimeout> | null = null;

// Drag detection for activating select mode
const dragDetectionActive = ref(false);
const dragStartPosition = ref<{ x: number; y: number } | null>(null);
const dragDetectionThreshold = 10; // pixels of movement to detect drag

// Watch collapse state and update CSS variable for photo-counter positioning
// tools-container: 75% of 11.3% (LeftSide-container) when expanded, 50px/45px when collapsed
// Calculate the difference to move photo-counter left when collapsed
const updateToolsContainerMovement = () => {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const leftSidebarCollapsedValue = leftSidebarCollapsed.value;
  const isMobile = window.innerWidth <= 480;
  const isTablet = window.innerWidth <= 768;

  if (leftSidebarCollapsedValue) {
    const leftSideWidth = window.innerWidth * 0.113; // 11.3% of viewport
    const toolsExpandedWidth = leftSideWidth * 0.75; // 75% of left side
    const toolsCollapsedWidth = isMobile ? 45 : isTablet ? 50 : 50; // Responsive collapsed width
    const movement = toolsExpandedWidth - toolsCollapsedWidth;
    document.documentElement.style.setProperty(
      "--tools-container-movement",
      `${movement}px`
    );
    // Add left margin when collapsed (e.g., 12px spacing from collapsed container)
    document.documentElement.style.setProperty(
      "--photo-counter-collapsed-margin",
      "12px"
    );
  } else {
    document.documentElement.style.setProperty(
      "--tools-container-movement",
      "0px"
    );
    document.documentElement.style.setProperty(
      "--photo-counter-collapsed-margin",
      "0px"
    );
  }
};

watch(leftSidebarCollapsed, updateToolsContainerMovement, { immediate: true });

// Also update on window resize to recalculate movement
if (typeof window !== "undefined") {
  window.addEventListener("resize", updateToolsContainerMovement);
  onUnmounted(() => {
    window.removeEventListener("resize", updateToolsContainerMovement);
  });
}

// Drag-to-select state
const isDragSelecting = ref(false);
const isDeselecting = ref(false);
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

  // Check if starting drag on an already-selected image to determine if we're deselecting
  isDeselecting.value = isSelected(index);
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

  // Don't process drag if pinch is active (2 touches)
  if ("touches" in event && (event.touches.length === 2 || isPinching.value)) {
    return;
  }

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

    // Emit drag progress for real-time counter updates
    if (isDeselecting.value) {
      // When deselecting: show current selected minus what's being deselected
      const willBeDeselected = Array.from(draggedOverIndices.value).filter(
        (idx) => props.selectedIndices.includes(idx)
      );
      const dragCount = Math.max(
        0,
        props.selectedIndices.length - willBeDeselected.length
      );
      emit("drag-selection-progress", dragCount);
    } else {
      // When selecting: show current selected plus what's being selected (avoid double counting)
      const willBeSelected = Array.from(draggedOverIndices.value).filter(
        (idx) => !props.selectedIndices.includes(idx)
      );
      const dragCount = props.selectedIndices.length + willBeSelected.length;
      emit("drag-selection-progress", dragCount);
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

  // Convert Set to Array and sort to ensure consistent selection order
  const indicesToProcess = Array.from(draggedOverIndices.value).sort(
    (a, b) => a - b
  );

  const performedDragSelection =
    hasDragMoved.value || draggedOverIndices.value.size > 1;

  if (performedDragSelection && indicesToProcess.length > 0) {
    // If we started dragging on a selected image, deselect all dragged over images
    // Otherwise, select all dragged over images
    if (isDeselecting.value) {
      emit("deselect-multiple", indicesToProcess);
    } else {
      emit("select-multiple", indicesToProcess);
    }
  } else if (!performedDragSelection && dragStartedFromTouch.value) {
    const index = dragStartIndex.value;
    if (index !== null) {
      const currentlySelected = isSelected(index);
      emit("toggle-select", index, !currentlySelected);
    }
  }

  // Cleanup state
  isDragSelecting.value = false;
  isDeselecting.value = false;
  dragStartIndex.value = null;
  draggedOverIndices.value = new Set();
  lastProcessedIndex.value = null;
  dragIntent.value = "undetermined";
  touchStartPosition.value = null;
  hasDragMoved.value = false;
  dragStartedFromTouch.value = false;
  stopAutoScroll();

  // Clear drag progress
  emit("drag-selection-progress", -1);

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

  // Prevent default drag behavior
  event.preventDefault();

  // Start drag detection
  dragDetectionActive.value = true;
  dragStartPosition.value = { x: event.clientX, y: event.clientY };
  isHolding.value = true;
  heldPhotoIndex.value = index;
  justActivatedSelectMode.value = false;

  // Add mousemove listener for drag detection
  const handleDragDetectionMove = (moveEvent: MouseEvent) => {
    if (!dragDetectionActive.value || !dragStartPosition.value) {
      document.removeEventListener("mousemove", handleDragDetectionMove);
      document.removeEventListener("mouseup", handleDragDetectionEnd);
      return;
    }

    const deltaX = Math.abs(moveEvent.clientX - dragStartPosition.value.x);
    const deltaY = Math.abs(moveEvent.clientY - dragStartPosition.value.y);
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // If moved beyond threshold, activate select mode and start drag selection
    if (distance > dragDetectionThreshold) {
      // Clear hold timeout
      if (holdTimeout.value) {
        clearTimeout(holdTimeout.value);
        holdTimeout.value = null;
      }

      // Activate select mode
      if (!selectMode.value) {
        selectMode.value = true;
        justActivatedSelectMode.value = true;
      }

      // Start drag selection
      dragDetectionActive.value = false;
      document.removeEventListener("mousemove", handleDragDetectionMove);
      document.removeEventListener("mouseup", handleDragDetectionEnd);
      handleDragStart(index, moveEvent);
    }
  };

  const handleDragDetectionEnd = () => {
    dragDetectionActive.value = false;
    dragStartPosition.value = null;
    document.removeEventListener("mousemove", handleDragDetectionMove);
    document.removeEventListener("mouseup", handleDragDetectionEnd);

    // If we didn't activate select mode via drag, continue with hold logic
    if (!selectMode.value && isHolding.value) {
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
    } else {
      isHolding.value = false;
    }
  };

  document.addEventListener("mousemove", handleDragDetectionMove);
  document.addEventListener("mouseup", handleDragDetectionEnd);
};

// Touch start handler for mobile drag selection
const handlePhotoCardTouchStart = (index: number, event: TouchEvent) => {
  // Don't handle single touch if pinch is active (2 touches detected)
  if (event.touches.length === 2 || isPinching.value) {
    return;
  }

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

// Touch capability detection
const hasTouchCapability = useTouchCapability();

// Map pinch scale (0.5-2.0) to size indices (0-4)
// Track last index to prevent rapid back-and-forth changes
let lastSizeIndex = 2; // Start with medium (default)

const scaleToSizeIndex = (scale: number): number => {
  // Scale range: 0.5 (XS) to 2.0 (XL)
  // Map linearly to indices: 0 (XS) to 4 (XL)
  const normalizedScale = (scale - 0.5) / 1.5; // Normalize to 0-1
  const index = Math.round(normalizedScale * 4);
  const clampedIndex = Math.max(0, Math.min(4, index)); // Clamp to valid range

  // Only update if the index actually changed (prevents rapid toggling)
  if (clampedIndex !== lastSizeIndex) {
    lastSizeIndex = clampedIndex;
    return clampedIndex;
  }

  return lastSizeIndex;
};

// Track pinch state for conflict resolution
const isPinching = ref(false);

// Container ref for pinch zoom
const gridWrapperRef = ref<HTMLElement>();

// Initialize pinch zoom conditionally
let pinchZoomInstance: ReturnType<typeof usePinchZoom> | null = null;

watch(
  () =>
    hasTouchCapability.value && props.photos.length > 0 && gridWrapperRef.value,
  (shouldEnable) => {
    if (shouldEnable && !pinchZoomInstance && gridWrapperRef.value) {
      const handlePinchScaleChange = (scale: number) => {
        const newIndex = scaleToSizeIndex(scale);
        // Only update if index actually changed to prevent unnecessary re-renders
        if (newIndex !== selectedPhotoSize.value) {
          selectedPhotoSize.value = newIndex;
        }
      };

      pinchZoomInstance = usePinchZoom(handlePinchScaleChange, gridWrapperRef, {
        minScale: 0.5,
        maxScale: 2.0,
      });

      // Sync isPinching ref
      watch(
        () => pinchZoomInstance?.isPinching.value,
        (pinching) => {
          if (pinching !== undefined) {
            isPinching.value = pinching;
          }
        },
        { immediate: true }
      );
    } else if (!shouldEnable && pinchZoomInstance) {
      // Cleanup when conditions no longer met
      if (pinchZoomInstance.cleanup) {
        pinchZoomInstance.cleanup();
      }
      pinchZoomInstance = null;
    }
  },
  { immediate: true }
);

const currentGridTemplate = computed(() => {
  const size = photoSizes[selectedPhotoSize.value];

  // On mobile, use progressive sizing to differentiate all sizes
  if (typeof window !== "undefined" && window.innerWidth <= 480) {
    // Calculate container width (accounting for padding: 8px on each side = 16px total)
    const containerWidth = window.innerWidth - 16;

    // XL on mobile should force single column (full width minus gap)
    if (selectedPhotoSize.value === 4) {
      const xlSize = containerWidth - 12; // Full width minus gap to ensure single column
      return `repeat(auto-fill, minmax(${xlSize}px, 1fr))`;
    }

    // Mobile-specific size mapping for better differentiation
    // Provides distinct sizes: XS < S < M < L < XL
    const mobileSizeMap: Record<number, number> = {
      0: Math.floor(containerWidth * 0.45), // XS: ~211px on 485px screen
      1: Math.floor(containerWidth * 0.48), // S: ~225px
      2: Math.floor(containerWidth * 0.5), // M: ~234px
      3: Math.floor(containerWidth * 0.75), // L: ~352px (larger but still allows flexibility)
    };

    const mobileSize = mobileSizeMap[selectedPhotoSize.value];
    // Use the mobile-specific size, ensuring it's reasonable
    const finalSize = Math.max(140, Math.min(mobileSize, containerWidth - 12));

    return `repeat(auto-fill, minmax(${finalSize}px, 1fr))`;
  }

  if (selectedPhotoSize.value === 4) {
    // XL size - force single column on desktop, fit within side containers
    // Use calc() with percentages to ensure it fits within photoGrid-container
    // photoGrid-container is 77.4% of viewport (100% - 11.3% - 11.3%)
    // Account for padding (40px total) and gap (24px)
    return `repeat(auto-fill, minmax(calc(77.4vw - 64px), 1fr))`;
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

const resetSizeControlsDimTimer = () => {
  if (sizeControlsDimTimer) {
    clearTimeout(sizeControlsDimTimer);
    sizeControlsDimTimer = null;
  }
  sizeControlsDimmed.value = false;
  // Start dim timer after 6 seconds
  sizeControlsDimTimer = setTimeout(() => {
    sizeControlsDimmed.value = true;
  }, 6000);
};

const handleSizeControlsMouseEnter = () => {
  sizeControlsDimmed.value = false;
  if (sizeControlsDimTimer) {
    clearTimeout(sizeControlsDimTimer);
    sizeControlsDimTimer = null;
  }
};

const handleSizeControlsMouseLeave = () => {
  resetSizeControlsDimTimer();
};
</script>

<style scoped>
.header {
  margin: 60px 0 40px 0;
  text-align: center;
}

@media (max-width: 768px) {
  .header {
    margin: 20px 0 30px 0;
  }
}

@media (max-width: 480px) {
  .header {
    margin: 16px 0 24px 0;
  }
}

.LeftSide-container {
  position: fixed;
  left: 0;
  top: 0;
  width: 11.3%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  background-color: transparent;
  z-index: 1000;
  padding: 20px 0;
  padding-right: 24px; /* Add padding to accommodate toggle button */
  overflow-y: auto;
  overflow-x: visible; /* Allow toggle to be visible when expanded */
}

.tools-container {
  position: relative;
  width: 75%;
  height: 90vh;
  display: flex;
  flex-direction: column;
  background-color: none;
  transition: width 0.3s ease;
  border-radius: var(--border-radius);
  border: 2px solid var(--surface-border);
  margin-bottom: 16px;
  align-self: stretch;
  /* Collapse from right to left - left edge stays fixed */
  margin-right: 0;
  margin-left: 0;
  overflow: visible; /* Ensure toggle is visible */
}

.tools-container.collapsed {
  width: 50px;
  /* When collapsed, it shrinks from right, left edge stays at left: 0 */
}

.RightSide-container {
  position: fixed;
  right: 0;
  top: 0;
  width: 11.3%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  background: transparent;
  z-index: 1000;
  padding: 20px 0;
  padding-left: 24px; /* Add padding to accommodate any future elements */
  overflow-y: auto;
  overflow-x: visible;
}

.size-controls-container {
  position: relative;
  width: 45%;
  height: auto;
  display: flex;
  flex-direction: column;
  transform: translateX(117%);
  background: transparent;
  border-radius: var(--border-radius);
  border: 2px solid var(--surface-border);
  margin-bottom: 16px;
  align-self: stretch;
  overflow: visible;
  transition: opacity 0.1s ease-in-out;
}

.size-controls-container.dimmed {
  opacity: 0.4;
}

.sidebar-toggle {
  position: absolute;
  right: -20px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 48px;
  background-color: #292a2b;
  border: 2px solid var(--surface-border);
  border-left: none;
  border-radius: 0 8px 8px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 1001;
  color: #ffffff;
}

.sidebar-toggle:hover {
  background-color: #3a3b3c;
  border-color: #ffffff;
}

.sidebar-toggle i {
  font-size: 12px;
  transition: transform 0.3s ease;
}

.photoGrid-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  width: calc(100% - 22.6%); /* 100% - 11.3% (left) - 11.3% (right) = 77.4% */
  max-width: 1238px; /* 77.4% of original 1600px max-width to maintain proportions */
  margin-left: 11.3%; /* Account for fixed left sidebar */
  margin-right: auto;
  padding: env(safe-area-inset-top, 0px) 20px 0 20px;
  /* No transition on margin/width - should remain constant regardless of tools-container collapse */
}

@media (max-width: 768px) {
  .tools-container {
    height: 85vh;
  }

  .tools-container.collapsed {
    width: 50px;
  }

  .size-controls-container {
    height: 85vh;
  }

  .photoGrid-container {
    width: calc(100% - 22.6%);
    margin-left: 11.3%;
    padding: env(safe-area-inset-top, 0px) 12px 0 12px;
  }
}

@media (max-width: 480px) {
  .tools-container {
    height: 80vh;
  }

  .tools-container.collapsed {
    width: 45px;
  }

  .size-controls-container {
    height: 80vh;
  }

  .photoGrid-container {
    width: calc(100% - 22.6%);
    margin-left: 11.3%;
    padding: env(safe-area-inset-top, 0px) 8px 0 8px;
  }

  .sidebar-toggle {
    right: -18px;
    width: 20px;
    height: 40px;
  }
}

h1 {
  margin-top: 80px;
  font-size: 2.5rem;
  margin-bottom: 8px;
  background: linear-gradient(
    135deg,
    #d4af37 0%,
    #ffd700 30%,
    #ffffff 70%,
    #ffffff 100%
  );
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

@media (max-width: 480px) {
  h1 {
    margin-top: 0;
    font-size: 1.5rem;
    margin-bottom: 4px;
  }
}

.photo-input-wrapper {
  margin-top: 16px;
  position: relative;
  display: inline-block;
}

.photo-input-wrapper::before {
  content: "";
  position: absolute;
  inset: -2px;
  background: linear-gradient(
    135deg,
    #708090 0%,
    #8892a0 30%,
    #ffffff 70%,
    #ffffff 100%
  );
  border-radius: var(--border-radius);
  z-index: -1;
}

.photo-input {
  position: relative;
  border: 2px solid transparent !important;
  background: var(--surface-color);
  border-radius: var(--border-radius);
}

/* Global Feature Controls - Vertical Toolbar */
.global-feature-controls {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  padding: 10px 8px;
  border-radius: var(--border-radius);
  background: var(--surface-color);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-lg);
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
}

.global-feature-controls::-webkit-scrollbar {
  width: 6px;
}

.global-feature-controls::-webkit-scrollbar-track {
  background: transparent;
}

.global-feature-controls::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3);
  border-radius: 3px;
}

.global-feature-controls::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.5);
}

.tools-container.collapsed .global-feature-controls {
  display: none;
}

.global-feature-controls label {
  white-space: nowrap;
  font-weight: 500;
}

.batch-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.batch-actions button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px 8px;
  min-height: 48px;
  width: 100%;
  font-size: 0.75rem;
}

.batch-actions button i {
  font-size: 1rem;
}

.batch-actions button span {
  font-size: 0.7rem;
}

.select-controls {
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 8px;
  align-items: stretch;
}

.select-controls label {
  display: flex;
  align-items: center;
  gap: 2.5px;
  font-size: 0.75rem;
  white-space: nowrap;
  font-weight: 500;
  padding: 4px 0;
}

/* Specific rule for checkbox in global-feature-controls */
.global-feature-controls .select-controls label input[type="checkbox"] {
  margin-left: 2.5px;
  flex-shrink: 0; /* Prevent checkbox from shrinking in flex container */
  flex-grow: 0; /* Prevent checkbox from growing */
  width: 18px !important; /* Force width to prevent compression */
  height: 18px !important; /* Force height to prevent compression */
  box-sizing: border-box; /* Ensure border is included in dimensions */
}

.select-controls button {
  width: 100%;
  padding: 10px 8px;
  min-height: 40px;
  font-size: 0.8rem;
}

.clipboard-actions {
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 8px;
  align-items: stretch;
}

.clipboard-actions button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px 8px;
  min-height: 48px;
  width: 100%;
  font-size: 0.75rem;
}

.clipboard-actions button i {
  font-size: 1rem;
}

.clipboard-actions button span {
  font-size: 0.7rem;
}

/* Photos Size Controls - Vertical */
.photos-size-controls {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 16px 12px;
  border-radius: var(--border-radius);
  background: var(--surface-color);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-lg);
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
}

.photos-size-controls::-webkit-scrollbar {
  width: 6px;
}

.photos-size-controls::-webkit-scrollbar-track {
  background: transparent;
}

.photos-size-controls::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3);
  border-radius: 3px;
}

.photos-size-controls::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.5);
}

.photos-size-controls label {
  white-space: nowrap;
  font-weight: 500;
  font-size: 0.8rem;
  margin-bottom: 4px;
}

.size-buttons-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.size-button {
  padding: 10px 8px;
  width: 100%;
  min-height: 36px;
  font-size: 0.75rem;
}

.size-button.active {
  background: rgba(255, 255, 255, 0.25);
  border-color: #aaa;
}

/* Photo Grid Wrapper */
.grid-wrapper {
  position: relative;
  display: flex;
  justify-content: center;
  width: 100%;
  margin-top: 24px;
  margin-bottom: 60px;
  /* No touch-action - allow all gestures, use preventDefault to block browser zoom */
}

/* Photo Grid */
.grid {
  display: grid;
  gap: 24px;
  width: fit-content;
  max-width: 100%;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  transition: grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

@media (max-width: 768px) {
  .grid-wrapper {
    margin-top: 20px;
    margin-bottom: 40px;
  }

  .grid {
    gap: 16px;
  }
}

@media (max-width: 480px) {
  .grid-wrapper {
    margin-top: 16px;
    margin-bottom: 30px;
  }

  .grid {
    gap: 12px;
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

  .photo-card:hover .image-container img {
    transform: scale(1.02);
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

/* Image Container */
.image-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

/* Photo Image */
.image-container img {
  max-height: 100%;
  max-width: 100%;
  object-fit: contain;
  border-radius: var(--border-radius-sm);
  transition: opacity var(--transition-normal),
    transform var(--transition-normal);
}

/* Image Placeholder */
.image-placeholder {
  width: 80%;
  height: 80%;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.05) 0%,
    rgba(136, 146, 160, 0.03) 30%,
    rgba(136, 146, 160, 0.02) 70%,
    rgba(107, 116, 128, 0.02) 100%
  );
  border: 1px solid rgba(136, 146, 160, 0.1);
  border-radius: var(--border-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.image-placeholder::before {
  content: "";
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: linear-gradient(
    45deg,
    transparent 30%,
    rgba(136, 146, 160, 0.05) 50%,
    transparent 70%
  );
  animation: shimmer 2s infinite;
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%) translateY(-100%) rotate(45deg);
  }
  100% {
    transform: translateX(100%) translateY(100%) rotate(45deg);
  }
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
