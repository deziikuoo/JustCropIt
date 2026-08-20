<template>
  <div v-if="show" class="modal-background" @click="$emit('close')">
    <div class="modal-content" @click.stop>
      <div class="cropper-wrapper" :class="{ dragging: isDragging }">
        <div
          v-if="suggestionLoading"
          class="suggestion-overlay"
          role="status"
          aria-live="polite"
        >
          <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
          <span>Finding target...</span>
        </div>
        <Cropper
          ref="cropper"
          :key="`cropper-${imageSrc}-${initialRotation || 0}`"
          :src="currentImageSrc"
          :default-size="fullImageDefaultSize"
          :stencil-props="{
            aspectRatio: selectedAspectRatio,
            movable: true,
            scalable: true,
          }"
          @ready="onCropperReady"
        />
        <!-- Arrow navigation buttons (show when there's more than one image) -->
        <button
          v-if="totalBatchCount && totalBatchCount > 1"
          class="nav-arrow nav-arrow-left"
          @click="$emit('previous-image')"
          :disabled="currentBatchIndex === 0"
          title="Previous image"
        >
          <i class="fas fa-chevron-left"></i>
        </button>
        <button
          v-if="totalBatchCount && totalBatchCount > 1"
          class="nav-arrow nav-arrow-right"
          @click="$emit('next-image')"
          :disabled="currentBatchIndex === totalBatchCount - 1"
          title="Next image"
        >
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>
      <div class="controls">
        <div class="controls-row">
          <label for="aspect-ratio">Aspect Ratio:</label>
          <select id="aspect-ratio" v-model="selectedAspectRatio">
            <option :value="null">Freeform</option>
            <option :value="1">1:1</option>
            <option :value="4 / 3">4:3</option>
            <option :value="16 / 9">16:9</option>
          </select>
          <button
            type="button"
            class="control-icon-btn"
            title="Rotate left"
            aria-label="Rotate left"
            @click="rotate(-90)"
          >
            <i class="fas fa-rotate-left" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="control-icon-btn"
            title="Rotate right"
            aria-label="Rotate right"
            @click="rotate(90)"
          >
            <i class="fas fa-rotate-right" aria-hidden="true"></i>
          </button>
          <button @click="reset">Reset</button>
          <p
            v-if="suggestionError"
            class="suggestion-message suggestion-message--error"
            role="status"
          >
            {{ suggestionError }}
          </p>
          <p
            v-else-if="suggestionNoSubject"
            class="suggestion-message"
            role="status"
          >
            No subject detected — adjust stencil manually.
          </p>
          <div class="actions">
            <button @click="cropImage">Done</button>
            <button @click="$emit('close')">Cancel</button>
          </div>
        </div>
        <div v-if="detectionSupported" class="crop-target-bar">
          <div
            class="crop-target-group"
            role="radiogroup"
            aria-label="Crop target"
          >
            <button
              v-for="option in cropTargetOptions"
              :key="option.value"
              type="button"
              class="crop-target-btn"
              role="radio"
              :aria-checked="selectedCropTarget === option.value"
              :class="{ 'crop-target-btn--active': selectedCropTarget === option.value }"
              :disabled="suggestionLoading"
              :title="option.label"
              :aria-label="option.label"
              @click="selectCropTarget(option.value)"
            >
              <i :class="option.icon" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Cropper } from "vue-advanced-cropper";
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import "vue-advanced-cropper/dist/style.css";
import type { CropTarget } from "../types/detection";

// Type alias to extend Cropper instance with custom methods and properties
type CropperInstance = InstanceType<typeof Cropper> & {
  getResult: () => {
    canvas: HTMLCanvasElement | undefined;
    coordinates?: { left: number; top: number; width: number; height: number };
  };
  rotate: (angle: number) => void;
  reset: () => void;
  setCoordinates: (coords: {
    left: number;
    top: number;
    width: number;
    height: number;
  }) => void;
  stencilCoordinates: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  updateBoundaries: () => void;
  image: HTMLImageElement | null;
  visibleArea?: {
    width: number;
    height: number;
    left: number;
    top: number;
  };
  imageSize?: {
    width: number;
    height: number;
  };
};

