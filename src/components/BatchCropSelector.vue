<template>
  <div v-if="show" class="modal-background" @click="$emit('close')">
    <div class="modal-content" @click.stop>
      <h2 class="modal-title">{{ modalTitle }}</h2>
      <p class="modal-description">
        {{ modeDescription }}
      </p>
      <div class="mode-group" role="radiogroup" aria-label="Batch crop mode">
        <button
          v-for="option in modeOptions"
          :key="option.value"
          type="button"
          class="mode-btn"
          role="radio"
          :aria-checked="selectedMode === option.value"
          :class="{ 'mode-btn--active': selectedMode === option.value }"
          :disabled="
            (option.needsDetection && !detectionSupported) ||
            (option.value === 'this-person' && !identitySupportedByBrowser)
          "
          :title="option.disabledReason"
          @click="selectMode(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <p v-if="!detectionSupported" class="mode-hint">
        Follow subject and This person need a browser that supports face detection.
      </p>
      <p
        v-else-if="isThisPersonMode"
        class="mode-hint mode-hint--legend"
      >
        <span class="legend legend--auto">Auto</span>
        <span class="legend legend--manual">Manual</span>
        — click images to add or remove references (max {{ maxRefs }}).
      </p>

      <div
        v-if="isThisPersonMode"
        class="ref-strip"
        role="list"
        aria-label="Selected reference images"
      >
        <div
          v-for="entry in referenceEntries"
          :key="`${entry.origin}-${entry.photoIndex}`"
          class="ref-strip__item"
          :class="
            entry.origin === 'auto'
              ? 'ref-strip__item--auto'
              : 'ref-strip__item--manual'
          "
          role="listitem"
        >
          <img
            :src="urlForPhotoIndex(entry.photoIndex)"
            :alt="`Reference ${entry.photoIndex}`"
            class="ref-strip__img"
          />
          <button
            type="button"
            class="ref-strip__remove"
            title="Remove reference"
            aria-label="Remove reference"
            @click.stop="removeReference(entry.photoIndex)"
          >
            <i class="fas fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
        <p v-if="referenceEntries.length === 0" class="ref-strip__empty">
          No references yet — auto picks will appear here, or click images below.
        </p>
      </div>

      <div class="thumbnail-grid">
        <div
          v-for="(index, idx) in imageIndices"
          :key="index"
          class="thumbnail-item"
          :class="thumbnailItemClass(index)"
          @click="selectImage(index)"
        >
          <div class="thumbnail-wrapper">
            <img
              :src="thumbnailUrls[idx]"
              :alt="`Image ${idx + 1}`"
              class="thumbnail-image"
            />
            <div
              v-if="selectionOrigin(index)"
              class="selected-overlay"
              :class="
                selectionOrigin(index) === 'auto'
                  ? 'selected-overlay--auto'
                  : 'selected-overlay--manual'
              "
            >
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
          :disabled="!canConfirm"
          class="confirm-button"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import type {
  BatchCropMode,
  BatchCropSelectPayload,
  IdentityReferenceOrigin,
} from "../types/batchCrop";
import { loadBatchCropMode, saveBatchCropMode } from "../utils/batchCropMode";
import {
  isDetectionSupported,
  preloadDetectionRuntime,
  preloadIdentityRuntime,
} from "../utils/subjectDetection";
import { identityWorkerPool } from "../utils/identityWorkerPool";
import {
  autoReferenceSampleCount,
  sampleEvenlySpacedIndices,
} from "../utils/identityAutoMultiView";
import { IDENTITY_REF_GALLERY_MAX } from "../constants/optimization";

interface ReferenceEntry {
  photoIndex: number;
  origin: IdentityReferenceOrigin;
}

const props = defineProps<{
  show: boolean;
  imageIndices: number[];
  photos: Array<{ original: File }>;
}>();

const emit = defineEmits<{
  (e: "select", payload: BatchCropSelectPayload): void;
  (e: "close"): void;
}>();

const selectedIndex = ref<number | null>(null);
const referenceEntries = ref<ReferenceEntry[]>([]);
const thumbnailUrls = ref<string[]>([]);
const detectionSupported = isDetectionSupported();
const identitySupportedByBrowser =
  typeof Worker !== "undefined" && typeof createImageBitmap !== "undefined";
