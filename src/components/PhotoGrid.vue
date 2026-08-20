<template>
  <div class="photoGrid-container" ref="photoGridContainerRef" @dblclick="handleContainerDoubleClick">
    <div class="header">
      <div class="photo-input-wrapper" ref="photoInputWrapperRef">
        <label class="photo-input-label">
          <span class="photo-input-label__text">Choose Files</span>
          <input
            class="photo-input-native"
            type="file"
            multiple
            accept="image/*,.heic,.heif,.avif"
            @change="$emit('upload', $event)"
          />
        </label>
        <p class="photo-input-hint">Photos are deleted after 24 hours</p>
      </div>
    </div>
    <div class="grid-wrapper" ref="gridWrapperRef">
      <div class="grid-tools-wrapper" ref="gridToolsWrapperRef">
        <div
          v-show="photos.length > 0"
          ref="toolsSidebarColumnRef"
          class="tools-sidebar-column"
          :class="{ 'tools-sidebar-column--expanded': !leftSidebarCollapsed }"
        >
          <div
            ref="toolsSidebarStackRef"
            class="tools-sidebar-stack"
            :class="{ 'tools-sidebar-stack--in-flow': !toolsStackIsFixed }"
            :style="toolsStackFixedStyle"
          >
            <div class="tools-sidebar-stack__group">
              <div
                ref="toolsSidebarControlsRef"
                class="tools-sidebar-stack__controls"
              >
                <div
                  class="tools-sidebar-stack__file"
                  :class="{
                    'is-active': floatingFileInputVisible,
                    'fade-out': floatingFileInputFading,
                  }"
                >
                  <label class="photo-input-label photo-input-label--floating">
                    <span class="photo-input-label__text">Choose Files</span>
                    <input
                      class="photo-input-native"
                      type="file"
                      multiple
                      accept="image/*,.heic,.heif,.avif"
                      aria-label="Choose files"
                      @change="handleFloatingUpload"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  class="tools-panel__toggle"
                  :class="{ 'tools-panel__toggle--expanded': !leftSidebarCollapsed }"
                  @click="leftSidebarCollapsed ? expandToolkit() : collapseToolkit()"
                  :aria-expanded="!leftSidebarCollapsed"
                  aria-controls="tools-panel-content"
                  title="Batch Edit"
                >
                  <i class="fas fa-wrench" aria-hidden="true"></i>
                  <span class="tools-panel__toggle-label">Batch Edit</span>
                </button>
              </div>

              <aside
                v-show="!leftSidebarCollapsed"
                class="tools-panel"
                role="toolbar"
                aria-label="Batch editing tools"
              >
            <!-- Panel Content -->
            <div id="tools-panel-content" class="tools-panel__content">
              <div class="tools-panel__header">
                <button
                  v-show="!leftSidebarCollapsed"
                  type="button"
                  class="tools-panel__close"
                  @click="collapseToolkit"
                  aria-label="Collapse toolbar"
                  title="Collapse toolbar"
                >
                  <i class="fas fa-xmark"></i>
                </button>

                <div class="tools-panel__total-count">
                  <PrimaryPhotoCounter
                    embedded
                    header
                    :photo-count="photos.length"
                  />
                </div>

                <div
                  class="tools-panel__activity-row"
                  :class="{ 'is-dual': addedActivityVisible && deletedActivityVisible }"
                >
                  <div
                    class="tools-panel__activity-slot"
                    :class="{ 'is-visible': addedActivityVisible }"
                  >
                    <PhotoCounter
                      embedded
                      header
                      :photo-count="photos.length"
                      :new-photos-count="newPhotosCount"
                      @visibility-change="addedActivityVisible = $event"
                    />
                  </div>
                  <div
                    class="tools-panel__activity-slot"
                    :class="{ 'is-visible': deletedActivityVisible }"
                  >
                    <DeletedCounter
                      embedded
                      header
                      :deleted-photos-count="deletedPhotosCount"
                      @visibility-change="deletedActivityVisible = $event"
                    />
                  </div>
                </div>
              </div>

              <!-- Select Mode Controls -->
              <section
                class="tools-section tools-section--select"
                aria-labelledby="select-heading"
              >
                <h3 id="select-heading" class="tools-section__heading">
                  <i class="fas fa-mouse-pointer"></i>
                  <span>Selection</span>
                </h3>
                <div class="tools-panel__select-controls">
                  <label class="tools-panel__select-all">
                    <input
                      type="checkbox"
                      :checked="allSelected"
                      @change="handleToggleSelectAll($event)"
                    />
                    <span>{{ hasSelection ? "Deselect All" : "Select All" }}</span>
                  </label>
                  <SelectCounter
                    embedded
                    inline
                    :selected-count="displayedSelectedCount"
                    :total-photos="photos.length"
                  />
                </div>
              </section>

              <div class="tools-divider" v-show="selectMode"></div>

            <!-- History -->
            <section
              class="tools-section"
              v-show="selectMode"
              aria-labelledby="history-heading"
            >
              <h3 id="history-heading" class="tools-section__heading">
                <i class="fas fa-clock-rotate-left"></i>
                <span>History</span>
              </h3>
              <button
                type="button"
                class="tool-btn tool-btn--wide"
                :class="{ 'tool-btn--active': historyOpen }"
                aria-controls="history-panel"
                :aria-expanded="historyOpen"
                title="Operation history"
                @click="toggleHistory"
              >
                <i class="fas fa-clock-rotate-left"></i>
                <span class="tool-btn__label">
                  {{ historyOpen ? "Hide History" : "Show History" }}
                </span>
              </button>
            </section>

            <div class="tools-divider" v-show="selectMode"></div>

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
                <label
                  class="tools-export-toggle"
                  title="Remove GPS, device info, and timestamps from unedited JPEG/WebP downloads. Edited photos are already clean."
                >
                  <span class="tools-export-toggle__label">Strip metadata on export</span>
                  <input
                    type="checkbox"
                    role="switch"
                    class="tools-export-toggle__input"
                    :checked="stripExifOnExport"
                    :aria-checked="stripExifOnExport"
                    @change="stripExifOnExport = ($event.target as HTMLInputElement).checked"
                  />
                </label>
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

          </div>
              </aside>
            </div>
          </div>
        </div>

        <div class="grid" :style="{ gridTemplateColumns: currentGridTemplate, '--item-size': gridCellSizePx + 'px', columnGap: gap + 'px', rowGap: rowGap + 'px' }" ref="gridRef">
          <div 
            v-if="spacerBeforeHeight > 0" 
            class="virtual-spacer" 
            :style="{ height: spacerBeforeHeight + 'px', gridColumn: '1 / -1' }"
          ></div>

          <PhotoCard
            v-for="(photo, index) in displayPhotos"
            v-memo="[
              visibleRange.start + index,
              getDisplayUrl(visibleRange.start + index),
              isLoading(visibleRange.start + index),
              isSelected(visibleRange.start + index),
              selectMode,
              draggedOverIndices.has(visibleRange.start + index),
              hasCopiedSettings,
              photo.thumbRevision,
              photo.thumbhash,
              photo.flips.horizontal,
              photo.flips.vertical,
              photo.crop,
              photo.rotation,
              entranceIndices.has(visibleRange.start + index),
              allowGridAnimation,
            ]"
            :key="`${visibleRange.start + index}-${photo.id ?? photo.current.name}`"
            :photo="photo"
            :real-index="visibleRange.start + index"
            :display-url="getDisplayUrl(visibleRange.start + index)"
            :is-loading="isLoading(visibleRange.start + index)"
            :placeholder-preview-url="getPlaceholderPreviewUrl(photo)"
            :selected="isSelected(visibleRange.start + index)"
            :select-mode="selectMode"
            :has-copied-settings="hasCopiedSettings"
            :dragging-over="draggedOverIndices.has(visibleRange.start + index)"
            :show-entrance-animation="entranceIndices.has(visibleRange.start + index)"
            :entrance-delay-ms="getEntranceDelayMs(visibleRange.start + index)"
            :allow-transition="allowGridAnimation"
            :drag-selecting="isDragSelecting"
            :item-size="gridCellSizePx + 'px'"
            :register-card-ref="(el) => setPhotoCardRef(el, visibleRange.start + index)"
            @click="handlePhotoCardClick(visibleRange.start + index, $event)"
            @mousedown="handlePhotoCardMouseDown(visibleRange.start + index, $event)"
            @mouseup="handlePhotoCardMouseUp"
            @mouseleave="handlePhotoCardMouseUp"
            @touchstart="handlePhotoCardTouchStart(visibleRange.start + index, $event)"
            @toggle-select="(checked) => handleToggleSelectChecked(visibleRange.start + index, checked)"
            @flip="(dir) => $emit('flip', visibleRange.start + index, dir)"
            @crop="$emit('crop', visibleRange.start + index)"
            @download="$emit('download', visibleRange.start + index)"
            @revert="$emit('revert', visibleRange.start + index)"
            @delete="$emit('delete', visibleRange.start + index)"
            @copy-settings="$emit('copy-settings', visibleRange.start + index)"
            @paste-settings="$emit('paste-settings', visibleRange.start + index)"
            @image-error="handleImageError(visibleRange.start + index)"
          />

          <div 
            v-if="spacerAfterHeight > 0"
            class="virtual-spacer" 
            :style="{ height: spacerAfterHeight + 'px', gridColumn: '1 / -1' }"
          ></div>
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
  toRef,
  nextTick,
} from "vue";
import { useExportSettings } from "../composables/useExportSettings";
import { useOperationHistory } from "../composables/useOperationHistory";
import { useTouchCapability } from "../composables/useTouchCapability";
import { usePinchZoom } from "../composables/usePinchZoom";
import { useVirtualScroll } from "../composables/useVirtualScroll";
import { useVirtualScrollThreshold } from "../composables/useVirtualScrollThreshold";
import { useGridViewability } from "../composables/useGridViewability";
import { useGridImageDisplay } from "../composables/useGridImageDisplay";
import { useBatchedGridMount } from "../composables/useBatchedGridMount";
import { useGridEntranceAnimation } from "../composables/useGridEntranceAnimation";
import { useGridIdlePrefetch } from "../composables/useGridIdlePrefetch";
import { useMediaQuery, useThrottleFn } from "@vueuse/core";
import { thumbhashToDataUrl } from "../utils/thumbhashDecode";
import PhotoCard from "./PhotoCard.vue";
import PhotoCounter from "./PhotoCounter.vue";
import DeletedCounter from "./DeletedCounter.vue";
import PrimaryPhotoCounter from "./PrimaryPhotoCounter.vue";
import SelectCounter from "./SelectCounter.vue";
import type { Photo } from "../types/photo";
import { VIEWABILITY_THROTTLE_MS } from "../constants/optimization";
import { GridUrlCache } from "../utils/gridUrlCache";
import { createGridDecodeQueue } from "../utils/gridDecodeQueue";
import { recordGridMetrics } from "../utils/gridMetricsBridge";
import {
  syncGridUrlsForVisibility,
  revokePhotoCacheKey,
} from "../utils/gridUrlSync";

