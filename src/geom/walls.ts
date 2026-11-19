import {
  add,
  cross,
  distance,
  dot,
  leftNorm,
  len,
  mid,
  mul,
  norm,
  roundMm,
  roundPt,
  signedArea,
  sub,
  type Point,
} from "./points";

export type WallInput = {
  id: string;
  points: Point[];
  thicknessMm: number;
  closed: boolean;
};

export type SegmentAnno = {
  insideClearMm: number;
  sideA: [Point, Point];
  sideB: [Point, Point];
  dimA: Point;
  dimB: Point;
  extA: [Point, Point];
  extB: [Point, Point];
  labelAt: Point;
  angleDeg: number;
};

export type WallLayout = {
  id: string;
  thicknessMm: number;
  closed: boolean;
  center: Point[];
  segments: SegmentAnno[];
};

const MITER_LIMIT = 6;

function dedupe(points: readonly Point[], closed: boolean): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || distance(prev, p) > 0.5) out.push(p);
  }
  if (closed && out.length > 1 && distance(out[0], out[out.length - 1]) <= 0.5) out.pop();
  return out;
}

type OffLine = { origin: Point; dir: Point };

function offsetLine(a: Point, b: Point, dist: number): OffLine | null {
  const dir = norm(sub(b, a));
  if (len(dir) < 0.5) return null;
  return { origin: add(a, mul(leftNorm(dir), dist)), dir };
}

function lineIntersect(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-8) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, mul(d1, t));
}

function joinVertex(vertex: Point, prev: OffLine | null, next: OffLine | null, dist: number): Point {
  if (prev && next) {
    const hit = lineIntersect(prev.origin, prev.dir, next.origin, next.dir);
    if (hit && distance(hit, vertex) <= Math.abs(dist) * MITER_LIMIT + 1) return hit;
  }
  const parts: Point[] = [];
  if (prev) parts.push(add(vertex, mul(leftNorm(prev.dir), dist)));
  if (next) parts.push(add(vertex, mul(leftNorm(next.dir), dist)));
  if (parts.length === 0) return { ...vertex };
  if (parts.length === 1) return parts[0];
  return mid(parts[0], parts[1]);
}

/** Offset to the left of travel when dist is positive. One vertex per source vertex. */
export function offsetPolyline(points: readonly Point[], dist: number, closed: boolean): Point[] {
  const src = dedupe(points, closed);
  const n = src.length;
  if (n < 2) return [];
  const segCount = closed ? n : n - 1;
  const lines: (OffLine | null)[] = [];
  for (let i = 0; i < segCount; i++) {
    lines.push(offsetLine(src[i], src[(i + 1) % n], dist));
  }
  if (!closed) {
    const first = lines[0];
    if (!first) return src.map((p) => ({ ...p }));
    const out: Point[] = [{ ...first.origin }];
    for (let i = 0; i < segCount - 1; i++) {
      out.push(joinVertex(src[i + 1], lines[i], lines[i + 1], dist));
    }
    const last = lines[segCount - 1];
    const end = src[n - 1];
    out.push(last ? add(end, mul(leftNorm(last.dir), dist)) : { ...end });
    return out;
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    out.push(joinVertex(src[i], lines[(i - 1 + n) % n], lines[i], dist));
  }
  return out;
}

function pointOnSegment(p: Point, a: Point, b: Point, tol: number): boolean {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-6) return distance(p, a) <= tol;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return distance(p, add(a, mul(ab, t))) <= tol;
}

function endInset(point: Point, inward: Point, walls: readonly WallInput[], selfId: string): number {
  const dir = norm(inward);
  if (len(dir) < 0.5) return 0;
  let best = 0;
  for (const wall of walls) {
    if (wall.id === selfId) continue;
    const pts = dedupe(wall.points, wall.closed);
    const count = wall.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (!pointOnSegment(point, a, b, 6)) continue;
      const segDir = norm(sub(b, a));
      const sin = Math.abs(cross(segDir, dir));
      best = Math.max(best, (wall.thicknessMm / 2) * sin);
    }
  }
  return best;
}

