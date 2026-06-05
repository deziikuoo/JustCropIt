import { defineConfig, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";

// Function to find Chrome executable on Windows
function getChromePath(): string | null {
  if (process.platform !== "win32") {
    return null;
  }

  const chromePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(
      process.env.LOCALAPPDATA || "",
      "Google\\Chrome\\Application\\chrome.exe",
    ),
  ];

  for (const path of chromePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [vue(), openChromeOnStart()],
  base: mode === "production" ? "/JustCropIt/" : "/",
  optimizeDeps: {
    // @ffmpeg/ffmpeg ships its own worker entry; pre-bundling breaks worker resolution
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  worker: {
    format: "es",
  },
  server: {
    open: false, // Disable auto-open, we'll handle it manually
    host: true, // listen on all addresses, including network
    port: 5173, // explicit port (optional, this is the default)
    strictPort: true, // Exit if port 5173 is already in use (prevents multiple instances)
    headers: {
      // COOP/COEP enable SharedArrayBuffer if we switch to @ffmpeg/core-mt later
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
}));

function openChromeOnStart() {
  return {
    name: "open-chrome-on-start",
    configureServer(server: ViteDevServer) {
      const httpServer = server.httpServer;
      if (!httpServer) {
        return;
      }

      const chromePath = getChromePath();
      if (!chromePath) {
        return;
      }

      httpServer.once("listening", () => {
        const addr = httpServer.address();
        const port =
          server.config.server.port ??
          (typeof addr === "object" && addr !== null && "port" in addr
            ? (addr as { port: number }).port
            : 5173);
        const url = `http://localhost:${port}/`;
        execFile(chromePath, [url]);
      });
    },
  };
}
