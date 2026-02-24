<template>
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
      <div
        class="select-controls-above-grid"
        :class="{ 'select-mode-active': selectMode }"
        v-show="photos.length > 0"
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
      <div class="grid-tools-wrapper">
        <aside
          class="tools-panel"
          :class="{ 'tools-panel--collapsed': leftSidebarCollapsed }"
          v-show="photos.length > 0"
          role="toolbar"
          aria-label="Batch editing tools"
        >
          <!-- Collapse/Expand Toggle -->
          <button
            class="tools-panel__toggle"
            @click="leftSidebarCollapsed = !leftSidebarCollapsed"
            :aria-expanded="!leftSidebarCollapsed"
            aria-controls="tools-panel-content"
            :title="
              leftSidebarCollapsed ? 'Expand toolbar' : 'Collapse toolbar'
            "
          >
            <i
              class="fas"
              :class="
                leftSidebarCollapsed ? 'fa-angles-right' : 'fa-angles-left'
              "
            ></i>
          </button>

          <!-- Panel Content -->
          <div id="tools-panel-content" class="tools-panel__content">
            <!-- Transform Tools Section -->
            <section
              class="tools-section"
              v-show="selectMode"
              aria-labelledby="transform-heading"
            >
              <h3 id="transform-heading" class="tools-section__heading">
                <i class="fas fa-wand-magic-sparkles"></i>
                <span>Transform</span>
              </h3>
              <div class="tools-section__grid">
                <button
                  class="tool-btn"
                  :class="{ 'tool-btn--disabled': !hasSelection }"
                  :disabled="!hasSelection"
                  @click="$emit('batch-flip', 'horizontal')"
                  title="Flip Horizontally (H)"
                >
                  <i class="fas fa-arrows-left-right"></i>
                  <span class="tool-btn__label">Flip H</span>
                </button>
                <button
                  class="tool-btn"
                  :class="{ 'tool-btn--disabled': !hasSelection }"
                  :disabled="!hasSelection"
                  @click="$emit('batch-flip', 'vertical')"
                  title="Flip Vertically (V)"
                >
                  <i class="fas fa-arrows-up-down"></i>
                  <span class="tool-btn__label">Flip V</span>
                </button>
                <button
                  class="tool-btn tool-btn--primary"
                  :class="{ 'tool-btn--disabled': !hasSelection }"
                  :disabled="!hasSelection"
                  @click="$emit('batch-crop')"
                  title="Crop Selection (C)"
                >
                  <i class="fas fa-crop-simple"></i>
                  <span class="tool-btn__label">Crop</span>
                </button>
                <button
                  class="tool-btn"
                  :class="{ 'tool-btn--disabled': !hasSelection }"
                  :disabled="!hasSelection"
                  @click="$emit('batch-revert')"
                  title="Revert to Original (R)"
                >
                  <i class="fas fa-rotate-left"></i>
                  <span class="tool-btn__label">Revert</span>
                </button>
              </div>
            </section>

            <!-- Divider -->
            <div class="tools-divider" v-show="selectMode"></div>

            <!-- Actions Section -->
            <section
              class="tools-section"
              v-show="selectMode"
              aria-labelledby="actions-heading"
            >
              <h3 id="actions-heading" class="tools-section__heading">
                <i class="fas fa-bolt"></i>
                <span>Actions</span>
              </h3>
              <div class="tools-section__stack">
                <button
                  class="tool-btn tool-btn--success tool-btn--wide"
                  :class="{ 'tool-btn--disabled': !hasSelection }"
                  :disabled="!hasSelection"
                  @click="$emit('batch-download')"
                  title="Download Selected (D)"
                >
                  <i class="fas fa-download"></i>
                  <span class="tool-btn__label">Download</span>
                </button>
                <button
                  class="tool-btn tool-btn--danger tool-btn--wide"
                  :class="{ 'tool-btn--disabled': !hasSelection }"
                  :disabled="!hasSelection"
                  @click="$emit('batch-delete')"
                  title="Delete Selected (Del)"
                >
                  <i class="fas fa-trash-can"></i>
                  <span class="tool-btn__label">Delete</span>
                </button>
              </div>
            </section>

            <!-- Clipboard Section -->
            <template v-if="hasCopiedSettings">
              <div class="tools-divider"></div>
              <section
                class="tools-section"
                aria-labelledby="clipboard-heading"
              >
                <h3 id="clipboard-heading" class="tools-section__heading">
                  <i class="fas fa-clipboard"></i>
                  <span>Clipboard</span>
                </h3>
                <div class="tools-section__stack">
                  <button
                    class="tool-btn tool-btn--accent tool-btn--wide"
                    @click="$emit('paste-settings')"
                    title="Paste Settings (Ctrl+V)"
                  >
                    <i class="fas fa-paste"></i>
                    <span class="tool-btn__label">Paste Settings</span>
                  </button>
                  <button
                    class="tool-btn tool-btn--ghost tool-btn--wide"
                    @click="$emit('clear-clipboard')"
                    title="Clear Clipboard"
                  >
                    <i class="fas fa-xmark"></i>
                    <span class="tool-btn__label">Clear</span>
                  </button>
                </div>
              </section>
            </template>

            <!-- Empty State when not in select mode -->
            <div
              class="tools-empty-state"
              v-show="!selectMode && !hasCopiedSettings"
            >
              <i class="fas fa-hand-pointer"></i>
              <p>Enter select mode to access batch tools</p>
            </div>
          </div>
        </aside>
        <div class="grid" :style="{ gridTemplateColumns: currentGridTemplate, '--item-size': itemMinWidth + 'px' }" ref="gridRef">
          <div 
            v-if="spacerBeforeHeight > 0" 
            class="virtual-spacer" 
            :style="{ height: spacerBeforeHeight + 'px', gridColumn: '1 / -1' }"
          ></div>

          <div
            v-for="(photo, index) in displayPhotos"
            :key="`${visibleRange.start + index}-${photo.current.name}`"
            class="photo-card-wrapper"
            :style="{
               width: '100%',
               height: '100%',
               '--item-size': itemMinWidth + 'px'
            }"
          >
          <div
            :ref="(el) => setPhotoCardRef(el as HTMLElement, visibleRange.start + index)"
            class="photo-card"
            :data-photo-index="visibleRange.start + index"
            :class="{
              selected: isSelected(visibleRange.start + index),
              'select-mode': selectMode,
              'dragging-over': draggedOverIndices.has(visibleRange.start + index),
            }"
            @click="handlePhotoCardClick(visibleRange.start + index, $event)"
            @mousedown="handlePhotoCardMouseDown(visibleRange.start + index, $event)"
            @mouseup="handlePhotoCardMouseUp"
            @mouseleave="handlePhotoCardMouseUp"
            @touchstart="handlePhotoCardTouchStart(visibleRange.start + index, $event)"
          >
            <input
              type="checkbox"
              class="photo-checkbox"
              :checked="isSelected(visibleRange.start + index)"
              @change="handleToggleSelect(visibleRange.start + index, $event)"
              @click.stop
            />
            <div class="image-container">
              <img
                v-if="photoUrl(photo.current, visibleRange.start + index)"
                :src="photoUrl(photo.current, visibleRange.start + index)!"
                alt="Uploaded photo"
                @error="handleImageError(visibleRange.start + index)"
                draggable="false"
                @dragstart.prevent
              />
              <div v-else class="image-placeholder"></div>
            </div>
            <div class="actions">
              <button
                class="Flip H"
                @click="$emit('flip', visibleRange.start + index, 'horizontal')"
                title="Flip Horizontally"
              >
                <i class="fas fa-arrows-left-right"></i>
              </button>
              <button
                class="Flip V"
                @click="$emit('flip', visibleRange.start + index, 'vertical')"
                title="Flip Vertically"
              >
                <i class="fas fa-arrows-up-down"></i>
              </button>
              <button class="Crop" @click="$emit('crop', visibleRange.start + index)" title="Crop">
                <i class="fas fa-crop"></i>
              </button>
              <button
                class="CopySettings"
                @click="$emit('copy-settings', visibleRange.start + index)"
                title="Copy Settings"
              >
                <i class="fas fa-copy"></i>
              </button>
              <button
                class="PasteSettings"
                :disabled="!hasCopiedSettings"
                @click="$emit('paste-settings', visibleRange.start + index)"
                title="Paste Settings"
              >
                <i class="fas fa-paste"></i>
              </button>
              <button
                class="Revert"
                @click="$emit('revert', visibleRange.start + index)"
                title="Revert"
              >
                <i class="fas fa-undo"></i>
              </button>
            </div>
            <div class="actions-bottom">
              <button
                class="Download"
                @click="$emit('download', visibleRange.start + index)"
                title="Download"
              >
                <i class="fas fa-download"></i>
              </button>
              <button
                class="Delete"
                @click="$emit('delete', visibleRange.start + index)"
                title="Delete"
              >
                <i class="fas fa-trash"></i>
              </button>
            </div>
            </div>
          </div>

          <div 
            v-if="spacerAfterHeight > 0"
            class="virtual-spacer" 
            :style="{ height: spacerAfterHeight + 'px', gridColumn: '1 / -1' }"
          ></div>
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
import { useVirtualScroll } from "../composables/useVirtualScroll";
import { VIRTUAL_SCROLL_PHOTO_THRESHOLD } from "../constants/optimization";
import { useMediaQuery } from "@vueuse/core";

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
const elementRefs = ref<Map<number, Ref<HTMLElement | null | undefined>>>(
  new Map(),
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

    // When virtual scroll is disabled, mark all indices visible so images display immediately
    if (newPhotos.length > 0 && newPhotos.length < VIRTUAL_SCROLL_PHOTO_THRESHOLD) {
      const allIndices = new Set<number>();
      for (let i = 0; i < newPhotos.length; i++) allIndices.add(i);
      visibleIndices.value = allIndices;
    }

    // Clean up observers and visibility tracking for removed photos
    if (oldPhotos) {
      const oldIndices = new Set(oldPhotos.map((_, i) => i));
      const newIndicesSet = new Set(newPhotos.map((_, i) => i));
      for (const index of oldIndices) {
        if (!newIndicesSet.has(index)) {
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
  { deep: true },
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
      `${movement}px`,
    );
    // Add left margin when collapsed (e.g., 12px spacing from collapsed container)
    document.documentElement.style.setProperty(
      "--photo-counter-collapsed-margin",
      "12px",
    );
  } else {
    document.documentElement.style.setProperty(
      "--tools-container-movement",
      "0px",
    );
    document.documentElement.style.setProperty(
      "--photo-counter-collapsed-margin",
      "0px",
    );
  }
};

watch(leftSidebarCollapsed, updateToolsContainerMovement, { immediate: true });

// Also update on window resize to recalculate movement
if (typeof window !== "undefined") {
  window.addEventListener("resize", updateToolsContainerMovement, { passive: true });
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
    document.addEventListener("touchend", handleDragEnd, { passive: true });
    document.addEventListener("touchcancel", handleDragEnd, { passive: true });
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
        (idx) => props.selectedIndices.includes(idx),
      );
      const dragCount = Math.max(
        0,
        props.selectedIndices.length - willBeDeselected.length,
      );
      emit("drag-selection-progress", dragCount);
    } else {
      // When selecting: show current selected plus what's being selected (avoid double counting)
      const willBeSelected = Array.from(draggedOverIndices.value).filter(
        (idx) => !props.selectedIndices.includes(idx),
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
    (a, b) => a - b,
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
    target.closest(".tools-panel") ||
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
        { immediate: true },
      );
    } else if (!shouldEnable && pinchZoomInstance) {
      // Cleanup when conditions no longer met
      if (pinchZoomInstance.cleanup) {
        pinchZoomInstance.cleanup();
      }
      pinchZoomInstance = null;
    }
  },
  { immediate: true },
);