/** Optimistic until a real (non-transient) warmup failure while the modal is open. */
const identityAvailable = ref(identitySupportedByBrowser);
const identityLoading = ref(false);
const selectedMode = ref<BatchCropMode>(
  detectionSupported ? loadBatchCropMode() : "same-box"
);

const maxRefs = IDENTITY_REF_GALLERY_MAX;
const isThisPersonMode = computed(() => selectedMode.value === "this-person");

const modeOptions = computed(() => [
  { value: "same-box" as const, label: "Same crop box", needsDetection: false },
  {
    value: "follow-subject" as const,
    label: "Follow subject",
    needsDetection: true,
    disabledReason: detectionSupported
      ? "Find the person in each photo"
      : "Detection is not supported in this browser",
  },
  {
    value: "this-person" as const,
    label: "This person",
    needsDetection: true,
    disabledReason: !detectionSupported
      ? "Detection is not supported in this browser"
      : !identitySupportedByBrowser
        ? "Face matching is not supported in this browser"
        : identityLoading.value
          ? "Loading face matching…"
          : !identityAvailable.value
            ? "Face matching failed to load — click to retry"
            : "Lock onto the person across frames",
  },
]);

const modalTitle = computed(() =>
  isThisPersonMode.value ? "Select Reference Images" : "Select Template Image"
);

const modeDescription = computed(() => {
  const count = props.imageIndices.length;
  if (selectedMode.value === "follow-subject") {
    return `Choose a template, then pick a crop target. Each of the ${count} photos will be cropped around its own subject.`;
  }
  if (selectedMode.value === "this-person") {
    return `Auto-picks ${autoReferenceSampleCount(count)} evenly spaced frames (white). Click more frames to add manual refs (yellow), then continue to set the crop target.`;
  }
  return `Choose an image to use as the template for batch cropping. The crop box from this image will be applied to all ${count} selected images.`;
});

const confirmLabel = computed(() =>
  isThisPersonMode.value ? "Continue" : "Use This Image"
);

const canConfirm = computed(() => {
  if (isThisPersonMode.value) {
    return referenceEntries.value.length >= 1;
  }
  return selectedIndex.value !== null;
});

const selectionOriginMap = computed(() => {
  const map = new Map<number, IdentityReferenceOrigin>();
  for (const entry of referenceEntries.value) {
    map.set(entry.photoIndex, entry.origin);
  }
  return map;
});

function selectionOrigin(
  photoIndex: number
): IdentityReferenceOrigin | null {
  if (isThisPersonMode.value) {
    return selectionOriginMap.value.get(photoIndex) ?? null;
  }
  return selectedIndex.value === photoIndex ? "manual" : null;
}

function thumbnailItemClass(photoIndex: number): Record<string, boolean> {
  const origin = selectionOrigin(photoIndex);
  return {
    selected: origin != null,
    "selected--auto": origin === "auto",
    "selected--manual": origin === "manual",
  };
}

function urlForPhotoIndex(photoIndex: number): string {
  const idx = props.imageIndices.indexOf(photoIndex);
  if (idx >= 0 && thumbnailUrls.value[idx]) {
    return thumbnailUrls.value[idx];
  }
  return "";
}

function seedAutoReferences() {
  const count = autoReferenceSampleCount(props.imageIndices.length);
  const sampled = sampleEvenlySpacedIndices(props.imageIndices, count);
  referenceEntries.value = sampled.map((photoIndex) => ({
    photoIndex,
    origin: "auto" as const,
  }));
}

function clearReferences() {
  referenceEntries.value = [];
}

async function preloadForMode(mode: BatchCropMode) {
  if (mode === "same-box") return;
  void preloadDetectionRuntime();
  if (mode !== "this-person") return;

  const stillOpen = () => props.show;
  identityWorkerPool.resetLoadFailure();
  identityLoading.value = true;
  try {
    await preloadIdentityRuntime();
    if (!stillOpen()) return;
    identityAvailable.value = true;
  } catch {
    if (!stillOpen()) return;
    identityAvailable.value = false;
    if (selectedMode.value === "this-person") {
      selectedMode.value = "follow-subject";
      saveBatchCropMode("follow-subject");
      clearReferences();
    }
  } finally {
    if (stillOpen()) identityLoading.value = false;
  }
}

