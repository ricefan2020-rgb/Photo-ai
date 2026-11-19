import { describe, expect, it } from "vitest";
import { evaluateScaleCheck, rotationToLevel } from "./calibrate";

const calibration = {
  a: { x: 0, y: 0 },
  b: { x: 1000, y: 0 },
  lengthMm: 1000,
};

describe("scale check", () => {
  it("allows a measurement 5 mm short", () => {
    const result = evaluateScaleCheck(calibration, {
      a: { x: 0, y: 0 },
      b: { x: 995, y: 0 },
      typedMm: 1000,
    });
    expect(result.scaleCheck.measuredMm).toBe(995);
    expect(result.scaleCheck.deltaMm).toBe(-5);
    expect(result.scaleCheck.ok).toBe(true);
    expect(result.scaleCheck.reason).toBe("ok");
    expect(result.blockReason).toBeNull();
  });

  it("blocks an over-length measurement", () => {
    const result = evaluateScaleCheck(calibration, {
      a: { x: 0, y: 0 },
      b: { x: 1001, y: 0 },
      typedMm: 1000,
    });
    expect(result.scaleCheck.measuredMm).toBe(1001);
    expect(result.scaleCheck.deltaMm).toBe(1);
    expect(result.scaleCheck.ok).toBe(false);
    expect(result.scaleCheck.reason).toBe("too_long");
    expect(result.blockReason).toMatch(/不准匯出/);
  });

  it("blocks a measurement more than 5 mm short", () => {
    const result = evaluateScaleCheck(calibration, {
      a: { x: 0, y: 0 },
      b: { x: 994, y: 0 },
      typedMm: 1000,
    });
    expect(result.scaleCheck.deltaMm).toBe(-6);
    expect(result.scaleCheck.ok).toBe(false);
    expect(result.scaleCheck.reason).toBe("too_short");
    expect(result.blockReason).not.toBeNull();
  });

  it("allows an exact match", () => {
    const result = evaluateScaleCheck(calibration, {
      a: { x: 10, y: 20 },
      b: { x: 3610, y: 20 },
      typedMm: 3600,
    });
    expect(result.scaleCheck.measuredMm).toBe(3600);
    expect(result.scaleCheck.ok).toBe(true);
    expect(result.blockReason).toBeNull();
  });

  it("blocks an over-length check on the other axis", () => {
    const result = evaluateScaleCheck(calibration, {
      a: { x: 0, y: 0 },
      b: { x: 0, y: 1005 },
      typedMm: 1000,
    });
    expect(result.scaleCheck.measuredMm).toBe(1005);
    expect(result.scaleCheck.reason).toBe("too_long");
    expect(result.blockReason).not.toBeNull();
  });
});

describe("rotationToLevel", () => {
  it("leaves a horizontal line at 0 degrees", () => {
    expect(rotationToLevel({ x: 0, y: 0 }, { x: 80, y: 0 })).toBe(0);
  });

  it("turns a downward line onto the horizontal", () => {
    expect(rotationToLevel({ x: 0, y: 0 }, { x: 0, y: 40 })).toBeCloseTo(-90);
  });
});
