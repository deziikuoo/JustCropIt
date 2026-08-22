<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="consent-backdrop"
      @click="$emit('cancel')"
    >
      <div
        class="consent-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="messageId"
        @click.stop
      >
        <header class="consent-dialog__header">
          <div class="consent-dialog__icon">
            <i class="fas fa-download" aria-hidden="true"></i>
          </div>
          <h2 :id="titleId" class="consent-dialog__title">
            Download the object finder
          </h2>
        </header>

        <div :id="messageId" class="consent-dialog__body">
          <p>
            The first time you use Crop to object, JustCropIt downloads a model
            (about 150&nbsp;MB) so it can find objects on this device. Nothing is
            uploaded — the file stays in this site’s private browser storage, not
            your Downloads folder, and it is safe to use.
          </p>
          <p>
            Before you leave, you can remove that download, or keep it so the
            feature opens faster next time.
          </p>
        </div>

        <footer class="consent-dialog__actions">
          <button
            ref="cancelBtnRef"
            type="button"
            class="consent-dialog__btn consent-dialog__btn--cancel"
            @click="$emit('cancel')"
          >
            Cancel
          </button>
          <button
            type="button"
            class="consent-dialog__btn consent-dialog__btn--secondary"
            @click="$emit('choose', 'remove-on-leave')"
          >
            Remove when I leave
          </button>
          <button
            ref="keepBtnRef"
            type="button"
            class="consent-dialog__btn consent-dialog__btn--primary"
            @click="$emit('choose', 'keep')"
          >
            Keep for later
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch, onUnmounted } from 'vue';
import type { SamRetention } from '../utils/samModelCache';

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  (e: 'choose', retention: SamRetention): void;
  (e: 'cancel'): void;
}>();

const titleId = 'sam-consent-title';
const messageId = 'sam-consent-message';
const keepBtnRef = ref<HTMLButtonElement | null>(null);
const cancelBtnRef = ref<HTMLButtonElement | null>(null);

function onKeydown(event: KeyboardEvent) {
  if (!props.show) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('cancel');
  }
}

watch(
  () => props.show,
  async (isOpen) => {
    if (isOpen) {
      window.addEventListener('keydown', onKeydown, true);
      await nextTick();
      keepBtnRef.value?.focus();
    } else {
      window.removeEventListener('keydown', onKeydown, true);
    }
  }
);

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true);
});
</script>

<style scoped>
.consent-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.consent-dialog {
  width: min(100%, 460px);
  padding: 22px 22px 18px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 20, 0.98);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
}

.consent-dialog__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.consent-dialog__icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 0.95rem;
  background: rgba(212, 175, 55, 0.16);
  border: 1px solid rgba(212, 175, 55, 0.4);
  color: #e8c96a;
}

.consent-dialog__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.3;
}

.consent-dialog__body {
  margin: 0 0 20px;
  font-size: 0.9rem;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.65);
}

.consent-dialog__body p {
  margin: 0 0 10px;
}

.consent-dialog__body p:last-child {
  margin-bottom: 0;
}

.consent-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.consent-dialog__btn {
  min-height: 40px;
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.consent-dialog__btn--cancel {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.85);
}

.consent-dialog__btn--cancel:hover {
  background: rgba(255, 255, 255, 0.1);
}

.consent-dialog__btn--secondary {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.9);
}

.consent-dialog__btn--secondary:hover {
  background: rgba(255, 255, 255, 0.12);
}

.consent-dialog__btn--primary {
  background: rgba(212, 175, 55, 0.22);
  border: 1px solid rgba(212, 175, 55, 0.45);
  color: #e8c96a;
}

.consent-dialog__btn--primary:hover {
  background: rgba(212, 175, 55, 0.32);
}

@media (max-width: 480px) {
  .consent-dialog__actions {
    flex-direction: column-reverse;
  }

  .consent-dialog__btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