const props = withDefaults(
  defineProps<{
    photos: Photo[];
    selectedIndices: number[];
    hasSelection: boolean;
    allSelected: boolean;
    hasCopiedSettings: boolean;
    newPhotosCount?: number;
    deletedPhotosCount?: number;
    dragSelectionCount?: number | null;
    selectedPhotoSize?: number;
  }>(),
  {
    newPhotosCount: 0,
    deletedPhotosCount: 0,
    dragSelectionCount: null,
    selectedPhotoSize: 2,
  },
);

const displayedSelectedCount = computed(() =>
  props.dragSelectionCount !== null && props.dragSelectionCount !== undefined
    ? props.dragSelectionCount
    : props.selectedIndices.length,
);

const addedActivityVisible = ref(false);
const deletedActivityVisible = ref(false);

const { stripExifOnExport } = useExportSettings();
const { isOpen: historyOpen, toggleOpen: toggleHistory } = useOperationHistory();

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
  (e: "photo-thumbnail-updated", index: number, thumbnail: File, thumbhash?: string | null): void;
  (e: "update:selectedPhotoSize", value: number): void;
}>();

const isSmallScreen = useMediaQuery('(max-width: 480px)');
const { isVirtualScrollEnabled } = useVirtualScrollThreshold(isSmallScreen);