function selectMode(mode: BatchCropMode) {
  const option = modeOptions.value.find((item) => item.value === mode);
  if (option?.needsDetection && !detectionSupported) return;
  selectedMode.value = mode;
  saveBatchCropMode(mode);
  selectedIndex.value = null;
  if (mode === "this-person") {
    seedAutoReferences();
  } else {
    clearReferences();
  }
  void preloadForMode(mode);
}

watch(
  [() => props.show, () => props.imageIndices],
  ([newShow, newIndices]) => {
    if (newShow && newIndices.length > 0) {
      thumbnailUrls.value.forEach((url) => URL.revokeObjectURL(url));
      thumbnailUrls.value = newIndices.map((index) =>
        URL.createObjectURL(props.photos[index].original)
      );
      selectedIndex.value = null;
      identityWorkerPool.resetLoadFailure();
      identityAvailable.value = identitySupportedByBrowser;
      if (selectedMode.value === "this-person") {
        seedAutoReferences();
      } else {
        clearReferences();
      }
      if (selectedMode.value !== "same-box") {
        void preloadForMode(selectedMode.value);
      }
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  thumbnailUrls.value.forEach((url) => URL.revokeObjectURL(url));
});

watch(
  () => props.show,
  (newShow) => {
    if (!newShow) {
      thumbnailUrls.value.forEach((url) => URL.revokeObjectURL(url));
      thumbnailUrls.value = [];
      selectedIndex.value = null;
      clearReferences();
    }
  }
);

const selectImage = (index: number) => {
  if (!isThisPersonMode.value) {
    selectedIndex.value = index;
    return;
  }

  const existing = referenceEntries.value.findIndex(
    (entry) => entry.photoIndex === index
  );
  if (existing >= 0) {
    referenceEntries.value = referenceEntries.value.filter(
      (_, i) => i !== existing
    );
    return;
  }
  if (referenceEntries.value.length >= maxRefs) {
    referenceEntries.value = [
      ...referenceEntries.value.slice(1),
      { photoIndex: index, origin: "manual" },
    ];
    return;
  }
  referenceEntries.value = [
    ...referenceEntries.value,
    { photoIndex: index, origin: "manual" },
  ];
};

const removeReference = (photoIndex: number) => {
  referenceEntries.value = referenceEntries.value.filter(
    (entry) => entry.photoIndex !== photoIndex
  );
};

const confirmSelection = () => {
  saveBatchCropMode(selectedMode.value);
  if (isThisPersonMode.value) {
    if (referenceEntries.value.length < 1) return;
    const referencePhotoIndices = referenceEntries.value.map(
      (entry) => entry.photoIndex
    );
    emit("select", {
      mode: selectedMode.value,
      templateIndex: referencePhotoIndices[0],
      referencePhotoIndices,
    });
    return;
  }
  if (selectedIndex.value !== null) {
    emit("select", {
      mode: selectedMode.value,
      templateIndex: selectedIndex.value,
    });
  }
};

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
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
    env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
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
  gap: 20px;
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

.mode-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mode-btn {
  padding: 8px 14px;
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--surface-border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 600;
}

.mode-btn--active {
  background: rgba(255, 255, 255, 0.16);
  color: var(--text-primary);
  border-color: #aaa;
}

.mode-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mode-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.mode-hint--legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 0.75rem;
}

.legend::before {
  content: "";
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 2px solid currentColor;
}

.legend--auto {
  color: #fff;
}

.legend--manual {
  color: #f5d76e;
}

.ref-strip {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  overflow-x: auto;
  padding: 4px 2px 8px;
  min-height: 72px;
  scrollbar-width: thin;
  border-bottom: 1px solid var(--surface-border);
}

.ref-strip__item {
  position: relative;
  flex: 0 0 auto;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
}

.ref-strip__item--auto {
  border-color: #fff;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35);
}

.ref-strip__item--manual {
  border-color: #f5d76e;
  box-shadow: 0 0 0 1px rgba(245, 215, 110, 0.45);
}

.ref-strip__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ref-strip__remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ref-strip__empty {
  margin: 0;
  align-self: center;
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: nowrap;
  padding: 0 4px;
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
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.thumbnail-item.selected--auto .thumbnail-wrapper {
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3);
}

.thumbnail-item.selected--manual .thumbnail-wrapper {
  border-color: #f5d76e;
  box-shadow: 0 0 0 2px rgba(245, 215, 110, 0.35);
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
  font-size: 18px;
}

.selected-overlay--auto {
  color: #fff;
}

.selected-overlay--manual {
  color: #f5d76e;
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