const gridRef = ref<HTMLElement>();
const isSmallScreen = useMediaQuery('(max-width: 480px)');
const isMediumScreen = useMediaQuery('(max-width: 768px)');

const gap = computed(() => {
  if (isSmallScreen.value) return 12;
  if (isMediumScreen.value) return 16;
  return 24;
});

const itemMinWidth = computed(() => {
  if (isSmallScreen.value) {
    const containerWidth = typeof window !== 'undefined' ? window.innerWidth - 16 : 300;
    if (selectedPhotoSize.value === 4) {
      return containerWidth - 12;
    }
    const mobileSizeMap: Record<number, number> = {
      0: Math.floor(containerWidth * 0.45),
      1: Math.floor(containerWidth * 0.48),
      2: Math.floor(containerWidth * 0.5),
      3: Math.floor(containerWidth * 0.75),
    };
    const mobileSize = mobileSizeMap[selectedPhotoSize.value] || 140;
    return Math.max(140, Math.min(mobileSize, containerWidth - 12));
  }
  
  if (selectedPhotoSize.value === 4) {
    if (typeof window !== 'undefined') {
      return (window.innerWidth * 0.774) - 64;
    }
    return 800;
  }
  
  return photoSizes[selectedPhotoSize.value].minSize;
});

const virtualScrollEnabled = computed(() => props.photos.length >= VIRTUAL_SCROLL_PHOTO_THRESHOLD);