const {
  show,
  imageSrc,
  initialCrop,
  initialRotation,
  suggestedCrop,
  suggestionLoading,
  suggestionError,
  suggestionNoSubject,
  detectionSupported,
  currentBatchIndex,
  totalBatchCount,
} = defineProps<{
  show: boolean;
  imageSrc: string;
  initialCrop?: { x: number; y: number; width: number; height: number };
  initialRotation?: number;
  suggestedCrop?: { x: number; y: number; width: number; height: number } | null;
  suggestionLoading?: boolean;
  suggestionError?: string | null;
  suggestionNoSubject?: boolean;
  detectionSupported?: boolean;
  batchMode?: boolean;
  currentBatchIndex?: number;
  totalBatchCount?: number;
}>();

const emit = defineEmits<{
  (
    e: "cropped",
    blob: Blob,
    crop: { x: number; y: number; width: number; height: number },
    rotation: number
  ): void;
  (e: "close"): void;
  (e: "next-image"): void;
  (e: "previous-image"): void;
  (e: "request-suggest", target: CropTarget): void;
  (e: "cancel-suggest"): void;
}>();

const cropper = ref<CropperInstance | null>(null);
const selectedAspectRatio = ref<number | null>(null);
const selectedCropTarget = ref<CropTarget | null>(null);
const cropTargetOptions: { value: CropTarget; label: string; icon: string }[] = [
  { value: 'full-body', label: 'Full body', icon: 'fas fa-person' },
  { value: 'upper-body', label: 'Upper body', icon: 'fas fa-user' },
  { value: 'lower-body', label: 'Lower body', icon: 'fas fa-person-walking' },
  { value: 'head-shoulders', label: 'Head and shoulders', icon: 'fas fa-portrait' },
  { value: 'head', label: 'Head', icon: 'fas fa-circle-user' },
];
const currentImageSrc = ref<string>(imageSrc);
const currentRotation = ref<number>(initialRotation || 0); // Track cumulative rotation
const isDragging = ref(false); // Track if stencil is being dragged (for iOS-style overlay)

function selectCropTarget(target: CropTarget) {
  selectedCropTarget.value = target;
  selectedAspectRatio.value = null;
  emit('request-suggest', target);
}

// Watch for changes in imageSrc and initialRotation props
watch([() => imageSrc, () => initialRotation], ([newSrc, newRotation]) => {
  currentImageSrc.value = newSrc;
  currentRotation.value = newRotation || 0;
  selectedCropTarget.value = null;
});

// Helper function to apply rotation to the cropper
const applyRotationToCropper = (rotation: number) => {
  if (!cropper.value || !cropper.value.image) {
    console.warn("Cropper not ready for rotation");
    return;
  }
  
  // Reset cropper first to clear any existing rotation
  cropper.value.reset();
  cropper.value.updateBoundaries();

  // Apply the rotation immediately
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const rotationSteps = Math.round(normalizedRotation / 90) % 4;

  for (let i = 0; i < rotationSteps; i++) {
    cropper.value.rotate(90);
  }
  cropper.value.updateBoundaries();
  currentRotation.value = normalizedRotation;
};

const handleEsc = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    emit("close");
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleEsc);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleEsc);
  if (dragListenerCleanup) {
    dragListenerCleanup();
    dragListenerCleanup = null;
  }
  if (readyTimeoutId) {
    clearTimeout(readyTimeoutId);
    readyTimeoutId = null;
  }
  emit("cancel-suggest");
  isDragging.value = false;
});

