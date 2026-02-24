<template>
  <div
    v-if="showNotification"
    class="select-counter"
    :class="{ 'rise-and-fade': isAnimating }"
    ref="counterRef"
  >
    <canvas
      ref="shimmerCanvasRef"
      class="shimmer-canvas"
      v-if="showShimmer"
      :style="{
        width: shimmerCanvasWidth + 'px',
        height: shimmerCanvasHeight + 'px',
        left: shimmerCanvasLeft + 'px',
        top: shimmerCanvasTop + 'px',
      }"
    ></canvas>
    <div class="counter-content">
      <div class="counter-text">
        <div class="counter-value-wrapper" :class="{ 'select-all': isSelectAll }">
          <div class="icon-wrapper">
            <i
              v-if="!isSelectAll"
              class="fas fa-check-square counter-icon"
            ></i>
            <div v-else class="select-all-icon">
              <i class="fas fa-check-square counter-icon"></i>
              <i class="fas fa-exclamation exclamation-icon"></i>
            </div>
          </div>
          <span class="counter-value">
            <template v-if="!isSelectAll">
              ({{ displayedCount }}) Selected
            </template>
            <template v-else>
              All ({{ displayedCount }}) Selected!
            </template>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from "vue";

interface Props {
  selectedCount: number;
  totalPhotos: number;
}

const props = defineProps<Props>();

interface ShimmerParticle {
  x: number;
  y: number;
  velocityY: number;
  size: number;
  opacity: number;
  color: string;
  side: "left" | "right";
}

const showNotification = ref(false);
const displayedCount = ref(0);
const displayedIsSelectAll = ref(false); // Preserve select-all state during animations
const isAnimating = ref(false);
const showShimmer = ref(false);
let notificationTimer: ReturnType<typeof setTimeout> | null = null;
let delayTimer: ReturnType<typeof setTimeout> | null = null;
const counterRef = ref<HTMLElement | null>(null);
const shimmerCanvasRef = ref<HTMLCanvasElement | null>(null);
const shimmerCanvasWidth = ref(0);
const shimmerCanvasHeight = ref(0);
const shimmerCanvasLeft = ref(0);
const shimmerCanvasTop = ref(0);

const isSelectAll = computed(() => {
  // Use preserved state if notification is showing, otherwise compute from props
  if (showNotification.value) {
    return displayedIsSelectAll.value;
  }
  return props.selectedCount === props.totalPhotos && props.totalPhotos > 0;
});

const SHIMMER_COLORS = ["#ffd700", "#d4af37", "#fff9e6"];
let shimmerParticles: ShimmerParticle[] = [];
let shimmerAnimationId: number | null = null;
let shimmerStartTime: number = 0;
const SHIMMER_DURATION = 800; // 0.8 seconds

const clearTimers = () => {
  if (notificationTimer) {
    clearTimeout(notificationTimer);
    notificationTimer = null;
  }
  if (delayTimer) {
    clearTimeout(delayTimer);
    delayTimer = null;
  }
};

const createShimmerParticles = () => {
  if (!counterRef.value || !shimmerCanvasRef.value) return;

  const rect = counterRef.value.getBoundingClientRect();
  const canvas = shimmerCanvasRef.value;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Set canvas size to cover counter area plus plenty of space for particles to escape
  const horizontalPadding = 100; // More space on sides
  const verticalPadding = 200; // More space above for upward movement
  const canvasWidth = rect.width + horizontalPadding * 2;
  const canvasHeight = rect.height + verticalPadding;
  
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  
  // Store dimensions and position for style binding
  shimmerCanvasWidth.value = canvasWidth;
  shimmerCanvasHeight.value = canvasHeight;
  shimmerCanvasLeft.value = -horizontalPadding;
  shimmerCanvasTop.value = -verticalPadding / 2;

  shimmerParticles = [];
  // More particles for select all, more visible
  const particlesPerSide = isSelectAll.value ? 15 : 10;
  const textCenterY = canvas.height / 2;
  const leftEdge = horizontalPadding;
  const rightEdge = canvas.width - horizontalPadding;

  // Create particles on left side
  for (let i = 0; i < particlesPerSide; i++) {
    shimmerParticles.push({
      x: leftEdge + (Math.random() - 0.5) * 30,
      y: textCenterY + (Math.random() - 0.5) * 40,
      velocityY: -(80 + Math.random() * 120), // Faster upward, 80-200px/s
      size: isSelectAll.value ? (2 + Math.random() * 3) : (1 + Math.random() * 2), // Larger for select all: 2-5px vs 1-3px
      opacity: isSelectAll.value ? (0.8 + Math.random() * 0.2) : (0.6 + Math.random() * 0.4), // More opaque for select all
      color: SHIMMER_COLORS[Math.floor(Math.random() * SHIMMER_COLORS.length)],
      side: "left",
    });
  }

  // Create particles on right side
  for (let i = 0; i < particlesPerSide; i++) {
    shimmerParticles.push({
      x: rightEdge + (Math.random() - 0.5) * 30,
      y: textCenterY + (Math.random() - 0.5) * 40,
      velocityY: -(80 + Math.random() * 120), // Faster upward
      size: isSelectAll.value ? (2 + Math.random() * 3) : (1 + Math.random() * 2),
      opacity: isSelectAll.value ? (0.8 + Math.random() * 0.2) : (0.6 + Math.random() * 0.4),
      color: SHIMMER_COLORS[Math.floor(Math.random() * SHIMMER_COLORS.length)],
      side: "right",
    });
  }

  shimmerStartTime = Date.now();
  animateShimmer();
};

