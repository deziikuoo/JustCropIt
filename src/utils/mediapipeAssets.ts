export function getAssetBase(): string {
  const base = import.meta.env.BASE_URL;
  const origin =
    typeof self !== 'undefined' && self.location?.origin
      ? self.location.origin
      : 'http://localhost';
  return new URL(base, origin).href;
}

export function getWasmPath(): string {
  return new URL('mediapipe/wasm', getAssetBase()).href.replace(/\/$/, '');
}

export function getModelUrl(modelFile: string): string {
  return new URL(`mediapipe/models/${modelFile}`, getAssetBase()).href;
}
