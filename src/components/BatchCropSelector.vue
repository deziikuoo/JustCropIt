<template>
  <div v-if="show" class="modal-background" @click="$emit('close')">
    <div class="modal-content" @click.stop>
      <h2 class="modal-title">Select Template Image</h2>
      <p class="modal-description">
        Choose an image to use as the template for batch cropping. The crop settings
        from this image will be applied to all {{ imageIndices.length }} selected images.
      </p>
      <div class="thumbnail-grid">
        <div
          v-for="(index, idx) in imageIndices"
          :key="index"
          class="thumbnail-item"
          :class="{ selected: selectedIndex === index }"
          @click="selectImage(index)"
        >
          <div class="thumbnail-wrapper">
            <img
              :src="thumbnailUrls[idx]"
              :alt="`Image ${idx + 1}`"
              class="thumbnail-image"
              @load="handleImageLoad"
            />
            <div v-if="selectedIndex === index" class="selected-overlay">
              <i class="fas fa-check-circle"></i>
            </div>
          </div>
          <div class="thumbnail-label">Image {{ idx + 1 }}</div>
        </div>
      </div>
      <div class="modal-actions">
        <button @click="$emit('close')" class="cancel-button">Cancel</button>
        <button
          @click="confirmSelection"
          :disabled="selectedIndex === null"
          class="confirm-button"
        >
          Use This Image
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";

const props = defineProps<{
  show: boolean;
  imageIndices: number[];
  photos: Array<{ original: File }>;
}>();

const emit = defineEmits<{
  (e: "select", index: number): void;
  (e: "close"): void;
}>();

const selectedIndex = ref<number | null>(null);
const thumbnailUrls = ref<string[]>([]);

// Generate thumbnail URLs when component shows or indices change
watch(
  [() => props.show, () => props.imageIndices],
  ([newShow, newIndices]) => {
    if (newShow && newIndices.length > 0) {
      // Cleanup old URLs
      thumbnailUrls.value.forEach((url) => URL.revokeObjectURL(url));
      
      // Generate new thumbnail URLs
      thumbnailUrls.value = newIndices.map((index) =>
        URL.createObjectURL(props.photos[index].original)
      );
      
      // Reset selection
      selectedIndex.value = null;
    }
  },
  { immediate: true }
);

// Cleanup URLs on unmount
onUnmounted(() => {
  thumbnailUrls.value.forEach((url) => URL.revokeObjectURL(url));
});

// Cleanup URLs when modal closes
watch(
  () => props.show,
  (newShow) => {
    if (!newShow) {
      thumbnailUrls.value.forEach((url) => URL.revokeObjectURL(url));
      thumbnailUrls.value = [];
      selectedIndex.value = null;
    }
  }
);

const selectImage = (index: number) => {
  selectedIndex.value = index;
};

const confirmSelection = () => {
  if (selectedIndex.value !== null) {
    emit("select", selectedIndex.value);
  }
};

const handleImageLoad = () => {
  // Image loaded successfully
};

// Handle escape key
const handleEsc = (event: KeyboardEvent) => {
  if (event.key === "Escape" && props.show) {
    emit("close");
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleEsc);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleEsc);
});
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
  z-index: 250;
}

.modal-content {
  background: var(--surface-color);
  border: 1px solid var(--surface-border);
  border-radius: var(--border-radius);
  padding: 32px;
  width: 90vw;
  max-width: 1000px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  gap: 24px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-description {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.5;
}

.thumbnail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
  overflow-y: auto;
  padding: 8px;
  flex: 1;
  min-height: 0;
}

.thumbnail-item {
  cursor: pointer;
  transition: transform 0.2s ease;
}

.thumbnail-item:hover {
  transform: scale(1.05);
}

.thumbnail-item.selected {
  transform: scale(1.05);
}

.thumbnail-wrapper {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--border-radius-sm);
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.2s ease;
}

.thumbnail-item.selected .thumbnail-wrapper {
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3);
}

.thumbnail-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.selected-overlay {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 18px;
}

.thumbnail-label {
  margin-top: 8px;
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--surface-border);
}

.cancel-button,
.confirm-button {
  padding: 10px 24px;
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--surface-border);
  background: var(--surface-color);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all var(--transition-fast);
}

.cancel-button:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--surface-border);
}

.confirm-button {
  background: rgba(255, 255, 255, 0.15);
  border-color: #888;
}

.confirm-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.25);
  border-color: #aaa;
}

.confirm-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .modal-content {
    padding: 24px;
    width: 95vw;
    max-height: 90vh;
  }

  .thumbnail-grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
  }

  .modal-title {
    font-size: 1.25rem;
  }

  .modal-actions {
    flex-direction: column-reverse;
  }

  .cancel-button,
  .confirm-button {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .thumbnail-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 10px;
  }
}
</style>

