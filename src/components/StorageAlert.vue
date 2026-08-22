<template>
  <div v-if="show" class="storage-alert" :class="alertType">
    <div class="alert-content">
      <div class="alert-icon">
        <i :class="iconClass"></i>
      </div>
      <div class="alert-message">
        <strong>{{ title }}</strong>
        <p>{{ message }}</p>
      </div>
      <button class="alert-close" @click="dismiss" aria-label="Close">
        <i class="fas fa-times"></i>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';

interface Props {
  show: boolean;
  type?: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  autoDismiss?: number; // Auto-dismiss after milliseconds
}

const props = withDefaults(defineProps<Props>(), {
  type: 'info',
  autoDismiss: 0,
});

const emit = defineEmits<{
  (e: 'dismiss'): void;
}>();

const show = ref(props.show);

watch(() => props.show, (newValue) => {
  show.value = newValue;
  if (newValue && props.autoDismiss > 0) {
    setTimeout(() => {
      dismiss();
    }, props.autoDismiss);
  }
});

const alertType = computed(() => `alert-${props.type}`);

const iconClass = computed(() => {
  switch (props.type) {
    case 'warning':
      return 'fas fa-exclamation-triangle';
    case 'error':
      return 'fas fa-exclamation-circle';
    default:
      return 'fas fa-info-circle';
  }
});

const dismiss = () => {
  show.value = false;
  emit('dismiss');
};
</script>

<style scoped>
.storage-alert {
  position: fixed;
  top: var(--app-chrome-height);
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  width: min(560px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.alert-content {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 20px;
  border-radius: var(--border-radius);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(12px);
}

.alert-info {
  background: rgba(59, 130, 246, 0.9);
  border: 1px solid rgba(59, 130, 246, 0.5);
  color: white;
}

.alert-warning {
  background: rgba(251, 191, 36, 0.9);
  border: 1px solid rgba(251, 191, 36, 0.5);
  color: #1a1a1a;
}

.alert-error {
  background: rgba(239, 68, 68, 0.9);
  border: 1px solid rgba(239, 68, 68, 0.5);
  color: white;
}

.alert-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.alert-message {
  flex: 1;
}

.alert-message strong {
  display: block;
  font-size: 1rem;
  margin-bottom: 4px;
}

.alert-message p {
  margin: 0;
  font-size: 0.875rem;
  opacity: 0.9;
  line-height: 1.4;
}

.alert-close {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 4px;
  opacity: 0.7;
  transition: opacity 0.2s;
  flex-shrink: 0;
}

.alert-close:hover {
  opacity: 1;
}

@media (max-width: 599px) {
  .alert-content {
    padding: 12px 16px;
    gap: 10px;
  }

  .alert-icon {
    font-size: 1.25rem;
  }

  .alert-message strong {
    font-size: 0.9rem;
  }

  .alert-message p {
    font-size: 0.8rem;
  }

  .alert-close {
    padding: 6px;
  }
}
</style>