const { visibleRange, spacerBeforeHeight, spacerAfterHeight } = useVirtualScroll({
  totalItems: computed(() => props.photos.length),
  itemMinWidth,
  gap,
  containerRef: gridRef,
  enabled: virtualScrollEnabled
});

const displayPhotos = computed(() => {
  if (virtualScrollEnabled.value) {
    return props.photos.slice(visibleRange.value.start, visibleRange.value.end);
  }
  return props.photos;
});

watch(
  () => [virtualScrollEnabled.value, visibleRange.value, props.photos.length] as const,
  ([enabled, range, total]) => {
    const newIndices = new Set<number>();
    if (enabled) {
      // In virtual scroll, only the visible range is considered in view
      const start = (range as { start: number }).start;
      const end = (range as { end: number }).end;
      for (let i = start; i < end; i++) {
        newIndices.add(i);
      }
    } else {
      // When virtual scroll is disabled, all items are in the DOM — treat all as visible so images display
      for (let i = 0; i < total; i++) {
        newIndices.add(i);
      }
    }
    visibleIndices.value = newIndices;
  },
  { immediate: true }
);

// Setup intersection observers when photo cards are added (only when virtual scroll is disabled)
watch(
  () => photoCardRefs.value.size,
  () => {
    nextTick(() => {
      // If virtual scroll is enabled, visibility is managed by the range watcher above
      if (virtualScrollEnabled.value) return;

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
            { immediate: true },
          );
        }
      }
    });
  },
  { flush: "post" },
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

