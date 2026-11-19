import { distance, type Point } from "./points";

/** Source image pixels are Y-down. World millimetres are Y-up and integer. */
export type Frame = {
  imageWidth: number;
  imageHeight: number;
  /** Clockwise degrees, same sign as Konva, applied around the image centre. */
  rotationDeg: number;
  mmPerPx: number;
};

export function imagePxToWorld(p: Point, frame: Frame): Point {
  const cx = frame.imageWidth / 2;
  const cy = frame.imageHeight / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const rad = (frame.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return {
    x: Math.round(rx * frame.mmPerPx),
    y: Math.round(-ry * frame.mmPerPx),
  };
}

export function worldToImagePx(w: Point, frame: Frame): Point {
  const cx = frame.imageWidth / 2;
  const cy = frame.imageHeight / 2;
  const rx = w.x / frame.mmPerPx;
  const ry = -w.y / frame.mmPerPx;
  const rad = (frame.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = rx * cos + ry * sin;
  const dy = -rx * sin + ry * cos;
  return { x: dx + cx, y: dy + cy };
}

export function worldLengthMm(a: Point, b: Point): number {
  return Math.round(distance(a, b));
}

export function rotatedPixelBounds(
  width: number,
  height: number,
  rotationDeg: number,
): { width: number; height: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { width: width * c + height * s, height: width * s + height * c };
}
