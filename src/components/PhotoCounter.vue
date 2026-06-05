<template>
  <div
    v-if="embedded"
    class="photo-counter embedded"
    :class="{ 'fade-out': isFading, 'is-active': showNotification, header }"
  >
    <div class="counter-content">
      <div class="counter-text">
        <div class="counter-value-wrapper">
          <i class="fas fa-images counter-icon"></i>
          <span class="counter-value">Added {{ displayedCount }}</span>
        </div>
      </div>
    </div>
  </div>
  <div
    v-else-if="showNotification"
    class="photo-counter"
    :class="{ 'fade-out': isFading }"
  >
    <div class="counter-content">
      <div class="counter-text">
        <div class="counter-value-wrapper">
          <i class="fas fa-images counter-icon"></i>
          <span class="counter-value">Added {{ displayedCount }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";

const emit = defineEmits<{
  (e: "visibility-change", visible: boolean): void;
}>();

interface Props {
  photoCount: number;
  newPhotosCount?: number;
  embedded?: boolean;
  header?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  newPhotosCount: 0,
  embedded: false,
  header: false,
});

const DISPLAY_DURATION_MS = 6500;
const FADE_DURATION_MS = 500;

const showNotification = ref(false);
const displayedCount = ref(0);
const isFading = ref(false);
let notificationTimer: ReturnType<typeof setTimeout> | null = null;

const clearTimers = () => {
  if (notificationTimer) {
    clearTimeout(notificationTimer);
    notificationTimer = null;
  }
};

const showNewPhotosNotification = (count: number) => {
  if (count <= 0) return;

  clearTimers();
  displayedCount.value = count;
  showNotification.value = true;
  isFading.value = false;

  notificationTimer = setTimeout(() => {
    isFading.value = true;
    notificationTimer = setTimeout(() => {
      showNotification.value = false;
      isFading.value = false;
      displayedCount.value = 0;
    }, FADE_DURATION_MS);
  }, DISPLAY_DURATION_MS);
};

watch(
  () => props.newPhotosCount,
  (newCount, oldCount) => {
    if (newCount > 0 && newCount > oldCount) {
      showNewPhotosNotification(newCount);
    }
  },
);

watch(
  showNotification,
  (visible) => {
    emit("visibility-change", visible);
  },
  { immediate: true },
);

onUnmounted(() => {
  clearTimers();
});
</script>

<style scoped>
.photo-counter {
  position: relative;
  background: transparent;
  padding: 0;
  z-index: 1;
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.5s ease-out;
}

.photo-counter.embedded {
  width: 100%;
  height: 100%;
  opacity: 0;
  visibility: hidden;
}

.photo-counter.embedded.is-active {
  opacity: 1;
  visibility: visible;
}

.photo-counter.embedded.header {
  height: auto;
  transition: opacity 0.2s ease, visibility 0.2s ease;
}

.photo-counter.embedded.header .counter-value,
.photo-counter.embedded.header .counter-icon {
  line-height: 1.3;
}

.photo-counter.fade-out {
  opacity: 0;
}

.counter-content {
  display: flex;
  align-items: center;
  height: 100%;
}

.counter-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.counter-value-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.photo-counter.embedded .counter-value-wrapper {
  gap: 4px;
}

.counter-icon {
  font-size: 0.9rem;
  background: linear-gradient(135deg, #d4af37 0%, #ffffff 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  display: inline-flex;
  align-items: center;
  line-height: 1;
  flex-shrink: 0;
}

.photo-counter.embedded .counter-icon {
  font-size: 0.7rem;
}

.counter-value {
  font-size: 0.9rem;
  font-weight: 700;
  background: linear-gradient(135deg, #d4af37 0%, #ffffff 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1;
  font-family: "SF Pro Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.photo-counter.embedded .counter-value {
  font-size: 0.7rem;
}
</style>