// Setup event listeners for stencil dragging (iOS-style overlay effect)
const setupStencilDragListeners = () => {
  if (!cropper.value) return null;

  // Find the stencil element
  const cropperElement = (cropper.value as any).$el;
  if (!cropperElement) {
    console.warn("CropModal: cropperElement not found");
    return null;
  }

  // Track if we're in a drag operation
  let dragStarted = false;

  // Track mouse/touch events on handlers (resize points)
  const handleDragStart = (_e: Event) => {
    dragStarted = true;
    isDragging.value = true;
  };

  // Try to find stencil element - it might have different class names
  // vue-advanced-cropper uses vue-rectangle-stencil for rectangle stencils
  const stencilContainer = cropperElement.querySelector(
    ".vue-stencil, .vue-simple-stencil, .vue-circle-stencil, .vue-rectangle-stencil"
  );

  // Also get handlers (resize points)
  const handlers = cropperElement.querySelectorAll(
    ".vue-simple-handler, .vue-handler-wrapper, .vue-handler"
  );

  // Track mouse/touch down on stencil body to detect dragging
  const handleStencilMouseDown = (e: MouseEvent | TouchEvent) => {
    // Don't trigger if clicking on a handler (they have their own handler)
    const target = e.target as HTMLElement;
    if (
      target.closest(
        ".vue-simple-handler, .vue-handler-wrapper, .vue-handler, .vue-bounding-box__handler"
      )
    ) {
      return;
    }
    dragStarted = true;
    isDragging.value = true;
  };

  // Also listen on the entire cropper area for edge dragging
  // The stencil edges might be rendered outside the stencil container
  const handleCropperMouseDown = (e: MouseEvent | TouchEvent) => {
    const target = e.target as HTMLElement;

    // Check if clicking on handlers (exclude these)
    const handlerParent = target.closest(
      ".vue-simple-handler, .vue-handler-wrapper, .vue-handler, .vue-bounding-box__handler"
    );

    if (handlerParent) {
      // This is a handler, don't process here (handled by handleDragStart)
      return;
    }

    // Check if clicking on stencil (including rectangle-stencil) or its children
    const stencilParent = target.closest(
      ".vue-stencil, .vue-simple-stencil, .vue-circle-stencil, .vue-rectangle-stencil"
    );

    // Also check if clicking on line-wrapper elements (the edges)
    const isLineWrapper =
      target.classList.contains("vue-line-wrapper") ||
      target.classList.contains("vue-simple-line-wrapper") ||
      !!target.closest(".vue-line-wrapper, .vue-simple-line-wrapper");

    // Check if clicking inside the stencil preview area
    const isInPreview = target.closest(
      ".vue-preview, .vue-preview__wrapper, .vue-rectangle-stencil__preview"
    );

    if ((stencilParent || isLineWrapper || isInPreview) && !handlerParent) {
      if (!dragStarted) {
        dragStarted = true;
        isDragging.value = true;
      }
    }
  };

  // Track mouse/touch move to detect when dragging actually starts on stencil body
  const handleMouseMove = () => {
    if (dragStarted && !isDragging.value) {
      isDragging.value = true;
    }
  };

  const handleTouchMove = () => {
    if (dragStarted && !isDragging.value) {
      isDragging.value = true;
    }
  };

  // Listen for drag end on document
  const handleDocumentMouseUp = () => {
    if (dragStarted || isDragging.value) {
      dragStarted = false;
      isDragging.value = false;
    }
  };

  const handleDocumentTouchEnd = () => {
    if (dragStarted || isDragging.value) {
      dragStarted = false;
      isDragging.value = false;
    }
  };

  // Add listeners to stencil container (for dragging the whole stencil body/edges)
  // Use capture phase to catch events before vue-advanced-cropper handles them
  if (stencilContainer) {
    stencilContainer.addEventListener(
      "mousedown",
      handleStencilMouseDown,
      true
    );
    stencilContainer.addEventListener("touchstart", handleStencilMouseDown, {
      passive: true,
      capture: true,
    });
  }

  // Also listen on the entire cropper element to catch edge dragging
  // This ensures we catch all interactions with the stencil, including edges
  cropperElement.addEventListener("mousedown", handleCropperMouseDown, true);
  cropperElement.addEventListener("touchstart", handleCropperMouseDown, {
    passive: true,
    capture: true,
  });

  // Add event listeners to handlers (for resizing via handles)
  handlers.forEach((handler: Element) => {
    handler.addEventListener("mousedown", handleDragStart);
    handler.addEventListener("touchstart", handleDragStart, { passive: true });
  });

  // Listen for mouse/touch move to detect dragging
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("touchmove", handleTouchMove, { passive: true });

  // Listen for drag end on document
  document.addEventListener("mouseup", handleDocumentMouseUp);
  document.addEventListener("touchend", handleDocumentTouchEnd);
  document.addEventListener("touchcancel", handleDocumentTouchEnd);

  // Cleanup function
  return () => {
    if (stencilContainer) {
      stencilContainer.removeEventListener(
        "mousedown",
        handleStencilMouseDown,
        true
      );
      stencilContainer.removeEventListener(
        "touchstart",
        handleStencilMouseDown,
        {
          capture: true,
        } as EventListenerOptions
      );
    }
    cropperElement.removeEventListener(
      "mousedown",
      handleCropperMouseDown,
      true
    );
    cropperElement.removeEventListener("touchstart", handleCropperMouseDown, {
      capture: true,
    } as EventListenerOptions);
    handlers.forEach((handler: Element) => {
      handler.removeEventListener("mousedown", handleDragStart);
      handler.removeEventListener("touchstart", handleDragStart);
    });
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("touchmove", handleTouchMove);
    document.removeEventListener("mouseup", handleDocumentMouseUp);
    document.removeEventListener("touchend", handleDocumentTouchEnd);
    document.removeEventListener("touchcancel", handleDocumentTouchEnd);
  };
};

