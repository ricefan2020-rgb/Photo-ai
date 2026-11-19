import { describe, expect, it } from "vitest";
import { imagePxToWorld } from "../geom/frame";
import { distance } from "../geom/points";
import { layoutWalls } from "../geom/walls";
import { SITE_MEASURE_WARNING } from "../model/project";
import { encodeDxfText, writeDxf } from "./write";

function isAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 127) return false;
  }
  return true;
}

type DxfLine = { layer: string; x1: number; y1: number; x2: number; y2: number };

function parseLines(dxf: string): DxfLine[] {
  const rows = dxf.split(/\r?\n/);
  const lines: DxfLine[] = [];
  for (let i = 0; i < rows.length - 1; i += 2) {
    if (rows[i] !== "0" || rows[i + 1] !== "LINE") continue;
    const record: Record<string, string> = {};
    for (let j = i + 2; j < rows.length - 1; j += 2) {
      if (rows[j] === "0") break;
      record[rows[j]] = rows[j + 1];
    }
    lines.push({
      layer: record["8"] ?? "",
      x1: Number(record["10"]),
      y1: Number(record["20"]),
      x2: Number(record["11"]),
      y2: Number(record["21"]),
    });
  }
  return lines;
}

describe("writeDxf", () => {
  it("writes ASCII millimetre DXF and keeps the calibrated length", () => {
    const frame = { imageWidth: 1000, imageHeight: 800, rotationDeg: 0, mmPerPx: 10 };
    const a = imagePxToWorld({ x: 100, y: 400 }, frame);
    const b = imagePxToWorld({ x: 500, y: 400 }, frame);
    expect(Math.round(distance(a, b))).toBe(4000);
    const layouts = layoutWalls([{ id: "w", points: [a, b], thicknessMm: 150, closed: false }]);
    const dxf = writeDxf({
      layouts,
      rooms: [{ name: "主臥", at: { x: 0, y: 200 } }],
      notes: [SITE_MEASURE_WARNING],
    });
    expect(isAscii(dxf)).toBe(true);
    expect(dxf).toMatch(/\$ACADVER\r\n1\r\nAC1015/);
    expect(dxf).toMatch(/\$INSUNITS\r\n70\r\n4/);
    expect(dxf).toMatch(/\$MEASUREMENT\r\n70\r\n1/);
    expect(dxf).toContain("\r\nWALL\r\n");
    expect(dxf).toContain("\r\nROOM\r\n");
    expect(dxf).toContain("\r\nDIM\r\n");
    expect(dxf).toContain("\r\nNOTE\r\n");
    expect(dxf).toContain(encodeDxfText("主臥"));
    expect(dxf).toContain(encodeDxfText(SITE_MEASURE_WARNING));
    expect(dxf).not.toContain("主臥");
    const wallLines = parseLines(dxf).filter((line) => line.layer === "WALL");
    const lengths = wallLines.map((line) => Math.hypot(line.x2 - line.x1, line.y2 - line.y1));
    expect(lengths.some((length) => Math.abs(length - 4000) <= 1)).toBe(true);
  });
});
