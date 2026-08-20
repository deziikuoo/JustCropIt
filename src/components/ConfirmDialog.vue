<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="confirm-backdrop"
      @click="$emit('cancel')"
    >
      <div
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="messageId"
        @click.stop
      >
        <header class="confirm-dialog__header">
          <div class="confirm-dialog__icon" :class="`confirm-dialog__icon--${variant}`">
            <i :class="iconClass" aria-hidden="true"></i>
          </div>
          <h2 :id="titleId" class="confirm-dialog__title">{{ title }}</h2>
        </header>

        <p :id="messageId" class="confirm-dialog__message">{{ message }}</p>

        <footer class="confirm-dialog__actions">
          <button
            ref="cancelBtnRef"
            type="button"
            class="confirm-dialog__btn confirm-dialog__btn--cancel"
            @click="$emit('cancel')"
          >
            {{ cancelLabel }}
          </button>
          <button
            ref="confirmBtnRef"
            type="button"
            class="confirm-dialog__btn"
            :class="variant === 'danger'
              ? 'confirm-dialog__btn--danger'
              : 'confirm-dialog__btn--primary'"
            @click="$emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch, onUnmounted } from 'vue';

const props = withDefaults(
  defineProps<{
    show: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'default';
  }>(),
  {
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    variant: 'default',
  }
);

const emit = defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

const titleId = 'confirm-dialog-title';
const messageId = 'confirm-dialog-message';
const confirmBtnRef = ref<HTMLButtonElement | null>(null);
const cancelBtnRef = ref<HTMLButtonElement | null>(null);

const iconClass = computed(() =>
  props.variant === 'danger' ? 'fas fa-trash' : 'fas fa-exclamation-triangle'
);

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
      // Prefer Cancel for destructive confirms so Enter doesn't wipe data by accident.
      const focusTarget =
        props.variant === 'danger' ? cancelBtnRef.value : confirmBtnRef.value;
      focusTarget?.focus();
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
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 260;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  animation: confirm-fade-in 0.18s ease-out;
}

.confirm-dialog {
  width: min(100%, 420px);
  padding: 22px 22px 18px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 20, 0.98);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
  animation: confirm-rise 0.2s ease-out;
}

.confirm-dialog__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.confirm-dialog__icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 0.95rem;
}

.confirm-dialog__icon--danger {
  background: rgba(239, 68, 68, 0.18);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #f87171;
}

.confirm-dialog__icon--default {
  background: rgba(212, 175, 55, 0.16);
  border: 1px solid rgba(212, 175, 55, 0.4);
  color: #e8c96a;
}

.confirm-dialog__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.3;
}

.confirm-dialog__message {
  margin: 0 0 20px;
  font-size: 0.9rem;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.65);
}

.confirm-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.confirm-dialog__btn {
  min-height: 40px;
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
}

.confirm-dialog__btn--cancel {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.85);
}

.confirm-dialog__btn--cancel:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.25);
}

.confirm-dialog__btn--primary {
  background: rgba(212, 175, 55, 0.22);
  border: 1px solid rgba(212, 175, 55, 0.45);
  color: #e8c96a;
}

.confirm-dialog__btn--primary:hover {
  background: rgba(212, 175, 55, 0.32);
  border-color: rgba(212, 175, 55, 0.6);
}

.confirm-dialog__btn--danger {
  background: rgba(239, 68, 68, 0.22);
  border: 1px solid rgba(239, 68, 68, 0.5);
  color: #fca5a5;
}

.confirm-dialog__btn--danger:hover {
  background: rgba(239, 68, 68, 0.32);
  border-color: rgba(239, 68, 68, 0.65);
}

@keyframes confirm-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes confirm-rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 480px) {
  .confirm-dialog {
    padding: 18px 16px 14px;
  }

  .confirm-dialog__actions {
    flex-direction: column-reverse;
  }

  .confirm-dialog__btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
