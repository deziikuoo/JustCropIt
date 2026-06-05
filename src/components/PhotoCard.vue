<template>
  <div
    class="photo-card-wrapper"
    :style="{
      width: '100%',
      height: '100%',
      '--item-size': itemSize,
    }"
  >
    <div
      :ref="(el) => registerCardRef(el as HTMLElement | null)"
      class="photo-card"
      :data-photo-index="realIndex"
      :tabindex="dragSelecting ? -1 : 0"
      :class="{
        selected,
        'select-mode': selectMode,
        'dragging-over': draggingOver,
        'photo-card--entrance': showEntranceAnimation,
        'photo-card--no-transition': !allowTransition,
      }"
      :style="
        showEntranceAnimation
          ? { '--entrance-delay': `${entranceDelayMs}ms` }
          : undefined
      "
      @click="$emit('click', $event)"
      @mousedown="$emit('mousedown', $event)"
      @mouseup="$emit('mouseup', $event)"
      @mouseleave="$emit('mouseleave', $event)"
      @touchstart="$emit('touchstart', $event)"
    >
      <input
        type="checkbox"
        class="photo-checkbox"
        :checked="selected"
        @change="$emit('toggle-select', ($event.target as HTMLInputElement).checked)"
        @click.stop
      />
      <div class="image-container">
        <img
          v-if="displayUrl"
          :src="displayUrl"
          alt="Uploaded photo"
          draggable="false"
          @dragstart.prevent
          @error="$emit('image-error')"
        />
        <div
          v-else-if="isLoading"
          class="image-placeholder image-placeholder--loading"
        ></div>
        <div
          v-else-if="placeholderPreviewUrl"
          class="image-placeholder image-placeholder--thumbhash"
        >
          <img
            :src="placeholderPreviewUrl"
            alt=""
            class="image-placeholder__preview"
            draggable="false"
            @dragstart.prevent
          />
        </div>
        <div v-else class="image-placeholder"></div>
      </div>
      <div class="actions">
        <button
          class="Flip H"
          @click="$emit('flip', 'horizontal')"
          title="Flip Horizontally"
        >
          <i class="fas fa-arrows-left-right"></i>
        </button>
        <button
          class="Flip V"
          @click="$emit('flip', 'vertical')"
          title="Flip Vertically"
        >
          <i class="fas fa-arrows-up-down"></i>
        </button>
        <button class="Crop" @click="$emit('crop')" title="Crop">
          <i class="fas fa-crop"></i>
        </button>
        <button
          class="CopySettings"
          @click="$emit('copy-settings')"
          title="Copy Settings"
        >
          <i class="fas fa-copy"></i>
        </button>
        <button
          class="PasteSettings"
          :disabled="!hasCopiedSettings"
          @click="$emit('paste-settings')"
          title="Paste Settings"
        >
          <i class="fas fa-paste"></i>
        </button>
        <button class="Revert" @click="$emit('revert')" title="Revert">
          <i class="fas fa-undo"></i>
        </button>
      </div>
      <div class="actions-bottom">
        <button class="Download" @click="$emit('download')" title="Download">
          <i class="fas fa-download"></i>
        </button>
        <button class="Delete" @click="$emit('delete')" title="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Photo } from '../types/photo';

defineProps<{
  photo: Photo;
  realIndex: number;
  displayUrl: string | null;
  isLoading: boolean;
  placeholderPreviewUrl: string | null;
  selected: boolean;
  selectMode: boolean;
  hasCopiedSettings: boolean;
  draggingOver: boolean;
  showEntranceAnimation: boolean;
  entranceDelayMs: number;
  allowTransition: boolean;
  dragSelecting: boolean;
  itemSize: string;
  registerCardRef: (el: HTMLElement | null) => void;
}>();

defineEmits<{
  (e: 'flip', direction: 'horizontal' | 'vertical'): void;
  (e: 'crop'): void;
  (e: 'download'): void;
  (e: 'revert'): void;
  (e: 'delete'): void;
  (e: 'copy-settings'): void;
  (e: 'paste-settings'): void;
  (e: 'toggle-select', checked: boolean): void;
  (e: 'image-error'): void;
  (e: 'click', event: MouseEvent): void;
  (e: 'mousedown', event: MouseEvent): void;
  (e: 'mouseup', event: MouseEvent): void;
  (e: 'mouseleave', event: MouseEvent): void;
  (e: 'touchstart', event: TouchEvent): void;
}>();
</script>

<style scoped>
.photo-card-wrapper {
  content-visibility: auto;
  contain-intrinsic-size: var(--item-size) var(--item-size);
}

.photo-card {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--border-radius);
  border: 1px solid var(--surface-border);
  background: var(--surface-color);
  overflow: hidden;
  transition: all var(--transition-normal);
  box-shadow: var(--shadow-sm);
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  outline: none;
}

.photo-card--no-transition {
  transition: none !important;
}

.photo-card--entrance {
  animation: cardEntrance 0.45s ease-out both;
  animation-delay: var(--entrance-delay, 0ms);
}

@keyframes cardEntrance {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.photo-card.select-mode {
  cursor: grab;
}

.photo-card.select-mode:active {
  cursor: grabbing;
}

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

.photo-card.selected .photo-checkbox,
.photo-card.selected .actions,
.photo-card.selected .actions-bottom,
.photo-card:focus-within .actions,
.photo-card:focus-within .actions-bottom {
  opacity: 1;
}

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

@media (max-width: 768px) {
  .photo-card.select-mode .photo-checkbox {
    opacity: 1;
  }

  .photo-checkbox {
    width: 24px;
    height: 24px;
    top: 8px;
    right: 8px;
  }
}

@media (max-width: 480px) {
  .photo-checkbox {
    width: 48px;
    height: 48px;
    min-width: 48px;
    min-height: 48px;
    top: 4px;
    right: 4px;
  }
}

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

.image-container img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: var(--border-radius-sm);
  transition:
    opacity var(--transition-normal),
    transform var(--transition-normal);
}

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

.image-placeholder--loading::before {
  animation: shimmer 1.2s infinite;
}

.image-placeholder--thumbhash {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
}

.image-placeholder--thumbhash::before {
  display: none;
}

.image-placeholder__preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--border-radius-sm);
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%) translateY(-100%) rotate(45deg);
  }
  100% {
    transform: translateX(100%) translateY(100%) rotate(45deg);
  }
}

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

@media (max-width: 768px) {
  .actions {
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

@media (max-width: 768px) {
  .actions-bottom {
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
</style>
