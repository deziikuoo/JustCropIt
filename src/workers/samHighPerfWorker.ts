/**
 * sam-web worker with a high-performance GPU hint.
 * Must run before the first ONNX WebGPU session (created on ping).
 *
 * sam-web points wasmPaths at CDN 1.23.2 while this app's JS is 1.21 —
 * that mismatch throws `_OrtGetInputName is not a function`. Override to
 * the same local /ort/ files identity uses.
 */

import { quietIgnorableSamLogs, quietOrtLogs } from '../utils/quietSamLogs';
import * as ort from 'onnxruntime-web';
import {
  preferHighPerformanceGpu,
  setOrtHighPerformancePreference,
} from '../utils/webgpuPower';
import 'sam-web/worker';

quietIgnorableSamLogs();
quietOrtLogs(ort.env);
preferHighPerformanceGpu(self);
setOrtHighPerformancePreference(
  ort.env as typeof ort.env & { webgpu?: { powerPreference?: 'high-performance' } }
);

const assetBase = new URL(import.meta.env.BASE_URL, self.location.origin).href;
ort.env.wasm.wasmPaths = new URL('ort/', assetBase).href;