let dragListenerCleanup: (() => void) | null = null;
let readyTimeoutId: ReturnType<typeof setTimeout> | null = null;

type NaturalCrop = { x: number; y: number; width: number; height: number };

function mapNaturalToCropperCoords(
  natural: NaturalCrop,
  cropperInstance: CropperInstance
): NaturalCrop | null {
  const img = cropperInstance.imageSize;
  const el = cropperInstance.image;
  const naturalWidth = el?.naturalWidth ?? img?.width;
  const naturalHeight = el?.naturalHeight ?? img?.height;

  if (img && naturalWidth && naturalHeight) {
    const scaleX = img.width / naturalWidth;
    const scaleY = img.height / naturalHeight;
    return {
      x: natural.x * scaleX,
      y: natural.y * scaleY,
      width: natural.width * scaleX,
      height: natural.height * scaleY,
    };
  }

  if (el) {
    return { ...natural };
  }

  return null;
}

function resolveInitialNaturalCrop(): NaturalCrop | null {
  if (suggestedCrop) return { ...suggestedCrop };
  if (initialCrop) return { ...initialCrop };
  return null;
}

function fullImageDefaultSize({
  imageSize,
  visibleArea,
}: {
  imageSize: { width: number; height: number };
  visibleArea?: { width: number; height: number } | null;
}) {
  const area = visibleArea || imageSize;
  return {
    width: area.width,
    height: area.height,
  };
}

function setFullImageCoordinates(): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  if (!cropper.value) return null;

  cropper.value.setCoordinates(
    ({
      imageSize,
    }: {
      imageSize: { width: number; height: number };
    }) => ({
      left: 0,
      top: 0,
      width: imageSize.width,
      height: imageSize.height,
    })
  );
  cropper.value.updateBoundaries();
  return {
    left: 0,
    top: 0,
    width: cropper.value.imageSize?.width ?? 0,
    height: cropper.value.imageSize?.height ?? 0,
  };
}

function applyCoordinatesToCropper(
  natural: NaturalCrop | null,
  useFullFrameFallback: boolean
): { left: number; top: number; width: number; height: number } | null {
  if (!cropper.value) return null;

  cropper.value.updateBoundaries();

  if (natural) {
    const mapped = mapNaturalToCropperCoords(natural, cropper.value);
    if (mapped) {
      const coordinates = {
        left: mapped.x,
        top: mapped.y,
        width: mapped.width,
        height: mapped.height,
      };
      cropper.value.setCoordinates(coordinates);
      cropper.value.updateBoundaries();
      return coordinates;
    }
  }

  if (useFullFrameFallback) {
    return setFullImageCoordinates();
  }

  return null;
}

const applyStencilFromProps = (useFullFrameFallback = true) => {
  if (!cropper.value || !cropper.value.image) return;
  applyCoordinatesToCropper(resolveInitialNaturalCrop(), useFullFrameFallback);
};

watch(
  () => suggestedCrop,
  async (crop) => {
    if (!crop || !cropper.value?.image) return;
    await nextTick();
    applyCoordinatesToCropper({ ...crop }, false);
  }
);

const onCropperReady = () => {
  if (cropper.value && cropper.value.image) {
    // Wait for next tick to ensure cropper is fully initialized
    nextTick(() => {
      if (cropper.value && cropper.value.image) {
        // Setup drag listeners for iOS-style overlay
        if (dragListenerCleanup) {
          dragListenerCleanup();
        }
        dragListenerCleanup = setupStencilDragListeners();
        if (initialRotation !== undefined && initialRotation !== 0) {
          applyRotationToCropper(initialRotation);
        }

        readyTimeoutId = setTimeout(() => {
          applyStencilFromProps(true);
        }, 50);
      }
    });
  } else {
    console.warn("Cropper or image is undefined in onCropperReady");
  }
};

