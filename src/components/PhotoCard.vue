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
        'identity-miss': identityMiss && selected,
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
          class="photo-card__image"
          :style="imageTransformStyle"
          draggable="false"
          @dragstart.prevent
          @error="$emit('image-error')"
        />
        <div
          v-else-if="placeholderPreviewUrl"
          class="image-placeholder image-placeholder--thumbhash"
        >
          <img
            :src="placeholderPreviewUrl"
            alt=""
            class="image-placeholder__preview"
            :style="imageTransformStyle"
            draggable="false"
            @dragstart.prevent
          />
        </div>
        <div
          v-else-if="isLoading"
          class="image-placeholder image-placeholder--loading"
        ></div>
        <div v-else class="image-placeholder"></div>
      </div>
    </div>
    <div class="action-dropdown" @click.stop @mousedown.stop>
      <div class="action-dropdown__tab" aria-hidden="true">
        <i class="fas fa-chevron-up"></i>
      </div>
      <div class="action-dropdown__menu">
        <button
          class="Flip H"
          type="button"
          @click="$emit('flip', 'horizontal')"
          title="Flip Horizontally"
        >
          <i class="fas fa-arrows-left-right"></i>
        </button>
        <button
          class="Flip V"
          type="button"
          @click="$emit('flip', 'vertical')"
          title="Flip Vertically"
        >
          <i class="fas fa-arrows-up-down"></i>
        </button>
        <button class="Crop" type="button" @click="$emit('crop')" title="Crop">
          <i class="fas fa-crop"></i>
        </button>
        <button
          class="CopySettings"
          type="button"
          @click="$emit('copy-settings')"
          title="Copy Settings"
        >
          <i class="fas fa-copy"></i>
        </button>
        <button
          class="PasteSettings"
          type="button"
          :disabled="!hasCopiedSettings"
          @click="$emit('paste-settings')"
          title="Paste Settings"
        >
          <i class="fas fa-paste"></i>
        </button>
        <button class="Revert" type="button" @click="$emit('revert')" title="Reset">
          <i class="fas fa-undo"></i>
        </button>
        <button class="Download" type="button" @click="$emit('download')" title="Download">
          <i class="fas fa-download"></i>
        </button>
        <button class="Delete" type="button" @click="$emit('delete')" title="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Photo } from '../types/photo';
import {
  getDeferredFlipCssTransform,
  usesDeferredFlips,
} from '../utils/editTransform';

const props = defineProps<{
  photo: Photo;
  realIndex: number;
  displayUrl: string | null;
  isLoading: boolean;
  placeholderPreviewUrl: string | null;
  selected: boolean;
  identityMiss?: boolean;
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

const imageTransformStyle = computed(() => {
  if (!usesDeferredFlips(props.photo)) return undefined;
  const transform = getDeferredFlipCssTransform(props.photo.flips);
  return transform ? { transform } : undefined;
});

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
  position: relative;
  overflow: visible;
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
  .photo-card-wrapper:hover {
    z-index: 5;
  }

  .photo-card-wrapper:hover .photo-card {
    border-color: #ffffff;
    box-shadow:
      0 0 8px rgba(255, 215, 0, 0.15),
      var(--shadow-md);
  }

  .photo-card-wrapper:hover .photo-card.select-mode {
    border-color: #ffffff;
  }

  .photo-card-wrapper:hover .photo-checkbox,
  .photo-card-wrapper:hover .action-dropdown {
    opacity: 1;
    pointer-events: auto;
  }

  .photo-card-wrapper:hover .action-dropdown {
    transform: translateY(0);
  }

  .photo-card-wrapper:hover .image-container img {
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

.photo-card.selected.identity-miss {
  border-color: #fca5a5;
  box-shadow:
    0 0 0 3px rgba(239, 68, 68, 0.35),
    0 0 12px rgba(239, 68, 68, 0.25),
    var(--shadow-md);
}

.photo-card-wrapper:has(.photo-card.selected),
.photo-card-wrapper:has(.photo-card:focus-within) {
  z-index: 4;
}

.photo-card.selected .photo-checkbox {
  opacity: 1;
}

.photo-card-wrapper:has(.photo-card:focus-within) {
  z-index: 4;
}

.photo-card-wrapper:has(.photo-card:focus-within) .action-dropdown {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
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

.photo-card.identity-miss .photo-checkbox:checked {
  background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
  border-color: #fecaca;
  box-shadow:
    0 0 8px rgba(239, 68, 68, 0.45),
    0 0 0 2px rgba(239, 68, 68, 0.25);
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

.action-dropdown {
  position: absolute;
  bottom: calc(100% - 2px);
  top: auto;
  left: 0;
  right: 0;
  width: 100%;
  max-width: 100%;
  z-index: 6;
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  box-sizing: border-box;
  opacity: 0;
  pointer-events: none;
  transform: translateY(6px);
  transition:
    opacity var(--transition-fast),
    transform var(--transition-fast);
}

.action-dropdown__tab {
  width: 42px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px 8px 0 0;
  background: rgba(18, 18, 26, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-bottom: none;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.55rem;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.35);
}

.action-dropdown__tab i {
  transition: transform var(--transition-fast);
}

.photo-card-wrapper:hover .action-dropdown__tab i,
.photo-card-wrapper:has(.photo-card:focus-within) .action-dropdown__tab i {
  transform: rotate(180deg);
}

.action-dropdown__menu {
  display: flex;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 3px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 5px;
  border-radius: 10px 10px 0 0;
  background: rgba(18, 18, 26, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom: none;
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.action-dropdown__menu button {
  flex: 1 1 0;
  min-width: 0;
  min-height: 28px;
  padding: 4px 0;
  font-size: 0.7rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.action-dropdown__menu button:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(212, 175, 55, 0.22) 0%, rgba(212, 175, 55, 0.1) 100%);
  color: #ffd700;
  transform: none;
}

.action-dropdown__menu button.Download:hover:not(:disabled) {
  background: var(--success-color);
  border-color: var(--success-color);
  color: #fff;
}

.action-dropdown__menu button.Delete:hover:not(:disabled) {
  background: var(--danger-color);
  border-color: var(--danger-color);
  color: #fff;
}

@media (max-width: 768px) {
  .action-dropdown__menu {
    gap: 2px;
    padding: 4px;
  }

  .action-dropdown__menu button {
    min-height: 28px;
  }
}

@media (hover: none) {
  .photo-card-wrapper:has(.photo-card.selected) {
    z-index: 4;
  }

  .photo-card-wrapper:has(.photo-card.selected) .action-dropdown {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
}

@media (max-width: 480px) {
  .action-dropdown__menu button {
    min-height: 32px;
    min-width: 0;
    padding: 4px 0;
  }

  .action-dropdown__menu button i {
    font-size: 0.7rem;
  }
}
</style>
