import { describe, expect, it } from "vitest";
import { rotationToLevel } from "./calibrate";
import { imagePxToWorld, worldLengthMm, worldToImagePx } from "./frame";

describe("frame", () => {
  it("puts screen-up on positive world Y", () => {
    const frame = { imageWidth: 200, imageHeight: 200, rotationDeg: 0, mmPerPx: 1 };
    const above = imagePxToWorld({ x: 100, y: 40 }, frame);
    expect(above.x).toBe(0);
    expect(above.y).toBe(60);
  });

  it("levels a tilted segment and keeps its length", () => {
    const a = { x: 100, y: 100 };
    const b = { x: 500, y: 140 };
    const frame = {
      imageWidth: 800,
      imageHeight: 600,
      rotationDeg: rotationToLevel(a, b),
      mmPerPx: 1,
    };
    const wa = imagePxToWorld(a, frame);
    const wb = imagePxToWorld(b, frame);
    expect(Math.abs(wa.y - wb.y)).toBeLessThanOrEqual(1);
    expect(wb.x).toBeGreaterThan(wa.x);
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    expect(Math.abs(worldLengthMm(wa, wb) - px)).toBeLessThanOrEqual(1);
  });

  it("round-trips a world point back to the image within half a pixel", () => {
    const frame = { imageWidth: 1200, imageHeight: 900, rotationDeg: 17, mmPerPx: 2 };
    const world = imagePxToWorld({ x: 240, y: 610 }, frame);
    const back = worldToImagePx(world, frame);
    expect(Math.abs(back.x - 240)).toBeLessThan(0.6);
    expect(Math.abs(back.y - 610)).toBeLessThan(0.6);
  });
});
