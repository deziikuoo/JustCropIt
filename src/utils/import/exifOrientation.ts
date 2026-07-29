/**
 * EXIF Orientation (1–8) canvas transforms.
 * Physically rotates/flips pixel data so output is orientation 1 (upright).
 */

export function getOrientedDimensions(
  width: number,
  height: number,
  orientation: number
): { width: number; height: number } {
  if (orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

type CanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Draw a bitmap onto a canvas applying EXIF orientation correction.
 * Canvas dimensions must match getOrientedDimensions(source width/height, orientation).
 */
export function drawOrientedImage(
  ctx: CanvasContext,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  orientation: number
): void {
  const destWidth = ctx.canvas.width;
  const destHeight = ctx.canvas.height;

  ctx.save();

  switch (orientation) {
    case 2:
      ctx.translate(destWidth, 0);
      ctx.scale(-1, 1);
      break;
    case 3:
      ctx.translate(destWidth, destHeight);
      ctx.rotate(Math.PI);
      break;
    case 4:
      ctx.translate(0, destHeight);
      ctx.scale(1, -1);
      break;
    case 5:
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    case 6:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -destHeight);
      break;
    case 7:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(destWidth, -destHeight);
      ctx.scale(-1, 1);
      break;
    case 8:
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-destWidth, 0);
      break;
    case 1:
    default:
      break;
  }

  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  ctx.restore();
}

export function needsOrientationNormalize(orientation: number): boolean {
  return orientation !== 1;
}