const cropImage = async () => {
  if (cropper.value) {
    const { canvas } = cropper.value.getResult();
    if (canvas) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (blob && cropper.value.image) {
        const cropperResult = cropper.value.getResult();

        // Use coordinates from getResult() which are already in natural image space
        // stencilCoordinates are in a different coordinate system (viewport/scaled)
        const resultCoordinates = (cropperResult as any).coordinates;
        const stencilCoords = cropper.value.stencilCoordinates;

        // Use coordinates from getResult() - they're already in natural image pixel space
        let naturalCoords;
        if (resultCoordinates) {
          naturalCoords = {
            x: Math.round(resultCoordinates.left),
            y: Math.round(resultCoordinates.top),
            width: Math.round(resultCoordinates.width),
            height: Math.round(resultCoordinates.height),
          };
        } else {
          // Fallback to stencilCoordinates if getResult() doesn't provide coordinates
          console.warn(
            "getResult() coordinates not available, using stencilCoordinates"
          );
          naturalCoords = {
            x: Math.round(stencilCoords.left),
            y: Math.round(stencilCoords.top),
            width: Math.round(stencilCoords.width),
            height: Math.round(stencilCoords.height),
          };
        }

        emit("cropped", blob, naturalCoords, currentRotation.value);
        emit("close");
      } else {
        console.warn("Failed to create blob in cropImage");
      }
    } else {
      console.warn("Canvas is undefined in cropImage");
    }
  }
};

const rotate = (angle: number) => {
  if (cropper.value) {
    // Update cumulative rotation (normalize to 0-360 range)
    currentRotation.value = (currentRotation.value + angle) % 360;
    if (currentRotation.value < 0) {
      currentRotation.value += 360;
    }
    const { left, top, width, height } = cropper.value.stencilCoordinates;
    const { width: imgWidth, height: imgHeight } = cropper.value.getResult()
      .canvas || {
      width: 0,
      height: 0,
    };

    const centerX = (left + width / 2) / imgWidth - 0.5;
    const centerY = (top + height / 2) / imgHeight - 0.5;

    cropper.value.rotate(angle);
    cropper.value.updateBoundaries();

    let newLeft: number, newTop: number, newWidth: number, newHeight: number;
    const newImgWidth = imgHeight;
    const newImgHeight = imgWidth;

    if (angle === 90 || angle === -270) {
      const newCenterX = centerY;
      const newCenterY = -centerX;
      newWidth = height;
      newHeight = width;
      newLeft = (newCenterX + 0.5) * newImgWidth - newWidth / 2;
      newTop = (newCenterY + 0.5) * newImgHeight - newHeight / 2;
    } else if (angle === -90 || angle === 270) {
      const newCenterX = -centerY;
      const newCenterY = centerX;
      newWidth = height;
      newHeight = width;
      newLeft = (newCenterX + 0.5) * newImgWidth - newWidth / 2;
      newTop = (newCenterY + 0.5) * newImgHeight - newHeight / 2;
    } else {
      newLeft = left;
      newTop = top;
      newWidth = width;
      newHeight = height;
    }

    newLeft = Math.max(0, Math.min(newLeft, newImgWidth - newWidth));
    newTop = Math.max(0, Math.min(newTop, newImgHeight - newHeight));

    const coordinates = {
      left: newLeft,
      top: newTop,
      width: newWidth,
      height: newHeight,
    };
    cropper.value.setCoordinates(coordinates);
  }
};

const reset = async () => {
  if (!cropper.value?.image) {
    console.warn("Cropper or image is undefined in reset");
    return;
  }

  selectedAspectRatio.value = null;
  selectedCropTarget.value = null;
  currentRotation.value = initialRotation || 0;
  await nextTick();

  cropper.value.reset();
  await nextTick();
  setFullImageCoordinates();
};
</script>

<style scoped>
.modal-background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 200;
}

.modal-content {
  background: var(--surface-color);
  border: 1px solid var(--surface-border);
  border-radius: var(--border-radius);
  padding: 24px;
  width: 92vw;
  max-width: 1200px;
  height: 88vh;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: var(--shadow-lg);
}

.cropper-wrapper {
  flex: 1;
  position: relative;
  width: 100%;
  border-radius: var(--border-radius-sm);
  overflow: hidden;
}

:deep(.vue-advanced-cropper) {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  border-radius: var(--border-radius-sm);
  overflow: hidden;
}

