<template>
  <div
    v-if="embedded"
    class="deleted-counter embedded"
    :class="{ 'fade-out': isFading, 'is-active': showNotification, header }"
  >
    <div class="counter-content">
      <div class="counter-text">
        <div class="counter-value-wrapper">
          <i class="fas fa-images counter-icon"></i>
          <span class="counter-value">Deleted {{ displayedCount }}</span>
        </div>
      </div>
    </div>
  </div>
  <div
    v-else-if="showNotification"
    class="deleted-counter"
    :class="{ 'fade-out': isFading }"
  >
    <div class="counter-content">
      <div class="counter-text">
        <div class="counter-value-wrapper">
          <i class="fas fa-images counter-icon"></i>
          <span class="counter-value">Deleted {{ displayedCount }}</span>
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
  deletedPhotosCount?: number;
  embedded?: boolean;
  header?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  deletedPhotosCount: 0,
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

const showDeletedNotification = (count: number) => {
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
  () => props.deletedPhotosCount,
  (newCount, oldCount) => {
    if (newCount > 0 && newCount > oldCount) {
      showDeletedNotification(newCount);
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
.deleted-counter {
  position: relative;
  background: transparent;
  padding: 0;
  z-index: 1;
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.5s ease-out;
}

.deleted-counter.embedded {
  width: 100%;
  height: 100%;
  opacity: 0;
  visibility: hidden;
}

.deleted-counter.embedded.is-active {
  opacity: 1;
  visibility: visible;
}

.deleted-counter.embedded.header {
  height: auto;
  transition: opacity 0.2s ease, visibility 0.2s ease;
}

.deleted-counter.embedded.header .counter-value,
.deleted-counter.embedded.header .counter-icon {
  line-height: 1.3;
}

.deleted-counter.fade-out {
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

.deleted-counter.embedded .counter-value-wrapper {
  gap: 4px;
}

.counter-icon {
  font-size: 0.9rem;
  background: linear-gradient(135deg, #708090 0%, #ffffff 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  display: inline-flex;
  align-items: center;
  line-height: 1;
  flex-shrink: 0;
}

.deleted-counter.embedded .counter-icon {
  font-size: 0.7rem;
}

.counter-value {
  font-size: 0.9rem;
  font-weight: 700;
  background: linear-gradient(135deg, #708090 0%, #ffffff 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1;
  font-family: "SF Pro Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deleted-counter.embedded .counter-value {
  font-size: 0.7rem;
}
</style>