/* ============================================
   Tools Panel - Professional Sidebar Toolbar
   Inspired by Photoshop, Lightroom, Figma
   ============================================ */

.tools-panel {
  --panel-width: 180px;
  --panel-bg: rgba(24, 24, 32, 0.98);
  --panel-border: rgba(255, 255, 255, 0.08);
  --panel-shadow:
    0 4px 24px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.1);
  --toggle-size: 28px;
  --section-gap: 12px;
  --btn-radius: 8px;
  --transition-panel: 280ms cubic-bezier(0.4, 0, 0.2, 1);

  position: sticky;
  top: 20px;
  width: var(--panel-width);
  min-width: var(--panel-width);
  height: fit-content;
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-radius: 0 14px 14px 0;
  border: 1px solid var(--panel-border);
  border-left: none;
  box-shadow: var(--panel-shadow);
  overflow: visible;
  z-index: 100;
  transition:
    width var(--transition-panel),
    min-width var(--transition-panel),
    opacity var(--transition-panel),
    transform var(--transition-panel);
  align-self: flex-start;
  margin-right: 16px;
}

/* Collapsed State */
.tools-panel--collapsed {
  width: 0 !important;
  min-width: 0 !important;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  margin-right: 0;
}

.tools-panel--collapsed .tools-panel__content {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
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
  padding-right: env(safe-area-inset-right, 0px);
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

/* Toggle Button - Elegant Edge Tab */
.tools-panel__toggle {
  position: absolute;
  left: calc(-1 * var(--toggle-size));
  top: 50%;
  transform: translateY(-50%);
  width: var(--toggle-size);
  height: 72px;
  background: linear-gradient(
    135deg,
    rgba(40, 40, 52, 0.98) 0%,
    rgba(30, 30, 40, 0.98) 100%
  );
  border: 1px solid var(--panel-border);
  border-right: none;
  border-radius: 10px 0 0 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  transition: all 200ms ease;
  z-index: 101;
  box-shadow: -2px 0 12px rgba(0, 0, 0, 0.3);
}

.tools-panel__toggle:hover {
  background: linear-gradient(
    135deg,
    rgba(55, 55, 70, 0.98) 0%,
    rgba(45, 45, 58, 0.98) 100%
  );
  color: rgba(255, 255, 255, 0.95);
  width: 32px;
  left: -32px;
}

.tools-panel__toggle:active {
  background: linear-gradient(
    135deg,
    rgba(35, 35, 48, 0.98) 0%,
    rgba(28, 28, 38, 0.98) 100%
  );
  transform: translateY(-50%) scale(0.98);
}

.tools-panel__toggle:focus-visible {
  outline: 2px solid rgba(212, 175, 55, 0.6);
  outline-offset: 2px;
}

.tools-panel__toggle i {
  transition: transform 200ms ease;
}

.tools-panel--collapsed .tools-panel__toggle {
  border-radius: 0 10px 10px 0;
  left: 0;
  border-left: none;
  border-right: 1px solid var(--panel-border);
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.3);
}

