import { estimateWallLevel, type GrayRaster, type LevelEstimate } from "../geom/level";

const FAILED: LevelEstimate = { rotationDeg: 0, confidence: 0, confident: false };

export async function readUpload(blob: Blob): Promise<{ width: number; height: number; level: LevelEstimate }> {
  const image = await loadHtmlImage(blob);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) throw new Error("無法讀取圖片");
  let level = FAILED;
  try {
    level = estimateWallLevel(grayFromImage(image, width, height));
  } catch {
    level = FAILED;
  }
  return { width, height, level };
}

function loadHtmlImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("無法讀取圖片"));
    };
    image.src = url;
  });
}

function grayFromImage(image: CanvasImageSource, width: number, height: number): GrayRaster {
  const maxSide = 720;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(8, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { width: w, height: h, gray: new Uint8Array(w * h).fill(255) };
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return { width: w, height: h, gray };
}
