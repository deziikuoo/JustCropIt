/**
 * Identity Worker — ArcFace MobileFaceNet ONNX via onnxruntime-web.
 */

import { InferenceSession, Tensor, env } from 'onnxruntime-web/wasm';
import {
  IDENTITY_EMBEDDER_MODEL_FILE,
  IDENTITY_FACE_SIZE_PX,
} from '../constants/optimization';
import { l2Normalize } from '../utils/faceAlign';

export type IdentityWorkerRequestType = 'ping' | 'warmup' | 'embed' | 'cancel';

export interface IdentityWorkerRequest {
  id: string;
  type: IdentityWorkerRequestType;
  photoId?: string;
  /** CHW float32 ArcFace tensors, each 3*112*112 */
  tensors?: ArrayBuffer[];
}

export interface IdentityWorkerResponse {
  id: string;
  type: 'success' | 'error' | 'cancelled' | 'pong';
  photoId?: string;
  embeddings?: number[][];
  loadModelMs?: number;
  inferenceMs?: number;
  error?: string;
}

const cancelledIds = new Set<string>();
let session: InferenceSession | null = null;
let initPromise: Promise<InferenceSession> | null = null;
let initError: string | null = null;
let lastModelLoadMs = 0;
let inputName = 'input';
let outputName = 'output';

function getAssetBase(): string {
  const base = import.meta.env.BASE_URL;
  return new URL(base, self.location.origin).href;
}

function getOrtWasmPath(): string {
  return new URL('ort/', getAssetBase()).href;
}

function getModelUrl(): string {
  return new URL(
    `mediapipe/models/${IDENTITY_EMBEDDER_MODEL_FILE}`,
    getAssetBase()
  ).href;
}

function respond(response: IdentityWorkerResponse): void {
  self.postMessage(response);
}

async function getSession(): Promise<InferenceSession> {
  if (session) return session;
  if (initError) throw new Error(initError);
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const loadStart = performance.now();
    try {
      env.wasm.wasmPaths = getOrtWasmPath();
      env.wasm.numThreads = 1;
      const created = await InferenceSession.create(getModelUrl(), {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      inputName = created.inputNames[0] ?? 'input';
      outputName = created.outputNames[0] ?? 'output';
      lastModelLoadMs = performance.now() - loadStart;
      session = created;
      return created;
    } catch (error) {
      initError = error instanceof Error ? error.message : String(error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

async function embedTensors(
  tensors: ArrayBuffer[]
): Promise<{ embeddings: number[][]; loadModelMs: number; inferenceMs: number }> {
  const inferenceStart = performance.now();
  const loadModelMs = session ? 0 : lastModelLoadMs;
  const ortSession = await getSession();
  const size = IDENTITY_FACE_SIZE_PX;
  const embeddings: number[][] = [];

  for (const buffer of tensors) {
    const floatData = new Float32Array(buffer);
    const input = new Tensor('float32', floatData, [1, 3, size, size]);
    const result = await ortSession.run({ [inputName]: input });
    const output = result[outputName];
    const values = output.data as Float32Array;
    const normalized = l2Normalize(Float32Array.from(values));
    embeddings.push(Array.from(normalized));
  }

  return {
    embeddings,
    loadModelMs,
    inferenceMs: performance.now() - inferenceStart,
  };
}

self.onmessage = async (event: MessageEvent<IdentityWorkerRequest>) => {
  const request = event.data;

  if (request.type === 'ping') {
    respond({ id: request.id, type: 'pong' });
    return;
  }

  if (request.type === 'cancel') {
    cancelledIds.add(request.id);
    return;
  }

  cancelledIds.delete(request.id);

  try {
    if (request.type === 'warmup') {
      await getSession();
      if (cancelledIds.has(request.id)) {
        cancelledIds.delete(request.id);
        respond({ id: request.id, type: 'cancelled', photoId: request.photoId });
        return;
      }
      respond({
        id: request.id,
        type: 'success',
        photoId: request.photoId,
        loadModelMs: lastModelLoadMs || undefined,
      });
      return;
    }

    if (request.type === 'embed') {
      if (!request.tensors?.length) {
        respond({
          id: request.id,
          type: 'error',
          photoId: request.photoId,
          error: 'Missing face tensors',
        });
        return;
      }
      const result = await embedTensors(request.tensors);
      if (cancelledIds.has(request.id)) {
        cancelledIds.delete(request.id);
        respond({ id: request.id, type: 'cancelled', photoId: request.photoId });
        return;
      }
      respond({
        id: request.id,
        type: 'success',
        photoId: request.photoId,
        embeddings: result.embeddings,
        loadModelMs: result.loadModelMs || undefined,
        inferenceMs: result.inferenceMs,
      });
      return;
    }

    throw new Error(`Unknown identity request: ${request.type}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[IdentityWorker] Failed:', message);
    respond({
      id: request.id,
      type: 'error',
      photoId: request.photoId,
      error: message,
    });
  }
};
