<template>
  <div
    v-if="showNotification"
    class="deleted-counter"
    :class="{ 'rise-and-fade': isAnimating }"
  >
    <div class="counter-content">
      <div class="counter-text">
        <div class="counter-value-wrapper">
          <i class="fas fa-images counter-icon"></i>
          <span class="counter-value">-{{ displayedCount }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";

interface Props {
  deletedPhotosCount?: number;
}

const props = withDefaults(defineProps<Props>(), {
  deletedPhotosCount: 0,
});

const showNotification = ref(false);
const displayedCount = ref(0);
const isAnimating = ref(false);
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
  isAnimating.value = false;

  // Trigger animation on next tick
  setTimeout(() => {
    isAnimating.value = true;
  }, 10);

  // Hide after animation completes (2 seconds)
  notificationTimer = setTimeout(() => {
    showNotification.value = false;
    isAnimating.value = false;
    displayedCount.value = 0;
  }, 2000);
};

watch(
  () => props.deletedPhotosCount,
  (newCount, oldCount) => {
    if (newCount > 0 && newCount !== oldCount) {
      showDeletedNotification(newCount);
    }
  }
);

onUnmounted(() => {
  clearTimers();
});
</script>

<style scoped>
.deleted-counter {
  position: fixed;
  left: 9%;
  top: 33%;
  background: transparent;
  padding: 0;
  z-index: 1001;
  pointer-events: none;
}

.deleted-counter.rise-and-fade {
  animation: riseAndFade 2s ease-out forwards;
}

@keyframes riseAndFade {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-100px);
  }
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
  background: linear-gradient(135deg, #708090 0%, #ffffff 90%);
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
  background: linear-gradient(135deg, #708090 0%, #ffffff 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1;
  font-family: "SF Pro Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
}
</style>