let lastFrameTime = 0;

const animateShimmer = (currentTime?: number) => {
  const canvas = shimmerCanvasRef.value;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (!currentTime) currentTime = Date.now();
  const elapsed = currentTime - shimmerStartTime;
  const progress = Math.min(elapsed / SHIMMER_DURATION, 1);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Calculate delta time for smooth animation
  const deltaTime = currentTime - (lastFrameTime || shimmerStartTime);
  lastFrameTime = currentTime;
  const deltaSeconds = deltaTime / 1000;

  // Update and draw particles
  for (let i = shimmerParticles.length - 1; i >= 0; i--) {
    const particle = shimmerParticles[i];
    
    // Update position based on velocity and delta time
    particle.y += particle.velocityY * deltaSeconds;
    
    // Fade out over time
    const fadeProgress = progress;
    const currentOpacity = particle.opacity * (1 - fadeProgress);

    if (currentOpacity > 0.01 && particle.y > -50) {
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fillStyle = particle.color;
      ctx.globalAlpha = currentOpacity;
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;

  if (progress < 1) {
    shimmerAnimationId = requestAnimationFrame(animateShimmer);
  } else {
    // Animation complete
    showShimmer.value = false;
    shimmerParticles = [];
    lastFrameTime = 0;
    if (shimmerAnimationId) {
      cancelAnimationFrame(shimmerAnimationId);
      shimmerAnimationId = null;
    }
  }
};

const showSelectNotification = (count: number) => {
  if (count <= 0) {
    showNotification.value = false;
    return;
  }

  clearTimers();
  displayedCount.value = count;
  displayedIsSelectAll.value = props.selectedCount === props.totalPhotos && props.totalPhotos > 0;
  showNotification.value = true;
  isAnimating.value = false;

  // No animations for individual or select-all modes - notification stays visible
};

watch(
  () => props.selectedCount,
  (newCount, oldCount) => {
    if (newCount > 0) {
      showSelectNotification(newCount);
    } else if (oldCount > 0 && newCount === 0) {
      // Hide immediately when count goes to 0
      showNotification.value = false;
      isAnimating.value = false;
      displayedCount.value = 0;
      displayedIsSelectAll.value = false;
      showShimmer.value = false;
      clearTimers();
    }
  }
);

defineExpose({ createShimmerParticles });

onUnmounted(() => {
  clearTimers();
  if (shimmerAnimationId) {
    cancelAnimationFrame(shimmerAnimationId);
  }
});
</script>

<style scoped>
.select-counter {
  position: relative;
  background: transparent;
  padding: 0;
  z-index: 1001;
  pointer-events: none;
  overflow: visible;
}

.select-counter.rise-and-fade {
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

.shimmer-canvas {
  position: absolute;
  pointer-events: none;
  z-index: 1;
  overflow: visible;
}

.counter-content {
  display: flex;
  align-items: center;
  position: relative;
  z-index: 2;
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

.counter-value-wrapper:not(.select-all) {
  transform: none;
  transform-origin: center;
}

.icon-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.select-all-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.exclamation-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 0.4rem;
  color: #ffffff;
  z-index: 1;
  font-weight: 900;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
}

.counter-icon {
  font-size: 0.9rem;
  background: linear-gradient(135deg, #ffffff 0%, #ffd700 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

.counter-value-wrapper.select-all .counter-icon {
  background: linear-gradient(135deg, #ffffff 0%, #ffd700 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.counter-value {
  font-size: 0.9rem;
  font-weight: 700;
  background: linear-gradient(135deg, #ffffff 0%, #ffd700 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1;
  font-family: "SF Pro Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  white-space: nowrap;
}

.counter-value-wrapper.select-all .counter-value {
  background: linear-gradient(135deg, #ffffff 0%, #ffd700 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: 1rem;
}

.counter-value-wrapper.select-all {
  transform: none;
  transform-origin: center;
}

.counter-value-wrapper.select-all .counter-value {
  font-size: 1rem;
}
</style>

