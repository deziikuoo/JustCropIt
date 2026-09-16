import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { createReadStream, existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import type { IncomingMessage, ServerResponse } from "http";

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

function webDemuxerWasmPath(): string {
  const fromPublic = join(__dirname, "public/web-demuxer/web-demuxer.wasm");
  if (existsSync(fromPublic)) return fromPublic;
  return join(
    __dirname,
    "node_modules/web-demuxer/dist/wasm-files/web-demuxer.wasm"
  );
}

/**
 * web-demuxer creates its nested WASM worker with `window.URL` / `window.Blob`.
 * Inside the WebCodecs dedicated worker those are undefined, so it falls back
 * to an opaque data: worker that then 404s `/assets/web-demuxer.wasm`.
 * `self.Blob` / `self.URL` keep the nested worker same-origin.
 */
function fixWebDemuxerNestedWorker(): Plugin {
  return {
    name: "fix-web-demuxer-nested-worker",
    transform(code, id) {
      if (!id.replace(/\\/g, "/").includes("/web-demuxer/")) return;
      if (!code.includes("window.URL") && !code.includes("window.Blob")) return;
      return {
        code: code
          .replace(/typeof window < "u" && window\.Blob/g, "typeof self < \"u\" && self.Blob")
          .replace(/window\.URL \|\| window\.webkitURL/g, "self.URL || self.webkitURL"),
        map: null,
      };
    },
  };
}

function sendWasm(
  wasmPath: string,
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }
  if (!existsSync(wasmPath)) {
    next();
    return;
  }
  res.setHeader("Content-Type", "application/wasm");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Length", String(statSync(wasmPath).size));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(wasmPath).pipe(res);
}

/**
 * web-demuxer's nested worker also requests `/assets/web-demuxer.wasm` next to
 * the hashed WebCodecs worker. Serve/copy the file there so export probe is not a 404.
 */
function copyWebDemuxerWasm(): Plugin {
  const wasmPath = webDemuxerWasmPath();
  const mount = (server: { middlewares: ViteDevServer["middlewares"] }) => {
    server.middlewares.use((req, res, next) => {
      const url = req.url?.split("?")[0] ?? "";
      if (
        url === "/assets/web-demuxer.wasm" ||
        url === "/web-demuxer/web-demuxer.wasm" ||
        url.endsWith("/assets/web-demuxer.wasm")
      ) {
        sendWasm(wasmPath, req, res, next);
        return;
      }
      next();
    });
  };

  return {
    name: "copy-web-demuxer-wasm",
    configureServer: mount,
    configurePreviewServer: mount,
    generateBundle() {
      if (!existsSync(wasmPath)) return;
      const source = readFileSync(wasmPath);
      this.emitFile({
        type: "asset",
        fileName: "assets/web-demuxer.wasm",
        source,
      });
    },
  };
}

function openVivaldiOnStart(): Plugin {
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

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    fixWebDemuxerNestedWorker(),
    copyWebDemuxerWasm(),
    openVivaldiOnStart(),
  ],
  base: mode === "production" ? "/JustCropIt/" : "/",
  optimizeDeps: {
    // @ffmpeg/ffmpeg ships its own worker entry; pre-bundling breaks worker resolution
    exclude: [
      "@ffmpeg/ffmpeg",
      "@ffmpeg/util",
      "@mediapipe/tasks-vision",
      "onnxruntime-web",
      "sam-web",
      "web-demuxer",
    ],
  },
  worker: {
    format: "es",
    plugins: () => [fixWebDemuxerNestedWorker()],
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