.tools-panel--collapsed .tools-panel__toggle:hover {
  left: 0;
}

.photoGrid-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  width: calc(100% - 22.6%); /* 100% - 11.3% (left) - 11.3% (right) = 77.4% */
  max-width: 1238px; /* 77.4% of original 1600px max-width to maintain proportions */
  margin-left: 11.3%; /* Account for fixed left sidebar */
  margin-right: auto;
  padding: env(safe-area-inset-top, 0px) calc(20px + env(safe-area-inset-right, 0px)) 0 calc(20px + env(safe-area-inset-left, 0px));
  /* No transition on margin/width - should remain constant regardless of tools-container collapse */
}

/* Tablet Responsive */
@media (max-width: 768px) {
  .tools-panel {
    --panel-width: 160px;
    --toggle-size: 26px;
    max-height: calc(100vh - 32px);
    top: 16px;
  }

  .tools-panel__toggle {
    height: 60px;
  }

  .tools-panel__content {
    padding: 12px 10px;
    gap: 10px;
  }

  .tool-btn {
    padding: 10px 6px;
    min-height: 50px;
  }

  .tool-btn i {
    font-size: 14px;
  }

  .tool-btn__label {
    font-size: 9px;
  }

  .tool-btn--wide {
    padding: 10px 12px;
    min-height: 40px;
  }

  .tools-section__heading {
    font-size: 10px;
  }

  .size-controls-container {
    height: 85vh;
  }

  .photoGrid-container {
    width: calc(100% - 22.6%);
    margin-left: 11.3%;
    padding: env(safe-area-inset-top, 0px) calc(12px + env(safe-area-inset-right, 0px)) 0 calc(12px + env(safe-area-inset-left, 0px));
  }
}

