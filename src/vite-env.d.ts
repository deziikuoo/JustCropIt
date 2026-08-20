/// <reference types="vite/client" />
/// <reference types="dom-webcodecs" />

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
