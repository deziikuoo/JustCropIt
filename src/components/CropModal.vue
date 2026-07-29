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
          <span>Finding subject...</span>
        </div>
        <Cropper
          ref="cropper"
          :key="`cropper-${imageSrc}-${initialRotation || 0}`"
          :src="currentImageSrc"
          :stencil-props="{
            aspectRatio: selectedAspectRatio,
            movable: true,
            scalable: true,
          }"
          @ready="onCropperReady"
        />
        <canvas
          v-if="debugOverlayAvailable && showDebugOverlay && detectionDebug"
          ref="debugCanvas"
          class="detection-debug-canvas"
          aria-hidden="true"
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
        <label for="aspect-ratio">Aspect Ratio:</label>
        <select id="aspect-ratio" v-model="selectedAspectRatio">
          <option :value="null">Freeform</option>
          <option :value="1">1:1</option>
          <option :value="4 / 3">4:3</option>
          <option :value="16 / 9">16:9</option>
        </select>
        <button @click="rotate(-90)">Rotate Left</button>
        <button @click="rotate(90)">Rotate Right</button>
        <button @click="undo" :disabled="cropHistory.length <= 1">Undo</button>
        <button @click="redo" :disabled="cropFuture.length === 0">Redo</button>
        <button @click="reset">Reset</button>
        <button
          v-if="detectionSupported"
          type="button"
          class="suggest-btn"
          :disabled="suggestionLoading"
          @click="$emit('request-suggest')"
        >
          <i class="fas fa-wand-magic-sparkles"></i>
          Suggest crop
        </button>
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
        <label
          v-if="debugOverlayAvailable && detectionDebug"
          class="debug-overlay-toggle"
        >
          <input v-model="showDebugOverlay" type="checkbox" />
          Show detection landmarks
        </label>
        <div class="actions">
          <button @click="cropImage">Done</button>
          <button @click="$emit('close')">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Cropper } from "vue-advanced-cropper";
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import "vue-advanced-cropper/dist/style.css";
import { DETECTION_DEBUG_OVERLAY } from "../constants/optimization";
import type { PortraitDebugOverlay } from "../types/detection";

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
  detectionDebug,
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
  detectionDebug?: PortraitDebugOverlay | null;
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
  (e: "request-suggest"): void;
  (e: "cancel-suggest"): void;
}>();

const cropper = ref<CropperInstance | null>(null);
const debugCanvas = ref<HTMLCanvasElement | null>(null);
const debugOverlayAvailable = DETECTION_DEBUG_OVERLAY;
const showDebugOverlay = ref(true);
const selectedAspectRatio = ref<number | null>(null);
const currentImageSrc = ref<string>(imageSrc);
const currentRotation = ref<number>(initialRotation || 0); // Track cumulative rotation
const isDragging = ref(false); // Track if stencil is being dragged (for iOS-style overlay)
const cropHistory = ref<
  {
    blob: Blob;
    coordinates: { left: number; top: number; width: number; height: number };
  }[]
>([]);
const cropFuture = ref<
  {
    blob: Blob;
    coordinates: { left: number; top: number; width: number; height: number };
  }[]
>([]);