// GRID DISPLAY RULE: Tier 1 thumbnails via useGridImageDisplay only.
// Full-res (Tier 2) is reserved for CropModal / App handlers.
const photoCardRefs = ref<Map<number, HTMLElement>>(new Map());

// Set template ref for photo card
const setPhotoCardRef = (el: HTMLElement | null, index: number) => {
  if (el) {
    photoCardRefs.value.set(index, el);
  } else {
    photoCardRefs.value.delete(index);
  }
};

const handleImageError = (index: number) => {
  // Handle image load error - could add error state tracking here if needed
  console.warn(`Failed to load image at index ${index}`);
};

const getPlaceholderPreviewUrl = (photo: Photo): string | null => {
  if (!photo.thumbhash) return null;
  return thumbhashToDataUrl(photo.thumbhash);
};


const photoInputWrapperRef = ref<HTMLElement | null>(null);
const primaryFileInputVisible = ref(true);

const showFloatingFileInput = computed(
  () => props.photos.length > 0 && !primaryFileInputVisible.value,
);

const floatingFileInputVisible = ref(false);
const floatingFileInputFading = ref(false);
const FLOATING_FILE_FADE_MS = 500;
let floatingFileFadeTimer: ReturnType<typeof setTimeout> | null = null;

const TOOLS_STACK_FIXED_BREAKPOINT = 900;
const toolsSidebarColumnRef = ref<HTMLElement | null>(null);
const toolsSidebarStackRef = ref<HTMLElement | null>(null);
const photoGridContainerRef = ref<HTMLElement | null>(null);
const gridToolsWrapperRef = ref<HTMLElement | null>(null);
const toolsStackLeftPx = ref(0);
const toolsStackWidthPx = ref(0);
const toolsStackIsFixed = ref(true);
let toolsStackPositionObserver: ResizeObserver | null = null;

const isToolsStackFixedViewport = () =>
  typeof window !== "undefined" &&
  window.innerWidth > TOOLS_STACK_FIXED_BREAKPOINT;

