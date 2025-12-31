<template>
  <div v-if="show" class="modal-background" @click="$emit('close')">
    <div class="modal-content" @click.stop>
      <Cropper
        ref="cropper"
        :src="currentImageSrc"
        :stencil-props="{
          aspectRatio: selectedAspectRatio,
          movable: true,
          scalable: true,
        }"
        @ready="onCropperReady"
      />
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
        <div class="actions">
          <button @click="cropImage">Crop</button>
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

const { show, imageSrc, initialCrop } = defineProps<{
  show: boolean;
  imageSrc: string;
  initialCrop?: { x: number; y: number; width: number; height: number };
}>();

const emit = defineEmits<{
  (
    e: "cropped",
    blob: Blob,
    crop: { x: number; y: number; width: number; height: number }
  ): void;
  (e: "close"): void;
}>();

const cropper = ref<CropperInstance | null>(null);
const selectedAspectRatio = ref<number | null>(null);
const currentImageSrc = ref<string>(imageSrc);
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

// Watch for changes in imageSrc prop to update currentImageSrc
watch(
  () => imageSrc,
  (newSrc) => {
    currentImageSrc.value = newSrc;
    cropHistory.value = [];
    cropFuture.value = [];
  }
);

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
            console.log(
              "Reapplied coordinates for image:",
              currentState.coordinates
            );
          }
        }
      };
      if (img.complete) {
        img.onload(null as any);
      }
    }
  }
);

// Debug modal visibility
watch(
  () => show,
  (newShow) => {
    console.log("CropModal show:", newShow);
  },
  { immediate: true }
);

const handleEsc = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    console.log("Escape key pressed, emitting close");
    emit("close");
  }
};

onMounted(() => {
  console.log("CropModal mounted, show:", show);
  window.addEventListener("keydown", handleEsc);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleEsc);
});

const onCropperReady = () => {
  if (cropper.value && cropper.value.image) {
    // Wait for next tick to ensure cropper is fully initialized
    nextTick(() => {
      if (cropper.value && cropper.value.image) {
        const img = cropper.value.image;
        let coordinates;

        if (initialCrop) {
          // Use existing crop coordinates as initial selection
          // These are in natural pixel space, which setCoordinates should accept
          coordinates = {
            left: initialCrop.x,
            top: initialCrop.y,
            width: initialCrop.width,
            height: initialCrop.height,
          };
          console.log("Setting initial crop coordinates:", coordinates);
          cropper.value.setCoordinates(coordinates);
          // Update boundaries to ensure proper positioning
          cropper.value.updateBoundaries();
        } else {
          // No existing crop - set to full image
          coordinates = {
            left: 0,
            top: 0,
            width: img.naturalWidth,
            height: img.naturalHeight,
          };
          cropper.value.setCoordinates(coordinates);
          cropper.value.updateBoundaries();
        }

        // Store in history for undo/redo - use delay to ensure canvas is ready
        setTimeout(() => {
          if (cropper.value) {
            const { canvas } = cropper.value.getResult();
            if (canvas) {
              canvas.toBlob((blob) => {
                if (blob) {
                  cropHistory.value = [{ blob, coordinates }];
                  console.log("Initial history:", cropHistory.value);
                }
              }, "image/png");
            } else {
              console.warn("Canvas is undefined in onCropperReady");
            }
          }
        }, 100);
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
        console.log("Crop history:", cropHistory.value);

        console.log("=== CROP COORDINATE CONVERSION ===");
        console.log("Stencil coordinates (cropper internal):", stencilCoords);
        console.log(
          "getResult() coordinates (natural image space):",
          resultCoordinates
        );
        console.log("Cropped canvas dimensions (output):", {
          width: canvas.width,
          height: canvas.height,
        });

        // Use coordinates from getResult() - they're already in natural image pixel space
        let naturalCoords;
        if (resultCoordinates) {
          naturalCoords = {
            x: Math.round(resultCoordinates.left),
            y: Math.round(resultCoordinates.top),
            width: Math.round(resultCoordinates.width),
            height: Math.round(resultCoordinates.height),
          };
          console.log(
            "Using getResult() coordinates (already in natural space)"
          );
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
        console.log("Final natural coordinates:", naturalCoords);
        console.log("=== END CROP COORDINATE CONVERSION ===");

        emit("cropped", blob, naturalCoords);
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
    const { left, top, width, height } = cropper.value.stencilCoordinates;
    const { width: imgWidth, height: imgHeight } = cropper.value.getResult()
      .canvas || {
      width: 0,
      height: 0,
    };

    console.log("Before rotate:", {
      imgWidth,
      imgHeight,
      left,
      top,
      width,
      height,
    });

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

    console.log("After rotate:", { newLeft, newTop, newWidth, newHeight });

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
          console.log("Rotate history:", cropHistory.value);
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
      console.log("Undoing to:", currentState);
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
      console.log("Redoing to:", nextState);
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
              console.log("Reset history:", cropHistory.value);
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

:deep(.vue-advanced-cropper) {
  flex: 1;
  width: 100%;
  max-width: none;
  max-height: none;
  border-radius: var(--border-radius-sm);
  overflow: hidden;
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
</style>