/* Mobile Responsive */
@media (max-width: 480px) {
  .tools-panel {
    --panel-width: 140px;
    --toggle-size: 24px;
    max-height: calc(100vh - 24px);
    top: 12px;
    border-radius: 0 10px 10px 0;
  }

  .tools-panel__toggle {
    height: 52px;
    border-radius: 8px 0 0 8px;
  }

  .tools-panel--collapsed .tools-panel__toggle {
    border-radius: 0 8px 8px 0;
  }

  .tools-panel__content {
    padding: 10px 8px;
    gap: 8px;
  }

  .tools-section__grid {
    gap: 6px;
  }

  .tools-section__stack {
    gap: 6px;
  }

  .tool-btn {
    padding: 8px 4px;
    min-height: 46px;
    border-radius: 6px;
  }

  .tool-btn i {
    font-size: 13px;
  }

  .tool-btn__label {
    font-size: 8px;
  }

  .tool-btn--wide {
    padding: 8px 10px;
    min-height: 36px;
    gap: 8px;
  }

  .tool-btn--wide .tool-btn__label {
    font-size: 11px;
  }

  .tools-section__heading {
    font-size: 9px;
    gap: 6px;
  }

  .tools-section__heading i {
    font-size: 9px;
  }

  .tools-empty-state {
    padding: 16px 8px;
  }

  .tools-empty-state i {
    font-size: 20px;
  }

  .tools-empty-state p {
    font-size: 10px;
  }

  .size-controls-container {
    height: 80vh;
  }

  .photoGrid-container {
    width: calc(100% - 22.6%);
    margin-left: 11.3%;
    padding: env(safe-area-inset-top, 0px) calc(8px + env(safe-area-inset-right, 0px)) 0 calc(8px + env(safe-area-inset-left, 0px));
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

/* Panel Content Container */
.tools-panel__content {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
  padding: 14px 12px;
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  opacity: 1;
  visibility: visible;
  transition:
    opacity 200ms ease,
    visibility 200ms ease;

  /* Custom Scrollbar */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}

.tools-panel__content::-webkit-scrollbar {
  width: 5px;
}

.tools-panel__content::-webkit-scrollbar-track {
  background: transparent;
  margin: 8px 0;
}

.tools-panel__content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 4px;
}

.tools-panel__content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* Section Divider */
.tools-divider {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.1),
    transparent
  );
  margin: 4px 0;
}

/* Tools Section */
.tools-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tools-section__heading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: rgba(255, 255, 255, 0.5);
  padding: 0 4px;
  margin: 0;
}

.tools-section__heading i {
  font-size: 10px;
  opacity: 0.7;
}

/* Grid Layout for Tool Buttons (2x2) */
.tools-section__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

/* Stack Layout for Full-Width Buttons */
.tools-section__stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ============================================
   Tool Buttons - Modern Icon Buttons
   ============================================ */

.tool-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 12px 8px;
  min-height: 56px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--btn-radius);
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  transition: all 180ms ease;
  position: relative;
  overflow: hidden;
}

.tool-btn::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.05) 0%,
    transparent 50%
  );
  opacity: 0;
  transition: opacity 180ms ease;
}

.tool-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
  transform: translateY(-1px);
}

.tool-btn:hover:not(:disabled)::before {
  opacity: 1;
}

.tool-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
  background: rgba(255, 255, 255, 0.08);
}

.tool-btn:focus-visible {
  outline: 2px solid rgba(212, 175, 55, 0.5);
  outline-offset: 2px;
}

.tool-btn i {
  font-size: 16px;
  transition: transform 180ms ease;
}

.tool-btn:hover:not(:disabled) i {
  transform: scale(1.1);
}

.tool-btn__label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.3px;
  opacity: 0.85;
  text-align: center;
  line-height: 1.2;
}

/* Wide Button Variant */
.tool-btn--wide {
  flex-direction: row;
  justify-content: flex-start;
  gap: 10px;
  padding: 12px 14px;
  min-height: 44px;
}

