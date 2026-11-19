import { distance, type Point } from "./points";

/**
 * Official sales plans are checked against a second printed length.
 * The measured length may be up to 5 mm short of the typed length, and must
 * never be longer. Anything outside that blocks DXF and PDF export.
 */
export const ALLOWED_SHORT_MM = 5;

export type CheckReason = "ok" | "too_long" | "too_short" | "invalid";

export type ScaleCheck = {
  measuredMm: number;
  typedMm: number;
  /** measured − typed. Negative means the check came out short. */
  deltaMm: number;
  allowedShortMm: number;
  ok: boolean;
  reason: CheckReason;
};

export function mmPerPixel(a: Point, b: Point, lengthMm: number): number {
  if (!(lengthMm > 0)) throw new Error("長度必須大於 0");
  const span = distance(a, b);
  if (span < 1e-6) throw new Error("兩個校正點太近");
  return lengthMm / span;
}

export function measureLengthMm(a: Point, b: Point, pxToMm: number): number {
  return Math.round(distance(a, b) * pxToMm);
}

export function assessCheck(
  measuredMm: number,
  typedMm: number,
  allowedShortMm = ALLOWED_SHORT_MM,
): ScaleCheck {
  const measured = Math.round(measuredMm);
  const typed = Math.round(typedMm);
  const deltaMm = measured - typed;
  const base = { measuredMm: measured, typedMm: typed, deltaMm, allowedShortMm };
  if (!(typed > 0) || !Number.isFinite(measured) || measured < 0) {
    return { ...base, ok: false, reason: "invalid" };
  }
  if (deltaMm > 0) return { ...base, ok: false, reason: "too_long" };
  if (deltaMm < -allowedShortMm) return { ...base, ok: false, reason: "too_short" };
  return { ...base, ok: true, reason: "ok" };
}

export function exportBlockReason(input: {
  hasImage: boolean;
  hasCalibration: boolean;
  scaleCheck: ScaleCheck | null;
}): string | null {
  if (!input.hasImage) return "請先上傳平面圖";
  if (!input.hasCalibration) return "請先用兩個已知點校正比例";
  if (!input.scaleCheck) return "請再用另一段已知長度覆核";
  if (input.scaleCheck.ok) return null;
  return describeCheck(input.scaleCheck);
}

export function describeCheck(check: ScaleCheck): string {
  if (check.reason === "invalid") return "請輸入大於 0 的公厘長度";
  if (check.reason === "too_long") {
    return `實測 ${check.measuredMm} mm，比圖上 ${check.typedMm} mm 長 ${check.deltaMm} mm，不准匯出`;
  }
  if (check.reason === "too_short") {
    return `實測 ${check.measuredMm} mm，比圖上 ${check.typedMm} mm 短 ${-check.deltaMm} mm，超過容許的 ${check.allowedShortMm} mm，不准匯出`;
  }
  if (check.deltaMm === 0) return `實測 ${check.measuredMm} mm，與圖上相同，可以匯出`;
  return `實測 ${check.measuredMm} mm，比圖上短 ${-check.deltaMm} mm，在容許的 ${check.allowedShortMm} mm 內，可以匯出`;
}

export type ScaleEndpoints = { a: Point; b: Point; lengthMm: number };
export type CheckEndpoints = { a: Point; b: Point; typedMm: number };

/** Two-point scale, then the second printed length. This is what blocks export. */
export function evaluateScaleCheck(
  calibration: ScaleEndpoints,
  check: CheckEndpoints,
  allowedShortMm = ALLOWED_SHORT_MM,
): { scaleCheck: ScaleCheck; blockReason: string | null } {
  const pxToMm = mmPerPixel(calibration.a, calibration.b, calibration.lengthMm);
  const measured = measureLengthMm(check.a, check.b, pxToMm);
  const scaleCheck = assessCheck(measured, check.typedMm, allowedShortMm);
  const blockReason = exportBlockReason({
    hasImage: true,
    hasCalibration: true,
    scaleCheck,
  });
  return { scaleCheck, blockReason };
}

/** Clockwise Konva rotation that makes the image-pixel segment level, pointing right. */
export function rotationToLevel(a: Point, b: Point): number {
  const rad = Math.atan2(b.y - a.y, b.x - a.x);
  return normalizeDeg((-rad * 180) / Math.PI);
}

export function normalizeDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let wrapped = ((deg + 180) % 360 + 360) % 360 - 180;
  if (wrapped === -180) wrapped = 180;
  return wrapped;
}
