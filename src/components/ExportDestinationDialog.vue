<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="export-dest-backdrop"
      @click="$emit('cancel')"
    >
      <div
        class="export-dest-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="messageId"
        @click.stop
      >
        <header class="export-dest-dialog__header">
          <div class="export-dest-dialog__icon">
            <i class="fas fa-file-export" aria-hidden="true"></i>
          </div>
          <h2 :id="titleId" class="export-dest-dialog__title">{{ title }}</h2>
        </header>

        <p :id="messageId" class="export-dest-dialog__message">{{ message }}</p>
        <p v-if="detail" class="export-dest-dialog__detail">{{ detail }}</p>

        <label class="export-dest-dialog__remember">
          <input
            type="checkbox"
            :checked="remember"
            @change="$emit('update:remember', ($event.target as HTMLInputElement).checked)"
          />
          <span>Remember this choice for this session</span>
        </label>

        <footer class="export-dest-dialog__actions">
          <button
            type="button"
            class="export-dest-dialog__btn export-dest-dialog__btn--cancel"
            @click="$emit('cancel')"
          >
            Cancel
          </button>
          <button
            ref="copyBtnRef"
            type="button"
            class="export-dest-dialog__btn export-dest-dialog__btn--secondary"
            @click="$emit('choose', 'copy')"
          >
            Make copies
          </button>
          <button
            type="button"
            class="export-dest-dialog__btn export-dest-dialog__btn--primary"
            @click="$emit('choose', 'replace')"
          >
            Replace originals
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch, onUnmounted } from 'vue';
import type { ExportDestinationChoice } from '../types/export';

const props = defineProps<{
  show: boolean;
  title: string;
  message: string;
  detail?: string;
  remember: boolean;
}>();

const emit = defineEmits<{
  (e: 'choose', destination: ExportDestinationChoice): void;
  (e: 'cancel'): void;
  (e: 'update:remember', value: boolean): void;
}>();

const titleId = 'export-dest-title';
const messageId = 'export-dest-message';
const copyBtnRef = ref<HTMLButtonElement | null>(null);

function onKeydown(event: KeyboardEvent) {
  if (!props.show) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
  }
}

watch(
  () => props.show,
  async (isOpen) => {
    if (isOpen) {
      window.addEventListener('keydown', onKeydown);
      await nextTick();
      copyBtnRef.value?.focus();
    } else {
      window.removeEventListener('keydown', onKeydown);
    }
  }
);

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.export-dest-backdrop {
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
  animation: export-dest-fade-in 0.18s ease-out;
}

.export-dest-dialog {
  width: min(560px, calc(100vw - 24px));
  padding: 22px 22px 18px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 20, 0.98);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
  animation: export-dest-rise 0.2s ease-out;
}

.export-dest-dialog__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.export-dest-dialog__icon {
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

.export-dest-dialog__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.3;
}

.export-dest-dialog__message,
.export-dest-dialog__detail {
  margin: 0 0 12px;
  font-size: 0.9rem;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.65);
}

.export-dest-dialog__detail {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.82rem;
}

.export-dest-dialog__remember {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 18px;
  font-size: 0.82rem;
  color: rgba(255, 255, 255, 0.75);
  cursor: pointer;
}

.export-dest-dialog__remember input {
  width: 15px;
  height: 15px;
  cursor: pointer;
}

.export-dest-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.export-dest-dialog__btn {
  min-height: 40px;
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.export-dest-dialog__btn--cancel {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.85);
}

.export-dest-dialog__btn--cancel:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.25);
}

.export-dest-dialog__btn--secondary {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.92);
}

.export-dest-dialog__btn--secondary:hover {
  background: rgba(255, 255, 255, 0.14);
}

.export-dest-dialog__btn--primary {
  background: rgba(212, 175, 55, 0.22);
  border: 1px solid rgba(212, 175, 55, 0.45);
  color: #e8c96a;
}

.export-dest-dialog__btn--primary:hover {
  background: rgba(212, 175, 55, 0.32);
  border-color: rgba(212, 175, 55, 0.6);
}

@keyframes export-dest-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes export-dest-rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 599px) {
  .export-dest-dialog {
    padding: 18px 16px 14px;
  }

  .export-dest-dialog__actions {
    flex-direction: column-reverse;
  }

  .export-dest-dialog__btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
