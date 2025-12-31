import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  base: mode === "production" ? "/JustCropIt/" : "/",
  server: {
    open: true, // launches browser on `npm run dev`
    host: true, // listen on all addresses, including network
    port: 5173, // explicit port (optional, this is the default)
  },
}));
