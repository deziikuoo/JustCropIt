<template>
  <div
    v-if="embedded"
    class="select-counter embedded"
    :class="{ 'is-active': isEmbeddedVisible, 'is-inline': inline }"
    ref="counterRef"
  >
    <div class="counter-content">
      <div class="counter-text">
        <div class="counter-value-wrapper" :class="{ 'select-all': isSelectAll }">
          <div class="icon-wrapper">
            <i class="fas fa-check-square counter-icon"></i>
          </div>
          <span class="counter-value">
            <template v-if="!isSelectAll">
              ({{ displayedCount }}) Sel.
            </template>
            <template v-else>
              All ({{ displayedCount }})
            </template>
          </span>
        </div>
      </div>
    </div>
  </div>
  <div
    v-else-if="showNotification"
    class="select-counter"
    :class="{ 'rise-and-fade': isAnimating }"
    ref="counterRef"
  >
    <canvas
      ref="shimmerCanvasRef"
      class="shimmer-canvas"
      v-if="showShimmer && !embedded"
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
            <i class="fas fa-check-square counter-icon"></i>
          </div>
          <span class="counter-value">
            <template v-if="!isSelectAll">
              {{ embedded ? `(${displayedCount}) Sel.` : `(${displayedCount}) Selected` }}
            </template>
            <template v-else>
              {{
                embedded
                  ? `All (${displayedCount})`
                  : `All (${displayedCount}) Selected`
              }}
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
  embedded?: boolean;
  inline?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  embedded: false,
  inline: false,
});

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

const isEmbeddedVisible = computed(() => {
  if (!showNotification.value) return false;
  // Always show when there is a selection (including partial + select-all)
  return props.selectedCount > 0 || displayedCount.value > 0;
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
  z-index: 1;
  pointer-events: none;
  overflow: visible;
}

.select-counter.embedded {
  width: 100%;
  height: 100%;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0.2s ease;
}

.select-counter.embedded.is-inline {
  width: auto;
  height: auto;
  flex-shrink: 0;
  margin-left: auto;
}

.select-counter.embedded.is-active {
  opacity: 1;
  visibility: visible;
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
  height: 100%;
  min-width: 0;
}

.counter-text {
  display: flex;
  flex-direction: column;
}

.counter-value-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.select-counter.embedded .counter-value-wrapper {
  gap: 4px;
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

.select-counter.embedded .counter-icon {
  font-size: 0.7rem;
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

.select-counter.embedded .counter-value {
  font-size: 0.65rem;
}

.counter-value {
  font-size: 0.9rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  background: linear-gradient(135deg, #ffffff 0%, #ffd700 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1;
  font-family: "SF Pro Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  white-space: nowrap;
}

.counter-value-wrapper.select-all .counter-value {
  font-size: 1rem;
}

.select-counter.embedded .counter-value-wrapper.select-all .counter-value {
  font-size: 0.65rem;
}
</style>

