/**
 * Convert VideoFrame → JPEG/PNG bytes via a reusable OffscreenCanvas.
 */

export class FrameCapture {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  private ensureCanvas(width: number, height: number): OffscreenCanvasRenderingContext2D {
    if (!this.canvas || this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas = new OffscreenCanvas(width, height);
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      if (!this.ctx) {
        throw new Error('OffscreenCanvas 2D context unavailable');
      }
    }
    return this.ctx!;
  }

  async capture(
    frame: VideoFrame,
    outputFormat: 'png' | 'jpeg',
    quality: number
  ): Promise<{ data: Uint8Array; mimeType: string }> {
    const width = frame.displayWidth || frame.codedWidth;
    const height = frame.displayHeight || frame.codedHeight;
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid frame dimensions: ${width}x${height}`);
    }

    const ctx = this.ensureCanvas(width, height);
    ctx.drawImage(frame, 0, 0, width, height);

    const isJpeg = outputFormat === 'jpeg';
    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
    const clampedQuality = Math.min(1, Math.max(0.1, quality));

    const blob = await this.canvas!.convertToBlob(
      isJpeg ? { type: mimeType, quality: clampedQuality } : { type: mimeType }
    );

    const buffer = await blob.arrayBuffer();
    return { data: new Uint8Array(buffer), mimeType };
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
  }
}
