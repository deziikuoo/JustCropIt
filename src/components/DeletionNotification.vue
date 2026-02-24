<template>
  <div
    v-if="isVisible"
    class="deletion-notification"
    ref="notificationRef"
    :class="{ 'fade-out': isFadingOut, 'fade-in': isFadingIn }"
  >
    <canvas ref="canvasRef" class="notification-canvas"></canvas>
    <div class="notification-content">
      <p class="notification-text">
        Photos are automatically deleted after 24 hours
      </p>
    </div>
    <button class="notification-close" @click="handleClose" aria-label="Close">
      <i class="fas fa-times"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

interface Particle {
  x: number;
  y: number;
  size: number;
  opacity: number;
  maxOpacity: number;
  speed: number;
  phase: number;
  vx: number; // Velocity X (movement speed in X direction)
  vy: number; // Velocity Y (movement speed in Y direction)
}

const canvasRef = ref<HTMLCanvasElement | null>(null);
const notificationRef = ref<HTMLElement | null>(null);
let animationId: number | null = null;
let particles: Particle[] = [];
const isVisible = ref(true);
const isFadingOut = ref(false);
const isFadingIn = ref(true); // Track fade-in state
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

// Auto-dismiss after 12 seconds
const DISPLAY_DURATION = 12000;

const PARTICLE_COUNT = 15; // Sparse, premium feel
const PARTICLE_COLOR = "#000000"; // Black particles

const isMobile = () => window.innerWidth <= 768;

const createParticle = (width: number, height: number): Particle => {
  const mobile = isMobile();
  // Random velocity for floating movement - slow and smooth for high-tech vibe
  const baseVelocity = mobile ? 0.08 : 0.12;
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    size: mobile ? 0.5 + Math.random() * 1 : 1 + Math.random() * 2,
    opacity: 0,
    maxOpacity: 0.5 + Math.random() * 0.4, // Increased from 0.3-0.8 to 0.5-0.9 for better visibility
    speed: 0.005 + Math.random() * 0.015, // Opacity pulsing speed
    phase: Math.random() * Math.PI * 2,
    vx: (Math.random() - 0.5) * baseVelocity, // Random X velocity
    vy: (Math.random() - 0.5) * baseVelocity, // Random Y velocity
  };
};

const initParticles = (width: number, height: number) => {
  particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(createParticle(width, height));
  }
};

const updateParticles = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const width = canvas.width;
  const height = canvas.height;

  for (const particle of particles) {
    // Update opacity pulsing
    particle.phase += particle.speed;
    if (particle.phase > Math.PI * 2) {
      particle.phase -= Math.PI * 2;
    }
    particle.opacity =
      ((Math.sin(particle.phase) + 1) / 2) * particle.maxOpacity;

    // Update position based on velocity (floating movement)
    particle.x += particle.vx;
    particle.y += particle.vy;

    // Wrap around edges for continuous floating effect (like particles in a contained space)
    if (particle.x < 0) {
      particle.x = width;
    } else if (particle.x > width) {
      particle.x = 0;
    }

    if (particle.y < 0) {
      particle.y = height;
    } else if (particle.y > height) {
      particle.y = 0;
    }
  }
};

const drawParticles = (ctx: CanvasRenderingContext2D) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (const particle of particles) {
    if (particle.opacity < 0.01) continue;

    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fillStyle = PARTICLE_COLOR;
    ctx.globalAlpha = particle.opacity;
    ctx.fill();
  }

  ctx.globalAlpha = 1;
};

const animate = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  updateParticles();
  drawParticles(ctx);

  animationId = requestAnimationFrame(animate);
};

const handleResize = () => {
  const canvas = canvasRef.value;
  const notification = notificationRef.value;
  if (!canvas || !notification) return;

  const rect = notification.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  initParticles(canvas.width, canvas.height);
};

const handleClose = () => {
  // Cancel auto-dismiss timer if it's running
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  // Start fade out
  isFadingOut.value = true;
  // Hide after fade animation completes
  setTimeout(() => {
    isVisible.value = false;
  }, 300); // Match CSS transition duration
};

const startDismissTimer = () => {
  // Start fade out slightly before hiding
  dismissTimer = setTimeout(() => {
    handleClose();
  }, DISPLAY_DURATION);
};

onMounted(() => {
  const canvas = canvasRef.value;
  const notification = notificationRef.value;
  if (!canvas || !notification) return;

  // Initialize canvas size
  const rect = notification.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  initParticles(canvas.width, canvas.height);
  animate();
  startDismissTimer();

  // Remove fade-in class after animation completes
  setTimeout(() => {
    isFadingIn.value = false;
  }, 300); // Match CSS transition duration

  window.addEventListener("resize", handleResize, { passive: true });
  // Also resize on next tick in case notification size changes
  setTimeout(handleResize, 100);
});

onUnmounted(() => {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
  }
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
  }
  window.removeEventListener("resize", handleResize);
});
</script>

<style scoped>
.deletion-notification {
  position: fixed;
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translateX(-50%);
  padding: 10px;
  background: linear-gradient(
    135deg,
    #708090 0%,
    #8892a0 30%,
    #ffffff 70%,
    #ffffff 100%
  );
  border-radius: var(--border-radius);
  min-width: 280px;
  max-width: 90%;
  height: 50px;
  max-height: 50px;
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(8px);
  overflow: visible;
  z-index: 1000;
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
  opacity: 1;
}

.fade-in {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
  animation: fadeInUp 0.3s ease-out forwards;
}

@keyframes fadeInUp {
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.notification-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.notification-content {
  position: relative;
  z-index: 2;
}

.notification-text {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.87);
  text-align: center;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.5);
}

.notification-close {
  position: absolute;
  top: -5%;
  right: -1%;
  background: none !important;
  border: none !important;
  color: rgba(0, 0, 0, 0.87);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s ease-in-out;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-size: 0.75rem;
  z-index: 1001;
  padding: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  transform: none !important;
  backdrop-filter: none !important;
  pointer-events: auto;
}

.deletion-notification:hover .notification-close {
  opacity: 1 !important;
}

.notification-close:hover {
  opacity: 1 !important;
}

@media (max-width: 768px) {
  .deletion-notification {
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    min-width: 240px;
  }

  .notification-text {
    font-size: 0.8125rem;
  }
}

@media (max-width: 480px) {
  .deletion-notification {
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    padding: 10px 16px;
    min-width: 200px;
    max-width: calc(100% - 24px);
  }

  .notification-text {
    font-size: 0.75rem;
  }
}

.fade-out {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}
</style>
