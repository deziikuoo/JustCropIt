import { defineConfig, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";

function getVivaldiPath(): string | null {
  if (process.platform !== "win32") {
    return null;
  }

  const vivaldiPaths = [
    join(process.env.LOCALAPPDATA || "", "Vivaldi\\Application\\vivaldi.exe"),
    "C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe",
    "C:\\Program Files (x86)\\Vivaldi\\Application\\vivaldi.exe",
  ];

  for (const path of vivaldiPaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [vue(), openVivaldiOnStart()],
  base: mode === "production" ? "/JustCropIt/" : "/",
  optimizeDeps: {
    // @ffmpeg/ffmpeg ships its own worker entry; pre-bundling breaks worker resolution
    exclude: [
      "@ffmpeg/ffmpeg",
      "@ffmpeg/util",
      "@mediapipe/tasks-vision",
      "onnxruntime-web",
      "web-demuxer",
    ],
  },
  worker: {
    format: "es",
  },
  server: {
    open: false, // Disable Vite's default browser; open Vivaldi instead
    host: true, // listen on all addresses, including network
    port: 5000,
    strictPort: true, // Exit if port 5000 is already in use (prevents multiple instances)
    headers: {
      // COOP/COEP enable SharedArrayBuffer if we switch to @ffmpeg/core-mt later
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      // web-demuxer loads WASM from an opaque data: worker — needs CORS + CORP
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": "*",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": "*",
    },
  },
}));

function openVivaldiOnStart() {
  return {
    name: "open-vivaldi-on-start",
    configureServer(server: ViteDevServer) {
      // Ensure every response (including public/ WASM) is readable by opaque workers
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Access-Control-Allow-Origin", "*");
        next();
      });

      const httpServer = server.httpServer;
      if (!httpServer) {
        return;
      }

      const vivaldiPath = getVivaldiPath();
      if (!vivaldiPath) {
        return;
      }

      httpServer.once("listening", () => {
        const addr = httpServer.address();
        const port =
          server.config.server.port ??
          (typeof addr === "object" && addr !== null && "port" in addr
            ? (addr as { port: number }).port
            : 5000);
        const url = `http://localhost:${port}/`;
        execFile(vivaldiPath, [url]);
      });
    },
  };
}
