<template>
  <canvas ref="canvasRef" class="shimmer-canvas"></canvas>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

interface Particle {
  x: number;
  y: number;
  size: number;
  color: string;
  opacity: number;
  maxOpacity: number;
  speed: number; // How fast it cycles through opacity
  phase: number; // Current position in the cycle (0 to 2π)
}

const canvasRef = ref<HTMLCanvasElement | null>(null);
let animationId: number | null = null;
let particles: Particle[] = [];
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let isIdle = ref(false);
let globalOpacity = ref(0); // Controls overall visibility of the effect

const IDLE_THRESHOLD = 10000; // 10 seconds of inactivity

const PARTICLE_COUNT = 15; // Very sparse, premium feel
const COLORS = ["#FFD700", "#DAA520", "#FFC125"];

const isMobile = () => window.innerWidth <= 768;

const createParticle = (width: number, height: number): Particle => {
  const mobile = isMobile();
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    size: mobile ? 0.5 + Math.random() * 1 : 1 + Math.random() * 2, // 0.5-1.5px on mobile, 1-3px on desktop
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    opacity: 0,
    maxOpacity: 0.3 + Math.random() * 0.5, // 0.3 to 0.8
    speed: 0.005 + Math.random() * 0.015, // Varied cycle speeds
    phase: Math.random() * Math.PI * 2, // Random starting phase
  };
};

const initParticles = (width: number, height: number) => {
  particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(createParticle(width, height));
  }
};

const updateParticles = () => {
  for (const particle of particles) {
    // Advance the phase
    particle.phase += particle.speed;
    if (particle.phase > Math.PI * 2) {
      particle.phase -= Math.PI * 2;
    }
    // Calculate opacity using sine wave (smooth fade in/out)
    // sin gives -1 to 1, we map to 0 to maxOpacity
    particle.opacity = ((Math.sin(particle.phase) + 1) / 2) * particle.maxOpacity;
  }
};

const drawParticles = (ctx: CanvasRenderingContext2D) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Only draw if we're idle and have some opacity
  if (globalOpacity.value < 0.01) return;

  for (const particle of particles) {
    if (particle.opacity < 0.01) continue; // Skip nearly invisible particles

    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = particle.opacity * globalOpacity.value;
    ctx.fill();
  }

  ctx.globalAlpha = 1;
};

const animate = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Smoothly transition global opacity based on idle state
  if (isIdle.value && globalOpacity.value < 1) {
    globalOpacity.value = Math.min(1, globalOpacity.value + 0.02); // Fade in
  } else if (!isIdle.value && globalOpacity.value > 0) {
    globalOpacity.value = Math.max(0, globalOpacity.value - 0.05); // Fade out faster
  }

  updateParticles();
  drawParticles(ctx);

  animationId = requestAnimationFrame(animate);
};

const resetIdleTimer = () => {
  isIdle.value = false;

  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  idleTimer = setTimeout(() => {
    isIdle.value = true;
  }, IDLE_THRESHOLD);
};

const handleResize = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // Reinitialize particles on resize to spread across new dimensions
  initParticles(canvas.width, canvas.height);
};

onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  initParticles(canvas.width, canvas.height);
  animate();

  // Track user activity to detect idle state
  const activityEvents = [
    "mousemove",
    "mousedown",
    "keydown",
    "scroll",
    "touchstart",
    "touchmove",
  ];

  activityEvents.forEach((event) => {
    window.addEventListener(event, resetIdleTimer, { passive: true });
  });

  // Start the idle timer
  resetIdleTimer();

  window.addEventListener("resize", handleResize, { passive: true });
});

onUnmounted(() => {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
  }
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  const activityEvents = [
    "mousemove",
    "mousedown",
    "keydown",
    "scroll",
    "touchstart",
    "touchmove",
  ];

  activityEvents.forEach((event) => {
    window.removeEventListener(event, resetIdleTimer);
  });

  window.removeEventListener("resize", handleResize);
});
</script>

<style scoped>
.shimmer-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 0;
  pointer-events: none;
}
</style>

