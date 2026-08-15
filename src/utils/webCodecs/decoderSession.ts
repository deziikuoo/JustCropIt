/**
 * VideoDecoder lifecycle with hardware preference and backpressure.
 */

import {
  WEBCODECS_HARDWARE_ACCELERATION,
  WEBCODECS_MAX_DECODE_QUEUE,
} from '../../constants/optimization';
import { isVideoDecoderConfigSupported } from './support';

export type DecodedFrameHandler = (frame: VideoFrame) => void | Promise<void>;

export class DecoderSession {
  private decoder: VideoDecoder | null = null;
  private error: Error | null = null;
  private outputChain: Promise<void> = Promise.resolve();
  private waitingForQueue: (() => void) | null = null;

  get hasError(): Error | null {
    return this.error;
  }

  async configure(
    baseConfig: VideoDecoderConfig,
    onFrame: DecodedFrameHandler
  ): Promise<VideoDecoderConfig> {
    const config: VideoDecoderConfig = {
      ...baseConfig,
      hardwareAcceleration: WEBCODECS_HARDWARE_ACCELERATION,
      optimizeForLatency: true,
    };

    let supported = await isVideoDecoderConfigSupported(config);
    if (!supported) {
      // Retry without hardware preference
      const softwareConfig: VideoDecoderConfig = {
        ...baseConfig,
        hardwareAcceleration: 'prefer-software',
        optimizeForLatency: true,
      };
      supported = await isVideoDecoderConfigSupported(softwareConfig);
      if (!supported) {
        const codec = baseConfig.codec || 'unknown';
        throw new Error(
          `This browser cannot decode codec "${codec}". Try re-encoding to H.264 MP4 or VP9 WebM.`
        );
      }
      return this.openDecoder(softwareConfig, onFrame);
    }

    return this.openDecoder(config, onFrame);
  }

  private openDecoder(
    config: VideoDecoderConfig,
    onFrame: DecodedFrameHandler
  ): VideoDecoderConfig {
    this.close();
    this.error = null;

    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.outputChain = this.outputChain
          .then(async () => {
            try {
              await onFrame(frame);
            } finally {
              try {
                frame.close();
              } catch {
                // already closed
              }
            }
          })
          .catch((err) => {
            this.error = err instanceof Error ? err : new Error(String(err));
          });
      },
      error: (e) => {
        this.error = e instanceof Error ? e : new Error(String(e));
        this.resolveQueueWait();
      },
    });

    this.decoder.configure(config);

    this.decoder.ondequeue = () => {
      if (
        this.decoder &&
        this.decoder.decodeQueueSize <= Math.floor(WEBCODECS_MAX_DECODE_QUEUE / 2)
      ) {
        this.resolveQueueWait();
      }
    };

    return config;
  }

  private resolveQueueWait(): void {
    if (this.waitingForQueue) {
      const resolve = this.waitingForQueue;
      this.waitingForQueue = null;
      resolve();
    }
  }

  async waitForCapacity(): Promise<void> {
    if (!this.decoder) return;
    if (this.error) throw this.error;

    while (this.decoder.decodeQueueSize >= WEBCODECS_MAX_DECODE_QUEUE) {
      if (this.error) throw this.error;
      await new Promise<void>((resolve) => {
        this.waitingForQueue = resolve;
        // Safety timeout so we never hang if dequeue events are missed
        setTimeout(() => {
          if (this.waitingForQueue === resolve) {
            this.waitingForQueue = null;
            resolve();
          }
        }, 50);
      });
    }
  }

  decode(chunk: EncodedVideoChunk): void {
    if (!this.decoder) {
      throw new Error('Decoder not configured');
    }
    if (this.error) throw this.error;
    if (this.decoder.state === 'closed') {
      throw new Error('Decoder is closed');
    }
    this.decoder.decode(chunk);
  }

  async flush(): Promise<void> {
    if (!this.decoder || this.decoder.state === 'closed') {
      await this.outputChain;
      return;
    }
    try {
      await this.decoder.flush();
    } catch (err) {
      // flush can reject if already closed/reset during cancel
      if (!this.error) {
        console.warn('[WebCodecs] decoder.flush warning:', err);
      }
    }
    await this.outputChain;
    if (this.error) throw this.error;
  }

  close(): void {
    this.resolveQueueWait();
    if (this.decoder) {
      try {
        if (this.decoder.state !== 'closed') {
          this.decoder.close();
        }
      } catch {
        // ignore
      }
      this.decoder = null;
    }
  }

  async dispose(): Promise<void> {
    try {
      await this.flush().catch(() => undefined);
    } finally {
      this.close();
    }
  }
}
