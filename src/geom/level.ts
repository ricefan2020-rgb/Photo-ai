import { normalizeDeg } from "./calibrate";

/**
 * Deskew a sales-plan scan or a screenshot of a rotated page.
 *
 * Walls and dimension lines share one axis pair. The rotation returned is the
 * clockwise Konva angle (same sign as Frame.rotationDeg) that puts that pair
 * on the horizontal and the vertical. A weak peak leaves the sheet alone.
 *
 * Edge pixels near the middle of the sheet count more than the border, so a
 * rotated brochure inside a straight screenshot still wins over the window chrome.
 */
export type GrayRaster = {
  width: number;
  height: number;
  /** 0 is black ink, 255 is white paper. Row-major. */
  gray: Uint8Array;
};

export type LevelEstimate = {
  /** Clockwise degrees. Zero when the sheet should stay as uploaded. */
  rotationDeg: number;
  /** 0–1 peak strength. */
  confidence: number;
  confident: boolean;
};

const NONE: LevelEstimate = { rotationDeg: 0, confidence: 0, confident: false };

/** Below this, the page has no dominant wall direction. */
const MIN_CONFIDENCE = 0.045;
const MIN_SHARPNESS = 0.04;
const MIN_POINTS = 80;

export function estimateWallLevel(raster: GrayRaster): LevelEstimate {
  const points = collectEdges(raster);
  if (points.n < MIN_POINTS) return NONE;

  const diag = Math.hypot(raster.width, raster.height);
  const binSize = 1;
  const bins = Math.ceil(diag) + 8;
  const hx = new Float64Array(bins);
  const hy = new Float64Array(bins);
  const scoreAt = (deg: number) => axisEnergy(points, deg, bins, binSize, hx, hy);

  const coarseStep = 0.5;
  const coarseN = 180;
  const scores = new Float64Array(coarseN);
  let bestI = 0;
  for (let i = 0; i < coarseN; i++) {
    const deg = -45 + i * coarseStep;
    scores[i] = scoreAt(deg);
    if (scores[i] > scores[bestI]) bestI = i;
  }

  let bestDeg = -45 + bestI * coarseStep;
  let bestScore = scores[bestI];
  const fineStep = 0.05;
  for (let delta = -coarseStep; delta <= coarseStep + 1e-9; delta += fineStep) {
    const deg = foldRotation(bestDeg + delta);
    const value = scoreAt(deg);
    if (value > bestScore) {
      bestScore = value;
      bestDeg = deg;
    }
  }

  const refined = refinePeak(bestDeg, fineStep, scoreAt);
  const refinedScore = scoreAt(refined);
  if (refinedScore >= bestScore) {
    bestDeg = refined;
    bestScore = refinedScore;
  }

  const away = scoreAt(foldRotation(bestDeg + 8));
  const sorted = Array.from(scores).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const confidence = bestScore > 0 ? (bestScore - median) / bestScore : 0;
  const sharpness = bestScore > 0 ? (bestScore - away) / bestScore : 0;
  const confident = confidence >= MIN_CONFIDENCE && sharpness >= MIN_SHARPNESS;
  if (!confident || !Number.isFinite(bestDeg)) return { rotationDeg: 0, confidence, confident: false };
  return { rotationDeg: normalizeDeg(foldRotation(bestDeg)), confidence, confident: true };
}

/** Signed deskew in (-45, 45]. Rotations 90° apart level the same walls. */
function foldRotation(deg: number): number {
  let wrapped = normalizeDeg(deg);
  while (wrapped > 45) wrapped -= 90;
  while (wrapped <= -45) wrapped += 90;
  return wrapped;
}

type EdgePoints = {
  xs: Float64Array;
  ys: Float64Array;
  ws: Float64Array;
  n: number;
};

function collectEdges(raster: GrayRaster): EdgePoints {
  const { width, height, gray } = raster;
  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  const cx = width / 2;
  const cy = height / 2;
  const contrast = 32;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const v = gray[row + x];
      const darker =
        v + contrast <= gray[row + x - 1] ||
        v + contrast <= gray[row + x + 1] ||
        v + contrast <= gray[row - width + x] ||
        v + contrast <= gray[row + width + x];
      if (!darker) continue;
      const wx = 1 - Math.abs(x - cx) / cx;
      const wy = 1 - Math.abs(y - cy) / cy;
      const weight = wx * wx * wy * wy;
      if (weight < 0.004) continue;
      xs.push(x - cx);
      ys.push(y - cy);
      ws.push(weight);
    }
  }

  const total = xs.length;
  const cap = 8000;
  const stride = total > cap ? Math.ceil(total / cap) : 1;
  const n = Math.ceil(total / stride);
  const outX = new Float64Array(n);
  const outY = new Float64Array(n);
  const outW = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < total; i += stride) {
    outX[j] = xs[i];
    outY[j] = ys[i];
    outW[j] = ws[i];
    j++;
  }
  return { xs: outX, ys: outY, ws: outW, n: j };
}

function axisEnergy(
  points: EdgePoints,
  rotationDeg: number,
  bins: number,
  binSize: number,
  hx: Float64Array,
  hy: Float64Array,
): number {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  hx.fill(0);
  hy.fill(0);
  const origin = (bins - 1) / 2;
  const { xs, ys, ws, n } = points;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    const ix = (origin + rx / binSize) | 0;
    const iy = (origin + ry / binSize) | 0;
    if (ix >= 0 && ix < bins) hx[ix] += ws[i];
    if (iy >= 0 && iy < bins) hy[iy] += ws[i];
  }
  let energy = 0;
  for (let i = 0; i < bins; i++) energy += hx[i] * hx[i] + hy[i] * hy[i];
  return energy;
}

function refinePeak(bestDeg: number, step: number, scoreAt: (deg: number) => number): number {
  const left = scoreAt(foldRotation(bestDeg - step));
  const mid = scoreAt(bestDeg);
  const right = scoreAt(foldRotation(bestDeg + step));
  const denom = left - 2 * mid + right;
  if (!(denom < 0)) return bestDeg;
  const delta = (0.5 * (left - right)) / denom;
  if (delta < -1 || delta > 1 || !Number.isFinite(delta)) return bestDeg;
  return foldRotation(bestDeg + delta * step);
}
