/**
 * Ask WebGPU for the discrete / high-performance adapter when the machine
 * has more than one GPU. There is no min/max utilization API.
 */

type PowerPreference = 'high-performance' | 'low-power';

interface GpuRequestAdapterOptions {
  powerPreference?: PowerPreference;
  forceFallbackAdapter?: boolean;
}

interface GpuLike {
  requestAdapter: (options?: GpuRequestAdapterOptions) => Promise<unknown>;
}

function chromeIgnoresPowerPreference(
  scope: { navigator?: Navigator } = globalThis
): boolean {
  const ua = scope.navigator?.userAgent ?? '';
  return /Windows/i.test(ua);
}

export function preferHighPerformanceGpu(
  scope: { navigator?: Navigator } = globalThis
): void {
  if (chromeIgnoresPowerPreference(scope)) return;

  const gpu = (scope.navigator as (Navigator & { gpu?: GpuLike }) | undefined)?.gpu;
  if (!gpu?.requestAdapter) return;

  const original = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = (options) =>
    original({
      ...options,
      powerPreference: 'high-performance',
    });
}

export function setOrtHighPerformancePreference(env: {
  webgpu?: { powerPreference?: PowerPreference };
}): void {
  if (chromeIgnoresPowerPreference()) return;
  env.webgpu = {
    ...env.webgpu,
    powerPreference: 'high-performance',
  };
}
