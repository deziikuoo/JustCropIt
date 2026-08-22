/// <reference types="vite/client" />
/// <reference types="dom-webcodecs" />

type WellKnownDirectory =
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'music'
  | 'pictures'
  | 'videos';

interface OpenFilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: OpenFilePickerAcceptType[];
  id?: string;
  startIn?: WellKnownDirectory | FileSystemHandle;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor
  ): Promise<PermissionState>;
  requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor
  ): Promise<PermissionState>;
}

interface Window {
  showOpenFilePicker?: (
    options?: OpenFilePickerOptions
  ) => Promise<FileSystemFileHandle[]>;
}

interface ImportMetaEnv {
  readonly VITE_UMAMI_WEBSITE_ID?: string;
  readonly VITE_UMAMI_DOMAINS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'heic2any' {
  interface Heic2AnyOptions {
    blob: Blob;
    toType: string;
    quality?: number;
  }

  function heic2any(options: Heic2AnyOptions): Promise<Blob | Blob[]>;
  export default heic2any;
}

declare module 'onnxruntime-web' {
  export class Tensor {
    constructor(
      type: string,
      data: Float32Array | number[],
      dims?: readonly number[]
    );
    readonly data: Float32Array;
    readonly dims: readonly number[];
  }

  export class InferenceSession {
    readonly inputNames: string[];
    readonly outputNames: string[];
    static create(
      path: string,
      options?: {
        executionProviders?: string[];
        graphOptimizationLevel?: string;
      }
    ): Promise<InferenceSession>;
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }

  export const env: {
    wasm: {
      wasmPaths: string;
      numThreads: number;
    };
  };
}

declare module 'onnxruntime-web/wasm' {
  export class Tensor {
    constructor(
      type: string,
      data: Float32Array | number[],
      dims?: readonly number[]
    );
    readonly data: Float32Array;
    readonly dims: readonly number[];
  }

  export class InferenceSession {
    readonly inputNames: string[];
    readonly outputNames: string[];
    static create(
      path: string,
      options?: {
        executionProviders?: string[];
        graphOptimizationLevel?: string;
      }
    ): Promise<InferenceSession>;
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }

  export const env: {
    wasm: {
      wasmPaths: string;
      numThreads: number;
    };
  };
}
