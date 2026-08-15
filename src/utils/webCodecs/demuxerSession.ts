/**
 * web-demuxer session: load WASM, probe media, stream encoded chunks.
 */

import { WebDemuxer, AVMediaType } from 'web-demuxer';
import type { WebCodecsProbeResult } from './types';

/** web-demuxer@4 full WASM — kept in sync with package.json dependency */
const WEB_DEMUXER_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/web-demuxer@4.0.0/dist/wasm-files/web-demuxer.wasm';

/**
 * Absolute WASM URL for web-demuxer's nested data: worker (opaque origin).
 * Dev: same-origin public/ file (Vite serves CORS/CORP headers).
 * Prod: jsDelivr CDN (GitHub Pages cannot set CORS/CORP for opaque workers).
 */
function getWasmFilePath(): string {
  if (import.meta.env.DEV) {
    const base = import.meta.env.BASE_URL || '/';
    return new URL('web-demuxer/web-demuxer.wasm', self.location.origin + base).href;
  }
  return WEB_DEMUXER_WASM_CDN;
}

function parseFrameRate(rate: string | undefined): number | undefined {
  if (!rate || rate === 'N/A' || rate === '0/0') return undefined;
  const parts = rate.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return num / den;
    }
  }
  const asNumber = Number(rate);
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : undefined;
}

export class DemuxerSession {
  private demuxer: WebDemuxer | null = null;

  async load(file: File): Promise<void> {
    this.destroy();
    this.demuxer = new WebDemuxer({
      wasmFilePath: getWasmFilePath(),
    });
    await this.demuxer.load(file);
  }

  get instance(): WebDemuxer {
    if (!this.demuxer) {
      throw new Error('Demuxer not loaded');
    }
    return this.demuxer;
  }

  async probe(): Promise<WebCodecsProbeResult> {
    const demuxer = this.instance;
    const mediaInfo = await demuxer.getMediaInfo();
    const videoStream =
      mediaInfo.streams.find((s) => s.codec_type === AVMediaType.AVMEDIA_TYPE_VIDEO) ??
      (await demuxer.getAVStream(AVMediaType.AVMEDIA_TYPE_VIDEO).catch(() => null));

    if (!videoStream) {
      throw new Error('No video stream found in file');
    }

    const duration = mediaInfo.duration > 0
      ? mediaInfo.duration
      : (videoStream.duration > 0 ? videoStream.duration : 0);

    return {
      duration,
      width: videoStream.width || 0,
      height: videoStream.height || 0,
      frameRate: parseFrameRate(videoStream.avg_frame_rate || videoStream.r_frame_rate),
      codec: videoStream.codec_name || undefined,
      codecString: videoStream.codec_string || undefined,
    };
  }

  async getVideoDecoderConfig(): Promise<VideoDecoderConfig> {
    return this.instance.getDecoderConfig('video');
  }

  /**
   * Stream encoded video chunks from start→end.
   * web-demuxer seeks backward to the prior keyframe for accurate decode.
   */
  readVideoChunks(startSeconds: number, endSeconds: number): ReadableStream<EncodedVideoChunk> {
    return this.instance.read('video', startSeconds, endSeconds);
  }

  destroy(): void {
    if (this.demuxer) {
      try {
        this.demuxer.destroy();
      } catch {
        // already destroyed
      }
      this.demuxer = null;
    }
  }
}

export function arrayBufferToFile(
  data: ArrayBuffer,
  fileName: string,
  mimeType?: string
): File {
  const ext = fileName.split('.').pop()?.toLowerCase() || 'mp4';
  const mime =
    mimeType ||
    ({
      mp4: 'video/mp4',
      m4v: 'video/x-m4v',
      mov: 'video/quicktime',
      webm: 'video/webm',
      mkv: 'video/x-matroska',
    }[ext] ?? 'video/mp4');

  return new File([data], fileName, { type: mime });
}
