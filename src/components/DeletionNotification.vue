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
  vx: number;
  vy: number;
  color: string;
}

const PARTICLE_COLORS = [
  "#000000",
  "#1a1a1a",
  "#2d2d2d",
  "#ffffff",
  "#fff9e6",
  "#ffd700",
  "#d4af37",
  "#ffe566",
];

const SHINY_PARTICLE_COLORS = new Set([
  "#ffffff",
  "#fff9e6",
  "#ffd700",
  "#d4af37",
  "#ffe566",
]);

const canvasRef = ref<HTMLCanvasElement | null>(null);
const notificationRef = ref<HTMLElement | null>(null);
let animationId: number | null = null;
let particles: Particle[] = [];
const isVisible = ref(true);
const isFadingOut = ref(false);
const isFadingIn = ref(true);
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

const DISPLAY_DURATION = 12000;
const PARTICLE_COUNT = 12;

const isMobile = () => window.innerWidth <= 768;

const createParticle = (width: number, height: number): Particle => {
  const mobile = isMobile();
  const baseVelocity = mobile ? 0.08 : 0.12;
  const color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
  const isShiny = SHINY_PARTICLE_COLORS.has(color);

  return {
    x: Math.random() * width,
    y: Math.random() * height,
    size: mobile
      ? (isShiny ? 0.8 + Math.random() * 1.2 : 0.5 + Math.random() * 1)
      : (isShiny ? 1.2 + Math.random() * 2 : 1 + Math.random() * 2),
    opacity: 0,
    maxOpacity: isShiny ? 0.75 + Math.random() * 0.25 : 0.45 + Math.random() * 0.45,
    speed: 0.005 + Math.random() * 0.015,
    phase: Math.random() * Math.PI * 2,
    vx: (Math.random() - 0.5) * baseVelocity,
    vy: (Math.random() - 0.5) * baseVelocity,
    color,
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
    particle.phase += particle.speed;
    if (particle.phase > Math.PI * 2) {
      particle.phase -= Math.PI * 2;
    }
    particle.opacity =
      ((Math.sin(particle.phase) + 1) / 2) * particle.maxOpacity;
    particle.x += particle.vx;
    particle.y += particle.vy;

    if (particle.x < 0) particle.x = width;
    else if (particle.x > width) particle.x = 0;
    if (particle.y < 0) particle.y = height;
    else if (particle.y > height) particle.y = 0;
  }
};

const drawParticles = (ctx: CanvasRenderingContext2D) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (const particle of particles) {
    if (particle.opacity < 0.01) continue;

    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = particle.opacity;
    ctx.fill();

    if (SHINY_PARTICLE_COLORS.has(particle.color)) {
      ctx.beginPath();
      ctx.arc(
        particle.x - particle.size * 0.25,
        particle.y - particle.size * 0.25,
        particle.size * 0.35,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = particle.opacity * 0.65;
      ctx.fill();
    }
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
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  isFadingOut.value = true;
  setTimeout(() => {
    isVisible.value = false;
  }, 300);
};

const startDismissTimer = () => {
  dismissTimer = setTimeout(() => {
    handleClose();
  }, DISPLAY_DURATION);
};

onMounted(() => {
  const canvas = canvasRef.value;
  const notification = notificationRef.value;
  if (!canvas || !notification) return;

  const rect = notification.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  initParticles(canvas.width, canvas.height);
  animate();
  startDismissTimer();

  setTimeout(() => {
    isFadingIn.value = false;
  }, 300);

  window.addEventListener("resize", handleResize, { passive: true });
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
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 5px 10px;
  background: linear-gradient(
    135deg,
    #9a7b0a 0%,
    #d4af37 30%,
    #ffd700 65%,
    #ffe566 100%
  );
  border-radius: 9px;
  border: 1px solid rgba(212, 175, 55, 0.55);
  width: auto;
  min-width: 0;
  max-width: min(280px, calc(100vw - 24px));
  min-height: 30px;
  height: auto;
  max-height: none;
  box-shadow:
    0 3px 12px rgba(212, 175, 55, 0.3),
    0 1px 4px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(8px);
  overflow: hidden;
  z-index: 1;
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
  opacity: 1;
}

.fade-in {
  opacity: 0;
  transform: translateY(-10px);
  animation: fadeInDown 0.3s ease-out forwards;
}

@keyframes fadeInDown {
  to {
    opacity: 1;
    transform: translateY(0);
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
  border-radius: inherit;
}

.notification-content {
  position: relative;
  z-index: 2;
  min-width: 0;
  flex: 1;
  padding-right: 4px;
}

.notification-text {
  margin: 0;
  font-size: 0.68rem;
  font-weight: 600;
  color: rgba(20, 14, 4, 0.92);
  text-align: left;
  line-height: 1.25;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.25);
  white-space: nowrap;
}

.notification-close {
  position: relative;
  flex-shrink: 0;
  background: transparent !important;
  border: none !important;
  color: rgba(20, 14, 4, 0.85);
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.2s ease-in-out, background 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 0.68rem;
  z-index: 3;
  padding: 0 !important;
  border-radius: 50% !important;
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
  background: rgba(20, 14, 4, 0.12) !important;
}

@media (max-width: 768px) {
  .deletion-notification {
    max-width: min(240px, calc(100vw - 24px));
    padding: 4px 9px;
    min-height: 28px;
  }

  .notification-text {
    font-size: 0.64rem;
  }
}

@media (max-width: 480px) {
  .deletion-notification {
    padding: 4px 8px;
    gap: 6px;
    min-height: 26px;
    max-width: min(220px, calc(100vw - 16px));
  }

  .notification-text {
    font-size: 0.6rem;
    white-space: normal;
  }
}

.deletion-notification.fade-out {
  opacity: 0;
  transform: translateY(-10px);
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}
</style>