function readableAngle(dir: Point): number {
  let angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  return angle;
}

function axisDir(dir: Point): Point {
  if (Math.abs(dir.x) >= Math.abs(dir.y) * 50) return { x: Math.sign(dir.x) || 1, y: 0 };
  if (Math.abs(dir.y) >= Math.abs(dir.x) * 50) return { x: 0, y: Math.sign(dir.y) || 1 };
  return dir;
}

function dimensionLine(midpoint: Point, dir: Point, clear: number, outward: Point, gap: number): [Point, Point] {
  const axis = axisDir(dir);
  const dimMid = add(midpoint, mul(outward, gap));
  const half = clear / 2;
  const dimA = roundPt(add(dimMid, mul(axis, -half)));
  if (axis.y === 0) return [dimA, { x: dimA.x + axis.x * clear, y: dimA.y }];
  if (axis.x === 0) return [dimA, { x: dimA.x, y: dimA.y + axis.y * clear }];
  return [dimA, roundPt(add(dimMid, mul(axis, half)))];
}

function layoutOne(wall: WallInput, all: readonly WallInput[]): WallLayout | null {
  const center = dedupe(wall.points, wall.closed);
  if (center.length < 2) return null;
  const thickness = Math.max(1, wall.thicknessMm);
  const half = thickness / 2;
  const left = offsetPolyline(center, half, wall.closed);
  const right = offsetPolyline(center, -half, wall.closed);
  if (left.length !== center.length || right.length !== center.length) return null;
  const ccw = !wall.closed || signedArea(center) > 0;
  const inside = ccw ? left : right;
  const outside = ccw ? right : left;
  const segCount = wall.closed ? center.length : center.length - 1;
  const segments: SegmentAnno[] = [];
  for (let i = 0; i < segCount; i++) {
    const c0 = center[i];
    const c1 = center[(i + 1) % center.length];
    const travel = norm(sub(c1, c0));
    if (len(travel) < 0.5) continue;
    let clear: number;
    let outward: Point;
    if (wall.closed) {
      const i0 = roundPt(inside[i]);
      const i1 = roundPt(inside[(i + 1) % inside.length]);
      clear = Math.max(0, roundMm(distance(i0, i1)));
      const away = norm(sub(mid(outside[i], outside[(i + 1) % outside.length]), mid(c0, c1)));
      outward = len(away) > 0.5 ? away : mul(leftNorm(travel), ccw ? -1 : 1);
    } else {
      clear = roundMm(distance(c0, c1));
      if (i === 0) clear -= roundMm(endInset(c0, travel, all, wall.id));
      if (i === segCount - 1) clear -= roundMm(endInset(c1, mul(travel, -1), all, wall.id));
      clear = Math.max(0, clear);
      outward = leftNorm(travel);
    }
    const gap = half + 220;
    const [dimA, dimB] = dimensionLine(mid(c0, c1), travel, clear, outward, gap);
    const extDrop = gap;
    const sideA: [Point, Point] = [roundPt(left[i]), roundPt(left[(i + 1) % left.length])];
    const sideB: [Point, Point] = [roundPt(right[i]), roundPt(right[(i + 1) % right.length])];
    segments.push({
      insideClearMm: clear,
      sideA,
      sideB,
      dimA,
      dimB,
      extA: [roundPt(add(dimA, mul(outward, -extDrop))), dimA],
      extB: [roundPt(add(dimB, mul(outward, -extDrop))), dimB],
      labelAt: roundPt(add(mid(dimA, dimB), mul(outward, 90))),
      angleDeg: readableAngle(axisDir(travel)),
    });
  }
  return {
    id: wall.id,
    thicknessMm: thickness,
    closed: wall.closed,
    center: center.map(roundPt),
    segments,
  };
}

export function layoutWalls(walls: readonly WallInput[]): WallLayout[] {
  const layouts: WallLayout[] = [];
  for (const wall of walls) {
    const layout = layoutOne(wall, walls);
    if (layout) layouts.push(layout);
  }
  return layouts;
}