.tool-btn--wide i {
  font-size: 14px;
}

.tool-btn--wide .tool-btn__label {
  font-size: 12px;
  opacity: 1;
}

/* Button Variants */
.tool-btn--primary {
  background: linear-gradient(
    135deg,
    rgba(212, 175, 55, 0.15) 0%,
    rgba(212, 175, 55, 0.08) 100%
  );
  border-color: rgba(212, 175, 55, 0.25);
  color: #ffd700;
}

.tool-btn--primary:hover:not(:disabled) {
  background: linear-gradient(
    135deg,
    rgba(212, 175, 55, 0.25) 0%,
    rgba(212, 175, 55, 0.12) 100%
  );
  border-color: rgba(212, 175, 55, 0.4);
  box-shadow: 0 0 20px rgba(212, 175, 55, 0.15);
}

.tool-btn--success {
  background: linear-gradient(
    135deg,
    rgba(34, 197, 94, 0.12) 0%,
    rgba(34, 197, 94, 0.06) 100%
  );
  border-color: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.tool-btn--success:hover:not(:disabled) {
  background: linear-gradient(
    135deg,
    rgba(34, 197, 94, 0.2) 0%,
    rgba(34, 197, 94, 0.1) 100%
  );
  border-color: rgba(34, 197, 94, 0.35);
  box-shadow: 0 0 20px rgba(34, 197, 94, 0.12);
}

.tool-btn--danger {
  background: linear-gradient(
    135deg,
    rgba(239, 68, 68, 0.12) 0%,
    rgba(239, 68, 68, 0.06) 100%
  );
  border-color: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.tool-btn--danger:hover:not(:disabled) {
  background: linear-gradient(
    135deg,
    rgba(239, 68, 68, 0.2) 0%,
    rgba(239, 68, 68, 0.1) 100%
  );
  border-color: rgba(239, 68, 68, 0.35);
  box-shadow: 0 0 20px rgba(239, 68, 68, 0.12);
}

.tool-btn--accent {
  background: linear-gradient(
    135deg,
    rgba(99, 102, 241, 0.15) 0%,
    rgba(99, 102, 241, 0.08) 100%
  );
  border-color: rgba(99, 102, 241, 0.25);
  color: #a5b4fc;
}

.tool-btn--accent:hover:not(:disabled) {
  background: linear-gradient(
    135deg,
    rgba(99, 102, 241, 0.25) 0%,
    rgba(99, 102, 241, 0.12) 100%
  );
  border-color: rgba(99, 102, 241, 0.4);
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.15);
}

.tool-btn--ghost {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
}

.tool-btn--ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.9);
}

/* Disabled State */
.tool-btn--disabled,
.tool-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none !important;
}

.tool-btn--disabled::before,
.tool-btn:disabled::before {
  display: none;
}

/* Empty State */
.tools-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px 12px;
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
}

.tools-empty-state i {
  font-size: 24px;
  opacity: 0.5;
}

.tools-empty-state p {
  font-size: 11px;
  line-height: 1.5;
  margin: 0;
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

/* Select Controls Above Grid */
.grid-wrapper .select-controls-above-grid {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: auto;
  margin-top: 0;
  margin-bottom: 16px;
  padding: 12px 16px;
  border-radius: var(--border-radius);
  background: var(--surface-color);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-lg);
  align-self: flex-start;
}

/* Grid Tools Wrapper - places tools-panel and grid side by side */
.grid-tools-wrapper {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 0;
  width: 100%;
  max-width: 100%;
  justify-content: flex-start;
}

/* Ensure grid takes remaining space when panel is shown */
.grid-tools-wrapper > .grid {
  flex: 1;
  min-width: 0; /* Allow grid to shrink */
}

.select-controls-above-grid label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  white-space: nowrap;
  font-weight: 500;
  cursor: pointer;
}

.select-controls-above-grid label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
}

