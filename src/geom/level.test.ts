import { describe, expect, it } from "vitest";
import { imagePxToWorld } from "./frame";
import { estimateWallLevel, type GrayRaster } from "./level";
import type { Point } from "./points";

function tiltAround(point: Point, deg: number, center: Point): Point {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function stamp(gray: Uint8Array, width: number, height: number, x: number, y: number, ink = 18) {
  const radius = 1.7;
  const x0 = Math.floor(x - radius);
  const y0 = Math.floor(y - radius);
  const x1 = Math.ceil(x + radius);
  const y1 = Math.ceil(y + radius);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const dx = xx - x;
      const dy = yy - y;
      if (dx * dx + dy * dy > radius * radius) continue;
      gray[yy * width + xx] = ink;
    }
  }
}

function stroke(gray: Uint8Array, width: number, height: number, a: Point, b: Point) {
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(span * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stamp(gray, width, height, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type DrawnPlan = {
  raster: GrayRaster;
  wallA: Point;
  wallB: Point;
};

/** Axis-aligned room, partition, and a dimension line, then rotated by `tiltDeg`. */
function drawTiltedPlan(tiltDeg: number, noise = 0): DrawnPlan {
  const width = 360;
  const height = 260;
  const center = { x: width / 2, y: height / 2 };
  const gray = new Uint8Array(width * height);
  gray.fill(244);
  const topA = { x: 78, y: 58 };
  const topB = { x: 286, y: 58 };
  const upright: Array<[Point, Point]> = [
    [topA, topB],
    [topB, { x: 286, y: 206 }],
    [{ x: 286, y: 206 }, { x: 78, y: 206 }],
    [{ x: 78, y: 206 }, topA],
    [{ x: 176, y: 58 }, { x: 176, y: 206 }],
    [{ x: 78, y: 40 }, { x: 286, y: 40 }],
    [{ x: 78, y: 34 }, { x: 78, y: 48 }],
    [{ x: 286, y: 34 }, { x: 286, y: 48 }],
    [{ x: 302, y: 58 }, { x: 302, y: 206 }],
  ];
  for (const [a, b] of upright) {
    stroke(gray, width, height, tiltAround(a, tiltDeg, center), tiltAround(b, tiltDeg, center));
  }
  if (noise > 0) {
    const rand = mulberry32(1000 + Math.round(tiltDeg * 10));
    for (let i = 0; i < noise; i++) {
      const x = Math.floor(rand() * width);
      const y = Math.floor(rand() * height);
      gray[y * width + x] = 30;
    }
  }
  return {
    raster: { width, height, gray },
    wallA: tiltAround(topA, tiltDeg, center),
    wallB: tiltAround(topB, tiltDeg, center),
  };
}

function expectLevel(tiltDeg: number, plan = drawTiltedPlan(tiltDeg, 500)) {
  const estimate = estimateWallLevel(plan.raster);
  expect(estimate.confident, `tilt ${tiltDeg}`).toBe(true);
  expect(Math.abs(estimate.rotationDeg + tiltDeg), `rotation ${estimate.rotationDeg}`).toBeLessThan(0.45);
  const frame = {
    imageWidth: plan.raster.width,
    imageHeight: plan.raster.height,
    rotationDeg: estimate.rotationDeg,
    mmPerPx: 1,
  };
  const a = imagePxToWorld(plan.wallA, frame);
  const b = imagePxToWorld(plan.wallB, frame);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(2);
  expect(b.x).toBeGreaterThan(a.x + 80);
}

describe("estimateWallLevel", () => {
  it("levels a sheet whose walls and dimension lines sit at a known tilt", () => {
    expectLevel(12.4);
    expectLevel(-17.8);
    expectLevel(33.2);
  });

  it("leaves an already level plan level", () => {
    expectLevel(0);
  });

  it("follows the tilted plan in the middle, not the straight frame around it", () => {
    const tilt = 14.6;
    const plan = drawTiltedPlan(tilt, 200);
    const { width, height, gray } = plan.raster;
    for (const y of [6, 12, 18, height - 8, height - 14]) {
      stroke(gray, width, height, { x: 8, y }, { x: width - 8, y });
    }
    for (const x of [6, 12, width - 8]) {
      stroke(gray, width, height, { x, y: 8 }, { x, y: height - 8 });
    }
    expectLevel(tilt, plan);
  });

  it("does not rotate a blank page", () => {
    const width = 200;
    const height = 140;
    const gray = new Uint8Array(width * height);
    gray.fill(255);
    const estimate = estimateWallLevel({ width, height, gray });
    expect(estimate.confident).toBe(false);
    expect(estimate.rotationDeg).toBe(0);
  });
});