// Watch for changes in imageSrc and initialRotation props
watch([() => imageSrc, () => initialRotation], ([newSrc, newRotation]) => {
  currentImageSrc.value = newSrc;
  cropHistory.value = [];
  cropFuture.value = [];
  currentRotation.value = newRotation || 0;
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


// Watch currentImageSrc to reapply coordinates after image change
watch(
  () => currentImageSrc.value,
  (newSrc) => {
    if (newSrc && cropper.value) {
      const img = new Image();
      img.src = newSrc;
      img.onload = () => {
        if (cropper.value) {
          // Find the coordinates for the current state
          const currentState =
            cropHistory.value.find(
              (state) => URL.createObjectURL(state.blob) === newSrc
            ) || cropHistory.value[cropHistory.value.length - 1];
          if (currentState) {
            cropper.value.setCoordinates(currentState.coordinates);
          }
        }
      };
      if (img.complete) {
        img.onload(null as any);
      }
    }
  }
);

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
  if (historyTimeoutId) {
    clearTimeout(historyTimeoutId);
    historyTimeoutId = null;
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
let historyTimeoutId: ReturnType<typeof setTimeout> | null = null;

type NaturalCrop = { x: number; y: number; width: number; height: number };

function mapNaturalToCropperCoords(
  natural: NaturalCrop,
  cropperInstance: CropperInstance
): NaturalCrop | null {
  if (cropperInstance.visibleArea && cropperInstance.imageSize) {
    const va = cropperInstance.visibleArea;
    const img = cropperInstance.imageSize;
    const scaleX = va.width / img.width;
    const scaleY = va.height / img.height;
    return {
      x: va.left + natural.x * scaleX,
      y: va.top + natural.y * scaleY,
      width: natural.width * scaleX,
      height: natural.height * scaleY,
    };
  }

  if (cropperInstance.image) {
    return { ...natural };
  }

  return null;
}

const DEBUG_POINT_COLORS: Record<
  PortraitDebugOverlay["points"][number]["kind"],
  string
> = {
  "face-ear": "#ff4444",
  "face-cheek": "#ffcc00",
  "face-eye": "#00ccff",
  "pose-ear": "#44ff44",
  bbox: "#ff44ff",
};

/**
 * On-screen rectangle of the displayed image, relative to the overlay canvas.
 * Using the actual <img> element's bounding box correctly accounts for
 * letterboxing and fit-scaling (the cropper's internal image space does not
 * map 1:1 to DOM pixels).
 */
function getImageScreenRect(): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  const instance = cropper.value as unknown as { $el?: HTMLElement } | null;
  const canvas = debugCanvas.value;
  const imgEl = instance?.$el?.querySelector(
    ".vue-advanced-cropper__image"
  ) as HTMLElement | null;
  if (!imgEl || !canvas) return null;

  const wrapper = canvas.parentElement;
  if (!wrapper) return null;

  const imgRect = imgEl.getBoundingClientRect();
  const wrapRect = wrapper.getBoundingClientRect();
  if (imgRect.width <= 0 || imgRect.height <= 0) return null;

  return {
    left: imgRect.left - wrapRect.left,
    top: imgRect.top - wrapRect.top,
    width: imgRect.width,
    height: imgRect.height,
  };
}

function drawDetectionDebugOverlay(): void {
  const canvas = debugCanvas.value;
  const overlay = detectionDebug;
  if (!canvas || !overlay || !showDebugOverlay.value) return;

  // Normalized → screen mapping breaks under rotation; skip to avoid confusion.
  if (currentRotation.value !== 0) return;

  const wrapper = canvas.parentElement;
  if (!wrapper) return;

  const width = wrapper.clientWidth;
  const height = wrapper.clientHeight;
  if (width <= 0 || height <= 0) return;

  const imgRect = getImageScreenRect();
  if (!imgRect) return;

  const imgWidth = overlay.imageSize.width;
  const imgHeight = overlay.imageSize.height;
  if (imgWidth <= 0 || imgHeight <= 0) return;

  const toScreen = (px: number, py: number): { x: number; y: number } => ({
    x: imgRect.left + (px / imgWidth) * imgRect.width,
    y: imgRect.top + (py / imgHeight) * imgRect.height,
  });

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  for (const point of overlay.points) {
    const mapped = toScreen(point.x, point.y);
    const color = DEBUG_POINT_COLORS[point.kind];
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(mapped.x, mapped.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "10px sans-serif";
    ctx.fillStyle = color;
    ctx.fillText(point.label, mapped.x + 6, mapped.y - 6);
  }

  const drawRect = (
    box: { x: number; y: number; width: number; height: number },
    color: string,
    dash: number[]
  ) => {
    const topLeft = toScreen(box.x, box.y);
    const bottomRight = toScreen(
      box.x + box.width,
      box.y + box.height
    );
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.strokeRect(
      topLeft.x,
      topLeft.y,
      bottomRight.x - topLeft.x,
      bottomRight.y - topLeft.y
    );
    ctx.setLineDash([]);
  };

  if (overlay.bbox) {
    drawRect(overlay.bbox, DEBUG_POINT_COLORS.bbox, [6, 4]);
  }

  if (overlay.appliedCrop) {
    drawRect(overlay.appliedCrop, "rgba(255, 255, 255, 0.95)", []);
  }

  const legend = [
    overlay.widthSource ? `source: ${overlay.widthSource}` : null,
    overlay.faceWidthPx != null
      ? `face cap: ${Math.round(overlay.faceWidthPx)}px`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (legend) {
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.lineWidth = 3;
    ctx.strokeText(legend, 10, height - 12);
    ctx.fillText(legend, 10, height - 12);
  }
}

function scheduleDebugOverlayDraw(): void {
  if (!debugOverlayAvailable || !detectionDebug || !showDebugOverlay.value) {
    return;
  }
  nextTick(() => {
    requestAnimationFrame(() => drawDetectionDebugOverlay());
  });
}

function resolveInitialNaturalCrop(): NaturalCrop | null {
  if (suggestedCrop) return { ...suggestedCrop };
  if (initialCrop) return { ...initialCrop };
  return null;
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

  if (useFullFrameFallback && cropper.value.visibleArea) {
    const visibleArea = cropper.value.visibleArea;
    const coordinates = {
      left: visibleArea.left,
      top: visibleArea.top,
      width: visibleArea.width,
      height: visibleArea.height,
    };
    cropper.value.setCoordinates(coordinates);
    cropper.value.updateBoundaries();
    return coordinates;
  }

  if (useFullFrameFallback) {
    cropper.value.reset();
    cropper.value.updateBoundaries();
    return cropper.value.stencilCoordinates;
  }

  return null;
}

function seedCropHistory(coordinates: {
  left: number;
  top: number;
  width: number;
  height: number;
}): void {
  if (!cropper.value) return;

  historyTimeoutId = setTimeout(() => {
    if (!cropper.value) return;
    const { canvas } = cropper.value.getResult();
    if (canvas) {
      canvas.toBlob((blob) => {
        if (blob) {
          cropHistory.value = [{ blob, coordinates }];
          cropFuture.value = [];
        }
      }, "image/png");
    }
  }, 50);
}

const applyStencilFromProps = (useFullFrameFallback = true) => {
  if (!cropper.value || !cropper.value.image) return;

  const natural = resolveInitialNaturalCrop();
  const coordinates = applyCoordinatesToCropper(natural, useFullFrameFallback);
  if (coordinates) {
    seedCropHistory(coordinates);
  }
};

watch(
  () => suggestedCrop,
  (crop) => {
    if (!crop || !cropper.value?.image) return;
    const coordinates = applyCoordinatesToCropper({ ...crop }, false);
    if (coordinates) {
      seedCropHistory(coordinates);
    }
    scheduleDebugOverlayDraw();
  }
);

watch(
  () => [detectionDebug, suggestedCrop],
  () => scheduleDebugOverlayDraw()
);

watch(showDebugOverlay, () => scheduleDebugOverlayDraw());

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
          scheduleDebugOverlayDraw();
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

        // Store stencil coordinates for internal history (used for undo/redo within cropper)
        cropHistory.value.push({ blob, coordinates: stencilCoords });
        cropFuture.value = [];

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

    const { canvas } = cropper.value.getResult();
    if (canvas) {
      canvas.toBlob((blob) => {
        if (blob) {
          cropHistory.value.push({ blob, coordinates });
          cropFuture.value = [];
        }
      }, "image/png");
    } else {
      console.warn("Canvas is undefined in rotate");
    }
  }
};

const undo = () => {
  if (cropHistory.value.length > 1 && cropper.value) {
    const lastState = cropHistory.value.pop();
    if (lastState) {
      cropFuture.value.push(lastState);
      const currentState = cropHistory.value[cropHistory.value.length - 1];
      cropper.value.reset(); // Reset cropper to clear rotation state
      currentImageSrc.value = URL.createObjectURL(currentState.blob);
    }
  }
};

const redo = () => {
  if (cropFuture.value.length > 0 && cropper.value) {
    const nextState = cropFuture.value.pop();
    if (nextState) {
      cropHistory.value.push(nextState);
      cropper.value.reset(); // Reset cropper to clear rotation state
      currentImageSrc.value = URL.createObjectURL(nextState.blob);
    }
  }
};

const reset = () => {
  if (cropper.value && cropper.value.image) {
    cropper.value.reset();
    cropHistory.value = [];
    cropFuture.value = [];
    currentRotation.value = initialRotation || 0;
    const img = cropper.value.image;
    img.onload = () => {
      if (cropper.value) {
        const coordinates = {
          left: 0,
          top: 0,
          width: img.naturalWidth,
          height: img.naturalHeight,
        };
        cropper.value.setCoordinates(coordinates);
        const { canvas } = cropper.value!.getResult();
        if (canvas) {
          canvas.toBlob((blob) => {
            if (blob) {
              cropHistory.value = [{ blob, coordinates }];
            }
          }, "image/png");
        } else {
          console.warn("Canvas is undefined in reset");
        }
      }
    };
    if (img.complete) {
      img.onload(null as any);
    }
  } else {
    console.warn("Cropper or image is undefined in reset");
  }
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

.detection-debug-canvas {
  position: absolute;
  inset: 0;
  z-index: 6;
  pointer-events: none;
}

.debug-overlay-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin: 4px 0 0;
  cursor: pointer;
  user-select: none;
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

.suggest-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  gap: 12px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  padding: 12px 0;
  border-top: 1px solid var(--surface-border);
}

.controls label {
  font-weight: 500;
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

  .controls {
    gap: 8px;
    flex-wrap: wrap;
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
