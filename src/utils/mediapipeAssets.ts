export function getAssetBase(): string {
  const base = import.meta.env.BASE_URL;
  return new URL(base, window.location.origin).href;
}

export function getWasmPath(): string {
  return new URL('mediapipe/wasm', getAssetBase()).href.replace(/\/$/, '');
}

export function getModelUrl(modelFile: string): string {
  return new URL(`mediapipe/models/${modelFile}`, getAssetBase()).href;
}
