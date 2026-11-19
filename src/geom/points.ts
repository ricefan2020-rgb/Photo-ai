export type Point = { x: number; y: number };

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function mul(a: Point, s: number): Point {
  return { x: a.x * s, y: a.y * s };
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

export function len(a: Point): number {
  return Math.hypot(a.x, a.y);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function norm(a: Point): Point {
  const l = len(a);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

/** Left normal of a direction in a Y-up millimetre frame. */
export function leftNorm(dir: Point): Point {
  return { x: -dir.y, y: dir.x };
}

export function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function roundMm(n: number): number {
  return Math.round(n);
}

export function roundPt(p: Point): Point {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

export function signedArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}