/* iOS-style overlay opacity during dragging */
/* The overlay (darkened area outside crop box) is typically the foreground layer */
.cropper-wrapper:not(.dragging) :deep(.vue-advanced-cropper__foreground) {
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.cropper-wrapper.dragging :deep(.vue-advanced-cropper__foreground) {
  opacity: 1;
  transition: opacity 0.1s ease;
}

/* Also try background in case that's the overlay (fallback) */
.cropper-wrapper:not(.dragging) :deep(.vue-advanced-cropper__background) {
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.cropper-wrapper.dragging :deep(.vue-advanced-cropper__background) {
  opacity: 1;
  transition: opacity 0.1s ease;
}

:deep(.vue-preview_wrapper) {
  width: 100% !important;
  height: 100% !important;
}

:deep(.vue-preview_image) {
  max-width: none !important;
  max-height: none !important;
  transform: none !important;
}

:deep(.vue-advanced-cropper__foreground),
:deep(.vue-advanced-cropper__background) {
  max-width: none;
  max-height: none;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* Style stencil handles/points to white */
:deep(.vue-simple-handler) {
  background-color: white !important;
  border-color: white !important;
}

:deep(.vue-simple-handler--hover) {
  background-color: rgba(255, 255, 255, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.9) !important;
}

/* Style stencil edges/border to white */
:deep(.vue-rectangle-stencil) {
  border-color: white !important;
}

:deep(.vue-bounding-box) {
  border-color: white !important;
}

:deep(.vue-line-wrapper) {
  border-color: white !important;
}

:deep(.vue-simple-line-wrapper) {
  border-color: white !important;
}

.cropper-wrapper {
  position: relative;
}

.crop-target-bar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
}

.crop-target-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.crop-target-btn {
  width: 40px;
  min-width: 40px;
  height: 40px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

.crop-target-btn--active {
  background: rgba(212, 175, 55, 0.22);
  border-color: rgba(212, 175, 55, 0.5);
  color: #e8c96a;
}

.crop-target-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.suggestion-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  pointer-events: none;
}

.suggestion-message {
  width: 100%;
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}

.suggestion-message--error {
  color: #f87171;
}

.controls {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px 0;
  border-top: 1px solid var(--surface-border);
}

.controls-row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}

.controls label {
  font-weight: 500;
}

.control-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  min-width: 40px;
  height: 40px;
  padding: 0;
  white-space: nowrap;
}

.control-icon-btn i {
  font-size: 0.95rem;
}

.actions {
  display: flex;
  gap: 12px;
  margin-left: 24px;
  padding-left: 24px;
  border-left: 1px solid var(--surface-border);
}

.actions button:first-child {
  background: rgba(255, 255, 255, 0.15);
  border-color: #888;
}

.actions button:first-child:hover {
  background: rgba(255, 255, 255, 0.25);
  border-color: #aaa;
}

.actions button:last-child:hover {
  background: var(--danger-color);
  border-color: var(--danger-color);
}

@media (max-width: 768px) {
  .modal-content {
    padding: 16px;
    height: 92vh;
    width: 96vw;
  }

  .controls-row {
    gap: 8px;
    flex-wrap: wrap;
  }

  .crop-target-bar {
    gap: 8px;
  }

  .actions {
    margin-left: 0;
    padding-left: 0;
    border-left: none;
    margin-top: 8px;
    width: 100%;
    justify-content: center;
  }

  .actions button {
    min-height: 40px;
    padding: 10px 16px;
    font-size: 0.875rem;
  }
}

@media (max-width: 480px) {
  .modal {
    padding: 0;
  }

  .modal-content {
    padding: 12px;
    height: 100vh;
    width: 100vw;
    border-radius: 0;
    max-width: 100vw;
  }

  .controls {
    gap: 6px;
    padding: 10px 0;
  }

  .controls label {
    font-size: 0.8rem;
  }

  .actions {
    margin-top: 6px;
    gap: 8px;
  }

  .actions button {
    min-height: 44px;
    padding: 10px 14px;
    font-size: 0.8rem;
    flex: 1;
  }

  :deep(.vue-advanced-cropper) {
    border-radius: 0;
  }
}

/* Navigation arrows */
.nav-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.9);
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.nav-arrow:hover:not(:disabled) {
  background: rgba(255, 255, 255, 1);
  border-color: rgba(255, 255, 255, 0.5);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transform: translateY(-50%) scale(1.1);
}

.nav-arrow:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.nav-arrow-left {
  left: 16px;
}

.nav-arrow-right {
  right: 16px;
}

.nav-arrow i {
  font-size: 20px;
  color: #1e1e2e;
}

@media (max-width: 768px) {
  .nav-arrow {
    width: 40px;
    height: 40px;
  }

  .nav-arrow i {
    font-size: 16px;
  }

  .nav-arrow-left {
    left: 8px;
  }

  .nav-arrow-right {
    right: 8px;
  }
}

@media (max-width: 480px) {
  .nav-arrow {
    width: 36px;
    height: 36px;
  }

  .nav-arrow i {
    font-size: 14px;
  }

  .nav-arrow-left {
    left: 4px;
  }

  .nav-arrow-right {
    right: 4px;
  }
}
</style>