const updateToolsStackPosition = () => {
  const columnEl = toolsSidebarColumnRef.value;
  const fixed = isToolsStackFixedViewport();
  toolsStackIsFixed.value = fixed;

  if (!columnEl || !fixed) {
    toolsStackLeftPx.value = 0;
    toolsStackWidthPx.value = 0;
    return;
  }

  const stackEl = toolsSidebarStackRef.value;
  const stackWidth = stackEl
    ? Math.max(Math.round(stackEl.getBoundingClientRect().width), 1)
    : 0;

  const containerLeft =
    photoGridContainerRef.value?.getBoundingClientRect().left ?? 0;

  const minLeft = 12;
  const centeredLeft = Math.max(
    minLeft,
    Math.round((containerLeft - stackWidth) / 2),
  );

  toolsStackLeftPx.value = centeredLeft;
  toolsStackWidthPx.value = stackWidth;
};

const throttledUpdateToolsStackPosition = useThrottleFn(
  updateToolsStackPosition,
  16,
);

const toolsStackFixedStyle = computed(() => {
  if (!toolsStackIsFixed.value) {
    return undefined;
  }
  return {
    left: `${toolsStackLeftPx.value}px`,
  };
});

let photoInputObserver: IntersectionObserver | null = null;

const observeToolsSidebarColumn = () => {
  const columnEl = toolsSidebarColumnRef.value;
  if (!columnEl) return;

  toolsStackPositionObserver?.disconnect();
  toolsStackPositionObserver = new ResizeObserver(() =>
    throttledUpdateToolsStackPosition(),
  );
  toolsStackPositionObserver.observe(columnEl);

  if (gridToolsWrapperRef.value) {
    toolsStackPositionObserver.observe(gridToolsWrapperRef.value);
  }

  const containerEl = photoGridContainerRef.value;
  if (containerEl) {
    toolsStackPositionObserver.observe(containerEl);
  }

  const stackEl = toolsSidebarStackRef.value;
  if (stackEl) {
    toolsStackPositionObserver.observe(stackEl);
  }
};

onMounted(() => {
  requestAnimationFrame(() => {
    observeToolsSidebarColumn();
    updateToolsStackPosition();

    if (photoInputWrapperRef.value) {
      photoInputObserver = new IntersectionObserver(
        ([entry]) => {
          primaryFileInputVisible.value = entry.isIntersecting;
        },
        { threshold: 0, rootMargin: "0px" },
      );
      photoInputObserver.observe(photoInputWrapperRef.value);
    }
  });

  window.addEventListener("scroll", throttledUpdateToolsStackPosition, {
    passive: true,
  });
  window.addEventListener("resize", throttledUpdateToolsStackPosition, {
    passive: true,
  });
});

watch(
  () => props.photos.length,
  async () => {
    await nextTick();
    observeToolsSidebarColumn();
    updateToolsStackPosition();
  },
);

watch(showFloatingFileInput, (shouldShow) => {
  if (shouldShow) {
    if (floatingFileFadeTimer) {
      clearTimeout(floatingFileFadeTimer);
      floatingFileFadeTimer = null;
    }
    floatingFileInputFading.value = false;
    floatingFileInputVisible.value = true;
    requestAnimationFrame(updateToolsStackPosition);
    return;
  }

  if (!floatingFileInputVisible.value) return;

  floatingFileInputFading.value = true;
  floatingFileFadeTimer = setTimeout(() => {
    floatingFileInputVisible.value = false;
    floatingFileInputFading.value = false;
    floatingFileFadeTimer = null;
  }, FLOATING_FILE_FADE_MS);
});

onUnmounted(() => {
  stopViewability();
  clearDisplayState();
  gridUrlCache.clear();

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

  photoInputObserver?.disconnect();
  photoInputObserver = null;
  toolsStackPositionObserver?.disconnect();
  toolsStackPositionObserver = null;
  window.removeEventListener("scroll", throttledUpdateToolsStackPosition);
  window.removeEventListener("resize", throttledUpdateToolsStackPosition);
  if (floatingFileFadeTimer) {
    clearTimeout(floatingFileFadeTimer);
    floatingFileFadeTimer = null;
  }
});

const isSelected = (index: number): boolean =>
  props.selectedIndices.includes(index);

const handleFloatingUpload = (event: Event) => {
  emit("upload", event);
};

const handleToggleSelectAll = (event: Event) => {
  const target = event.target as HTMLInputElement;
  emit("toggle-select-all", target.checked);
};

const handleToggleSelectChecked = (index: number, checked: boolean) => {
  emit("toggle-select", index, checked);
};

const selectMode = ref(false);
const holdTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const isHolding = ref(false);
const heldPhotoIndex = ref<number | null>(null);
const justActivatedSelectMode = ref(false);
const leftSidebarCollapsed = ref(true);

