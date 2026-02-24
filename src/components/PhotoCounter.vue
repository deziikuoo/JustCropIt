<template>
  <div
    v-if="showNotification"
    class="photo-counter"
    :class="{ 'fade-out': isFading }"
  >
    <div class="counter-content">
      <div class="counter-text">
        <div class="counter-value-wrapper">
          <i class="fas fa-images counter-icon"></i>
          <span class="counter-value">+{{ displayedCount }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";

interface Props {
  photoCount: number;
  newPhotosCount?: number;
}

const props = withDefaults(defineProps<Props>(), {
  newPhotosCount: 0,
});

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

  // Start fade-out after 3 seconds
  notificationTimer = setTimeout(() => {
    isFading.value = true;
    // Hide after fade animation completes (0.5 seconds)
    notificationTimer = setTimeout(() => {
      showNotification.value = false;
      isFading.value = false;
      displayedCount.value = 0;
    }, 500);
  }, 3000);
};

watch(
  () => props.newPhotosCount,
  (newCount, oldCount) => {
    if (newCount > 0 && newCount !== oldCount) {
      showNewPhotosNotification(newCount);
    }
  }
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
  z-index: 1001;
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.5s ease-out;
}

.photo-counter.fade-out {
  opacity: 0;
}


.counter-content {
  display: flex;
  align-items: center;
}

.counter-text {
  display: flex;
  flex-direction: column;
}

.counter-value-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
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
}
</style>
