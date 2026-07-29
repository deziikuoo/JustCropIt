/**
 * Polyfills required for @mediapipe/tasks-vision inside Vite ES module workers.
 * Must be imported before any MediaPipe imports in detectionWorker.ts.
 */

if (typeof document === 'undefined') {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'createElement') {
        return (tag: string) => {
          if (tag === 'canvas') return new OffscreenCanvas(1, 1);
          return {};
        };
      }
      return undefined;
    },
    has() {
      return false;
    },
  };
  (self as unknown as { document: object }).document = new Proxy({}, handler);
}

if (typeof (self as unknown as { import?: (url: string) => Promise<unknown> }).import !== 'function') {
  (self as unknown as { import: (url: string) => Promise<unknown> }).import = async (
    url: string
  ) => import(/* @vite-ignore */ url);
}