// Drag detection for activating select mode
const dragDetectionActive = ref(false);
const dragStartPosition = ref<{ x: number; y: number } | null>(null);
const dragDetectionThreshold = 10; // pixels of movement to detect drag

const syncSelectModeWithToolkit = (collapsed: boolean) => {
  if (collapsed) {
    if (selectMode.value) {
      emit("toggle-select-all", false);
    }
    selectMode.value = false;
  } else {
    selectMode.value = true;
  }
};

watch(leftSidebarCollapsed, syncSelectModeWithToolkit, { immediate: true });

watch(leftSidebarCollapsed, () => {
  requestAnimationFrame(updateToolsStackPosition);
  // Column width animates over 220ms when expanding/collapsing
  setTimeout(updateToolsStackPosition, 240);
});

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
    target.closest(".action-dropdown") ||
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

const expandToolkit = () => {
  leftSidebarCollapsed.value = false;
};

const collapseToolkit = () => {
  leftSidebarCollapsed.value = true;
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

  // Double-clicked outside photo cards and interactive elements - collapse toolkit
  collapseToolkit();
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
    target.closest(".action-dropdown") ||
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

      // Expand toolkit (enables select mode) via drag gesture
      if (leftSidebarCollapsed.value) {
        expandToolkit();
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

    // If we didn't expand via drag, continue with hold logic
    if (leftSidebarCollapsed.value && isHolding.value) {
      // Set timeout to expand toolkit after 500ms of holding
      holdTimeout.value = setTimeout(() => {
        if (isHolding.value && leftSidebarCollapsed.value) {
          expandToolkit();
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
    target.closest(".action-dropdown") ||
    target.closest(".photo-checkbox")
  ) {
    return;
  }

  isHolding.value = true;
  heldPhotoIndex.value = index;
  justActivatedSelectMode.value = false;

  // Set timeout to activate select mode after 500ms of holding
  holdTimeout.value = setTimeout(() => {
    if (isHolding.value && leftSidebarCollapsed.value) {
      expandToolkit();
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
  { label: "M", minSize: 260 }, // Default
  { label: "L", minSize: 310 },
  { label: "XL", minSize: 360 },
];

const selectedPhotoSize = computed({
  get: () => props.selectedPhotoSize,
  set: (value: number) => emit("update:selectedPhotoSize", value),
});
const allowGridAnimation = ref(true);

watch(selectedPhotoSize, () => {
  allowGridAnimation.value = false;
  requestAnimationFrame(() => {
    allowGridAnimation.value = true;
  });
});

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
const isMediumScreen = useMediaQuery('(max-width: 768px)');

const gap = computed(() => {
  if (isSmallScreen.value) return 12;
  if (isMediumScreen.value) return 16;
  return 24;
});

const rowGap = computed(() => {
  if (isSmallScreen.value) return 48;
  if (isMediumScreen.value) return 52;
  return 56;
});

const itemMinWidth = computed(() => {
  const presetSize = photoSizes[selectedPhotoSize.value].minSize;

  if (isSmallScreen.value) {
    const containerWidth = typeof window !== 'undefined' ? window.innerWidth - 16 : 300;
    const maxCell = containerWidth - 12;
    return Math.max(140, Math.min(presetSize, maxCell));
  }

  return presetSize;
});

const virtualScrollEnabled = computed(() =>
  isVirtualScrollEnabled(props.photos.length)
);

const { visibleRange, spacerBeforeHeight, spacerAfterHeight } = useVirtualScroll({
    totalItems: computed(() => props.photos.length),
    itemMinWidth,
    gap,
    rowGap,
    containerRef: gridRef,
    enabled: virtualScrollEnabled,
  });

const gridCellSizePx = computed(() => itemMinWidth.value);

const { mountedDisplayCount } = useBatchedGridMount(
  computed(() => props.photos.length),
  virtualScrollEnabled
);

const { entranceIndices, getEntranceDelayMs } = useGridEntranceAnimation(
  toRef(props, "photos")
);

const displayPhotos = computed(() => {
  if (virtualScrollEnabled.value) {
    return props.photos.slice(visibleRange.value.start, visibleRange.value.end);
  }
  return props.photos.slice(0, mountedDisplayCount.value);
});

const gridUrlCache = new GridUrlCache();
const decodeQueue = createGridDecodeQueue();
const previousVisibleIndices = ref<Set<number>>(new Set());

const { visibleIndices, stop: stopViewability } = useGridViewability({
  totalCount: computed(() => props.photos.length),
  virtualScrollEnabled,
  visibleRange,
  containerRef: gridRef,
  photoCardRefs,
});

const { getDisplayUrl, isLoading, cancelForPhoto, clearDisplayState } =
  useGridImageDisplay({
    photos: toRef(props, "photos"),
    visibleIndices,
    urlCache: gridUrlCache,
    decodeQueue,
    onThumbnailUpdated: (index, thumbnail, thumbhash) =>
      emit("photo-thumbnail-updated", index, thumbnail, thumbhash),
  });

useGridIdlePrefetch({
  photos: toRef(props, "photos"),
  visibleIndices,
  urlCache: gridUrlCache,
  totalCount: computed(() => props.photos.length),
});

const recordGridMetricsSnapshot = useThrottleFn(
  (indices: ReadonlySet<number>) => {
    recordGridMetrics({
      urlCache: gridUrlCache,
      decodeQueue,
      visibleIndices: indices,
    });
  },
  VIEWABILITY_THROTTLE_MS
);

watch(
  visibleIndices,
  (next) => {
    syncGridUrlsForVisibility(
      gridUrlCache,
      props.photos,
      next,
      previousVisibleIndices.value
    );
    previousVisibleIndices.value = new Set(next);
    recordGridMetricsSnapshot(next);
  },
  { flush: "post" }
);

watch(
  () => props.photos,
  (newPhotos, oldPhotos) => {
    if (!oldPhotos) return;
    const newIds = new Set(newPhotos.map((photo) => photo.id).filter(Boolean));
    for (const photo of oldPhotos) {
      if (photo.id && !newIds.has(photo.id)) {
        revokePhotoCacheKey(gridUrlCache, photo);
        cancelForPhoto(photo.id);
        decodeQueue.cancelForPhoto(photo.id);
      }
    }
  },
  { deep: true }
);

const currentGridTemplate = computed(() => {
  // Fixed pixel columns so each size preset renders at a distinct cell width
  return `repeat(auto-fill, ${itemMinWidth.value}px)`;
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
      !target.closest(".action-dropdown") &&
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

.tools-sidebar-column {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: visible;
}


.tools-sidebar-stack {
  position: fixed;
  top: calc(96px + env(safe-area-inset-top, 0px));
  left: 0;
  width: max-content;
  max-width: calc(100vw - 24px);
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 1101;
  pointer-events: none;
}

.tools-sidebar-stack__group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: max-content;
  pointer-events: auto;
}

.tools-sidebar-stack__controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: max-content;
  pointer-events: auto;
}

.tools-sidebar-stack--in-flow {
  position: relative;
  top: auto;
  left: auto;
  width: 100%;
  z-index: 2;
}

.tools-sidebar-stack > * {
  pointer-events: auto;
}

.tools-sidebar-stack__file {
  opacity: 0;
  visibility: hidden;
  max-height: 0;
  overflow: hidden;
  flex-shrink: 0;
  transition:
    opacity 0.5s ease-out,
    visibility 0.5s ease-out,
    max-height 0.35s ease-out;
  pointer-events: none;
}

.tools-sidebar-stack__file.is-active {
  opacity: 1;
  visibility: visible;
  max-height: 48px;
  overflow: visible;
  padding-bottom: 2px;
  pointer-events: auto;
  display: flex;
  justify-content: center;
  width: 100%;
}

.tools-sidebar-stack__file.fade-out {
  opacity: 0;
}

.tools-panel__toggle + .tools-panel {
  margin-top: 6px;
}

.tools-panel__toggle--expanded {
  opacity: 0.92;
}

.tools-panel {
  --panel-bg: rgba(18, 18, 26, 0.98);
  --panel-border: rgba(255, 255, 255, 0.08);
  --panel-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  --section-gap: 8px;
  --btn-radius: 6px;
  --transition-panel: 280ms cubic-bezier(0.4, 0, 0.2, 1);

  position: relative;
  top: auto;
  left: auto;
  width: max-content;
  min-width: 0;
  max-width: calc(100vw - 24px);
  height: fit-content;
  max-height: calc(
    100vh - 96px - env(safe-area-inset-top, 0px) - 48px - env(safe-area-inset-bottom, 0px)
  );
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 10px;
  border: 1px solid var(--panel-border);
  box-shadow: var(--panel-shadow);
  overflow: visible;
  z-index: 1100;
  transition:
    background var(--transition-panel),
    border-color var(--transition-panel),
    box-shadow var(--transition-panel);
  margin-right: 0;
  will-change: top;
}

.photo-input-label--floating {
  width: fit-content;
  max-width: 100%;
  font-size: 0.68rem;
  padding: 8px 14px;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  box-sizing: border-box;
  line-height: 1.3;
}

.photo-input-label--floating .photo-input-label__text {
  font-size: 0.7rem;
}

/* Collapsed expand bar — matches photo-input / size-controls containers */
.tools-panel__toggle {
  position: relative;
  top: auto;
  left: auto;
  transform: none;
  width: fit-content;
  min-height: 32px;
  padding: 5px 8px;
  border-radius: 10px;
  background: rgba(18, 18, 26, 0.98);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--panel-border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  transition:
    background 200ms ease,
    color 200ms ease,
    box-shadow 200ms ease,
    transform 200ms ease,
    border-color 200ms ease;
  z-index: 1101;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
}

.tools-panel__toggle-label {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.15px;
  white-space: nowrap;
}

.tools-panel__toggle:hover:not(:disabled) {
  background: linear-gradient(
    135deg,
    rgba(212, 175, 55, 0.22) 0%,
    rgba(212, 175, 55, 0.1) 100%
  );
  color: #ffd700;
  border-color: rgba(255, 255, 255, 0.08);
  transform: none;
  box-shadow:
    0 2px 8px rgba(212, 175, 55, 0.2),
    0 8px 32px rgba(0, 0, 0, 0.55);
}

.tools-panel__toggle:active:not(:disabled) {
  transform: scale(0.98);
}

.tools-panel__toggle:focus-visible {
  outline: 2px solid rgba(212, 175, 55, 0.6);
  outline-offset: 2px;
}

/* Collapse button — top left when expanded */
.tools-panel__close {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  padding: 0;
  min-height: unset;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--panel-border);
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  cursor: pointer;
  transition:
    background 200ms ease,
    color 200ms ease,
    border-color 200ms ease;
}

.tools-panel__close:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.95);
  border-color: rgba(255, 255, 255, 0.2);
  transform: none;
  box-shadow: none;
}

.tools-panel__close:active:not(:disabled) {
  transform: scale(0.96);
}

.tools-panel__close:focus-visible {
  outline: 2px solid rgba(212, 175, 55, 0.6);
  outline-offset: 2px;
}

.tools-panel__header {
  position: relative;
  flex-shrink: 0;
  padding-top: 20px;
  padding-bottom: 6px;
  margin-bottom: 2px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.tools-panel__total-count {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  display: flex;
  align-items: center;
  pointer-events: none;
}

.tools-panel__total-count :deep(.primary-photo-counter.embedded) {
  width: auto;
  height: auto;
}

.tools-panel__total-count :deep(.counter-label) {
  font-size: 0.52rem;
  letter-spacing: 0.35px;
}

.tools-panel__total-count :deep(.counter-value) {
  font-size: 0.65rem;
}

.tools-panel__activity-slot :deep(.counter-value) {
  font-size: 0.62rem;
}

.tools-panel__activity-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 0;
  min-height: 22px;
  width: 100%;
}

.tools-panel__activity-row.is-dual {
  gap: 8px;
}

.tools-panel__activity-slot {
  display: none;
  height: 22px;
  min-height: 22px;
  flex-shrink: 0;
  overflow: visible;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

.tools-panel__activity-slot.is-visible {
  display: flex;
}

.tools-panel__activity-slot :deep(.photo-counter.embedded),
.tools-panel__activity-slot :deep(.deleted-counter.embedded) {
  width: auto;
  height: auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tools-panel__activity-slot :deep(.counter-content) {
  height: auto;
  min-height: 0;
  align-items: center;
}

.tools-panel__activity-slot :deep(.counter-value) {
  line-height: 1.3;
  overflow: visible;
  text-overflow: unset;
}

.photoGrid-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  width: 100%;
  max-width: 1400px;
  margin-left: auto;
  margin-right: auto;
  padding: env(safe-area-inset-top, 0px) calc(20px + env(safe-area-inset-right, 0px)) 0 calc(20px + env(safe-area-inset-left, 0px));
}

/* Narrow screens: tools row above grid */
@media (max-width: 900px) {
  .grid-tools-wrapper {
    flex-direction: column;
    gap: 10px;
  }

  .tools-sidebar-column,
  .tools-sidebar-column--expanded {
    position: relative;
    width: 100%;
    height: auto;
    overflow: visible;
  }

  .tools-sidebar-stack,
  .tools-sidebar-stack--in-flow {
    position: relative;
    top: auto;
    left: auto;
    width: 100% !important;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
  }

  .tools-sidebar-stack__group {
    width: 100%;
    align-items: center;
  }

  .tools-sidebar-stack__controls {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
  }

  .tools-panel__toggle {
    width: auto;
    flex: 0 0 auto;
  }

  .tools-panel {
    flex: 1 1 11rem;
    max-width: 11rem;
  }

  .tools-sidebar-stack__file.is-active {
    flex: 1 1 100%;
  }
}

/* Tablet Responsive */
@media (max-width: 768px) {
  .photoGrid-container {
    padding: env(safe-area-inset-top, 0px) calc(12px + env(safe-area-inset-right, 0px)) 0 calc(12px + env(safe-area-inset-left, 0px));
  }
}

/* Mobile Responsive */
@media (max-width: 480px) {
  .tools-panel {
    border-radius: 12px;
  }

  .tools-sidebar-stack {
    gap: 8px;
  }

  .tools-sidebar-stack__file.is-active {
    max-height: 50px;
    padding-bottom: 2px;
  }

  .tools-panel__toggle {
    min-height: 32px;
    padding: 5px 10px;
    font-size: 11px;
  }

  .tools-panel__toggle-label {
    font-size: 0.68rem;
  }

  .photo-input-label--floating {
    padding: 6px 10px;
  }

  .photo-input-label--floating .photo-input-label__text {
    font-size: 0.68rem;
  }

  .tools-panel__close {
    top: 6px;
    left: 6px;
    width: 26px;
    height: 26px;
    font-size: 11px;
  }

  .tools-panel__header {
    padding-top: 22px;
  }

  .tools-panel__total-count {
    top: 6px;
    right: 6px;
  }

  .tools-panel__activity-row {
    min-height: 26px;
  }

  .tools-panel__activity-slot {
    height: 26px;
    min-height: 26px;
  }

  .tools-panel__activity-row.is-dual {
    gap: 12px;
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

  .photoGrid-container {
    padding: env(safe-area-inset-top, 0px) calc(8px + env(safe-area-inset-right, 0px)) 0 calc(8px + env(safe-area-inset-left, 0px));
  }
}

.photo-input-wrapper {
  margin-top: 16px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.photo-input-hint {
  margin: 0;
  max-width: 16rem;
  font-size: 0.7rem;
  font-weight: 400;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.45);
  font-style: italic;
  text-align: center;
}

.photo-input-label {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  padding: 10px 18px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(18, 18, 26, 0.98);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.photo-input-label:hover {
  background: linear-gradient(135deg, rgba(212, 175, 55, 0.22) 0%, rgba(212, 175, 55, 0.1) 100%);
  color: #ffd700;
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 2px 8px rgba(212, 175, 55, 0.2), 0 8px 32px rgba(0, 0, 0, 0.55);
}

.photo-input-native {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  font-size: 0;
}

/* Panel Content Container */
.tools-panel__content {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
  padding: 10px 8px;
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

.tools-panel .tools-panel__content {
  padding-top: 10px;
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
  gap: 6px;
}

.tools-section__heading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.5);
  padding: 0 4px;
  margin: 0;
}

.tools-section__heading i {
  font-size: 8px;
  opacity: 0.7;
}

/* Grid Layout for Tool Buttons (2x2) */
.tools-section__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 5px;
}

/* Stack Layout for Full-Width Buttons */
.tools-section__stack {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.tools-export-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--btn-radius);
  cursor: pointer;
  color: rgba(255, 255, 255, 0.85);
  font-size: 10px;
  line-height: 1.3;
}

.tools-export-toggle__label {
  flex: 1;
  text-align: left;
}

.tools-export-toggle__input {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  accent-color: #d4af37;
  cursor: pointer;
}

/* ============================================
   Tool Buttons - Modern Icon Buttons
   ============================================ */

.tool-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 7px 4px;
  min-height: 42px;
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
  font-size: 13px;
  transition: transform 180ms ease;
}

.tool-btn:hover:not(:disabled) i {
  transform: scale(1.1);
}

.tool-btn__label {
  font-size: 8px;
  font-weight: 500;
  letter-spacing: 0.2px;
  opacity: 0.85;
  text-align: center;
  line-height: 1.2;
}

/* Wide Button Variant */
.tool-btn--wide {
  flex-direction: row;
  justify-content: flex-start;
  gap: 7px;
  padding: 8px 8px;
  min-height: 34px;
}

.tool-btn--wide i {
  font-size: 12px;
}

.tool-btn--wide .tool-btn__label {
  font-size: 10px;
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

.tool-btn--active {
  background: rgba(212, 175, 55, 0.18);
  border-color: rgba(212, 175, 55, 0.35);
  color: #ffd700;
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

/* Grid Tools Wrapper */
.grid-tools-wrapper {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 14px;
  width: 100%;
  max-width: 100%;
}

.grid-tools-wrapper > .grid {
  flex: 1 1 auto;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

/* Select controls inside tools panel */
.tools-panel__select-controls {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.tools-panel__select-all {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.68rem;
  white-space: nowrap;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  padding: 0 4px;
}

.tools-panel__select-all input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
  flex-shrink: 0;
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
  width: 100%;
  max-width: 100%;
  justify-content: center;
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
}

@media (max-width: 480px) {
  .grid-wrapper {
    margin-top: 0;
    margin-bottom: 30px;
  }
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .photoGrid-container {
    padding: env(safe-area-inset-top, 0px) calc(12px + env(safe-area-inset-right, 0px)) 0 calc(12px + env(safe-area-inset-left, 0px));
  }
}

@media (max-width: 480px) {
  .photoGrid-container {
    padding: env(safe-area-inset-top, 0px) calc(8px + env(safe-area-inset-right, 0px)) 0 calc(8px + env(safe-area-inset-left, 0px));
  }

  .photo-input-label {
    margin-top: 12px;
    padding: 8px 12px;
    font-size: 0.8rem;
  }

  .photo-input-hint {
    font-size: 0.65rem;
  }
}
</style>
