import { PDFDocument } from "pdf-lib";
import type { Point } from "../geom/points";
import type { WallLayout } from "../geom/walls";

const FONT =
  '"Droid Sans Fallback", "WenQuanYi Micro Hei", "PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", "Noto Sans TC", sans-serif';

export type PreviewRoom = { name: string; at: Point };

function collectPoints(layouts: readonly WallLayout[], rooms: readonly PreviewRoom[]): Point[] {
  const points: Point[] = [];
  for (const layout of layouts) {
    for (const segment of layout.segments) {
      points.push(
        segment.sideA[0],
        segment.sideA[1],
        segment.sideB[0],
        segment.sideB[1],
        segment.dimA,
        segment.dimB,
        segment.labelAt,
      );
    }
  }
  for (const room of rooms) points.push(room.at);
  return points;
}

export async function buildPreviewPdf(input: {
  layouts: readonly WallLayout[];
  rooms: readonly PreviewRoom[];
  notes: readonly string[];
}): Promise<Uint8Array> {
  await document.fonts.ready;
  const width = 2480;
  const height = 1754;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法建立預覽");

  ctx.fillStyle = "#f6f0e4";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#1c1915";
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, width - 56, height - 56);

  ctx.fillStyle = "#1c1915";
  ctx.font = `600 54px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("配置圖", 72, 86);
  ctx.font = `28px ${FONT}`;
  ctx.fillStyle = "#5e564c";
  ctx.fillText("單位：公厘", 250, 86);

  const margin = 80;
  const top = 130;
  const footer = 168;
  const plotLeft = margin;
  const plotTop = top;
  const plotWidth = width - margin * 2;
  const plotHeight = height - top - footer;
  const points = collectPoints(input.layouts, input.rooms);
  let minX = 0;
  let minY = 0;
  let maxX = 1000;
  let maxY = 1000;
  if (points.length > 0) {
    minX = Math.min(...points.map((p) => p.x));
    minY = Math.min(...points.map((p) => p.y));
    maxX = Math.max(...points.map((p) => p.x));
    maxY = Math.max(...points.map((p) => p.y));
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((plotWidth - 40) / spanX, (plotHeight - 40) / spanY);
  const usedW = spanX * scale;
  const usedH = spanY * scale;
  const originX = plotLeft + (plotWidth - usedW) / 2;
  const originY = plotTop + (plotHeight - usedH) / 2;

  const map = (point: Point) => ({
    x: originX + (point.x - minX) * scale,
    y: originY + (maxY - point.y) * scale,
  });

  ctx.lineWidth = Math.max(1.6, scale * 10);
  ctx.lineCap = "square";
  ctx.strokeStyle = "#1a1a1a";
  for (const layout of input.layouts) {
    for (const segment of layout.segments) {
      for (const side of [segment.sideA, segment.sideB]) {
        const a = map(side[0]);
        const b = map(side[1]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  ctx.strokeStyle = "#8a3b12";
  ctx.fillStyle = "#8a3b12";
  ctx.lineWidth = Math.max(1.2, scale * 4);
  ctx.font = `${Math.max(18, Math.min(42, scale * 140))}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const layout of input.layouts) {
    for (const segment of layout.segments) {
      if (segment.insideClearMm <= 0) continue;
      const a = map(segment.dimA);
      const b = map(segment.dimB);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const label = map(segment.labelAt);
      let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg <= -90) deg += 180;
      ctx.save();
      ctx.translate(label.x, label.y);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.fillText(String(segment.insideClearMm), 0, 0);
      ctx.restore();
    }
  }

  ctx.fillStyle = "#16382c";
  ctx.font = `600 ${Math.max(22, Math.min(64, scale * 250))}px ${FONT}`;
  for (const room of input.rooms) {
    const at = map(room.at);
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.fillText(room.name, 0, 0);
    ctx.restore();
  }

  const bandTop = height - footer + 16;
  ctx.fillStyle = "#f4d4cb";
  ctx.fillRect(64, bandTop, width - 128, footer - 48);
  ctx.fillStyle = "#8d2a1c";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 40px ${FONT}`;
  ctx.fillText(input.notes[0] ?? "", 88, bandTop + 52);
  ctx.font = `26px ${FONT}`;
  if (input.notes[1]) ctx.fillText(input.notes[1], 88, bandTop + 92);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("無法轉出預覽"))), "image/png");
  });
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  const pdf = await PDFDocument.create();
  pdf.setTitle("配置圖");
  pdf.setSubject(input.notes[0] ?? "");
  pdf.setCreator("floor-plan-cad");
  const image = await pdf.embedPng(pngBytes);
  const page = pdf.addPage([1190.55, 841.89]);
  page.drawImage(image, { x: 0, y: 0, width: 1190.55, height: 841.89 });
  return pdf.save();
}