.select-controls-above-grid button {
  padding: 10px 20px;
  min-height: 40px;
  font-size: 0.875rem;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .select-controls-above-grid {
    margin-top: 20px;
    margin-bottom: 12px;
    padding: 10px 12px;
    gap: 10px;
  }

  .select-controls-above-grid label {
    font-size: 0.8rem;
  }

  .select-controls-above-grid button {
    padding: 8px 16px;
    min-height: 36px;
    font-size: 0.8rem;
  }
}

@media (max-width: 480px) {
  .select-controls-above-grid {
    margin-top: 16px;
    margin-bottom: 10px;
    padding: 8px 10px;
    gap: 8px;
    flex-wrap: wrap;
  }

  .select-controls-above-grid label {
    font-size: 0.75rem;
  }

  .select-controls-above-grid button {
    padding: 6px 12px;
    min-height: 48px;
    font-size: 0.75rem;
  }
}

/* Photo Grid Wrapper */
.grid-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  margin: 24px auto 60px auto;
  /* No touch-action - allow all gestures, use preventDefault to block browser zoom */
}

/* Photo Grid */
.grid {
  display: grid;
  gap: 24px;
  width: 100%;
  max-width: 100%;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  transition: grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  touch-action: pan-y;
}

@media (max-width: 768px) {
  .grid-wrapper {
    margin-top: 0;
    margin-bottom: 40px;
  }

  .grid {
    gap: 16px;
  }
}

@media (max-width: 480px) {
  .grid-wrapper {
    margin-top: 0;
    margin-bottom: 30px;
  }

  .grid {
    gap: 12px;
  }
}

/* Photo Card Wrapper */
.photo-card-wrapper {
  content-visibility: auto;
  contain-intrinsic-size: var(--item-size) var(--item-size);
}

/* Photo Card Wrapper */
.photo-card-wrapper {
  content-visibility: auto;
  contain-intrinsic-size: var(--item-size) var(--item-size);
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
    box-shadow:
      0 0 8px rgba(255, 215, 0, 0.15),
      var(--shadow-md);
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
  box-shadow:
    0 0 0 3px rgba(255, 255, 255, 0.2),
    0 0 12px rgba(255, 255, 255, 0.3),
    var(--shadow-md);
}

/* Drag-to-select visual feedback */
.photo-card.dragging-over {
  border-color: #ffffff;
  background: rgba(255, 215, 0, 0.08);
  box-shadow:
    0 0 0 2px rgba(255, 215, 0, 0.3),
    0 0 8px rgba(255, 215, 0, 0.2),
    var(--shadow-md);
}

.photo-card.dragging-over.selected {
  border-color: #ffffff;
  box-shadow:
    0 0 0 3px rgba(255, 255, 255, 0.35),
    0 0 12px rgba(255, 255, 255, 0.3),
    var(--shadow-md);
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
  box-shadow:
    0 0 8px rgba(255, 215, 0, 0.4),
    0 0 0 2px rgba(255, 215, 0, 0.2);
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
  transition:
    opacity var(--transition-normal),
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
    min-height: 48px;
    min-width: 48px;
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
    min-height: 48px;
    min-width: 48px;
  }
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .photoGrid-container {
    width: 95%;
    padding: env(safe-area-inset-top, 0px) calc(12px + env(safe-area-inset-right, 0px)) 0 calc(12px + env(safe-area-inset-left, 0px));
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
    padding: env(safe-area-inset-top, 0px) calc(8px + env(safe-area-inset-right, 0px)) 0 calc(8px + env(safe-area-inset-left, 0px));
  }

  .photo-input {
    margin-top: 12px;
  }

  .photo-input input[type="file"] {
    font-size: 0.8rem;
    padding: 8px 12px;
  }

  .photo-checkbox {
    width: 48px;
    height: 48px;
    min-width: 48px;
    min-height: 48px;
    top: 4px;
    right: 4px;
  }
}
</style>
