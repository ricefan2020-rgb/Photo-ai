import { distance, type Point } from "../geom/points";
import type { SegmentAnno, WallLayout } from "../geom/walls";

export type DxfRoom = { name: string; at: Point };

const NL = "\r\n";

function num(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? `${rounded}.0` : String(rounded);
}

/** Keep the file ASCII. CAD reads \\U+XXXX as Unicode. */
export function encodeDxfText(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 10 || code === 13) continue;
    if (code >= 32 && code < 127 && ch !== "\\") out += ch;
    else if (ch === "\\") out += "\\\\";
    else out += `\\U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}

class Dxf {
  private lines: string[] = [];
  private handle = 0x400;

  nextHandle(): string {
    this.handle += 1;
    return this.handle.toString(16).toUpperCase();
  }

  pair(code: number, value: string | number): void {
    const integerCodes = new Set([62, 70, 71, 72, 73, 370]);
    let text: string;
    if (typeof value === "string") text = value;
    else if (integerCodes.has(code)) text = String(Math.trunc(value));
    else text = num(value);
    this.lines.push(String(code), text);
  }

  text(): string {
    return this.lines.join(NL) + NL;
  }
}

function pushTableStart(dxf: Dxf, name: string, handle: string, count: number): void {
  dxf.pair(0, "TABLE");
  dxf.pair(2, name);
  dxf.pair(5, handle);
  dxf.pair(330, "0");
  dxf.pair(100, "AcDbSymbolTable");
  dxf.pair(70, count);
}

function pushLayer(dxf: Dxf, handle: string, name: string, color: number): void {
  dxf.pair(0, "LAYER");
  dxf.pair(5, handle);
  dxf.pair(330, "2");
  dxf.pair(100, "AcDbSymbolTableRecord");
  dxf.pair(100, "AcDbLayerTableRecord");
  dxf.pair(2, name);
  dxf.pair(70, 0);
  dxf.pair(62, color);
  dxf.pair(6, "CONTINUOUS");
  dxf.pair(370, -3);
  dxf.pair(390, "F");
}

function pushLine(dxf: Dxf, layer: string, a: Point, b: Point): void {
  if (distance(a, b) < 0.5) return;
  dxf.pair(0, "LINE");
  dxf.pair(5, dxf.nextHandle());
  dxf.pair(330, "1F");
  dxf.pair(100, "AcDbEntity");
  dxf.pair(8, layer);
  dxf.pair(100, "AcDbLine");
  dxf.pair(10, a.x);
  dxf.pair(20, a.y);
  dxf.pair(30, 0);
  dxf.pair(11, b.x);
  dxf.pair(21, b.y);
  dxf.pair(31, 0);
}

function pushText(dxf: Dxf, layer: string, at: Point, height: number, value: string, angleDeg: number): void {
  const chunks: string[] = [];
  const chars = Array.from(value);
  for (let i = 0; i < chars.length; i += 24) chunks.push(chars.slice(i, i + 24).join(""));
  if (chunks.length === 0) return;
  chunks.forEach((chunk, index) => {
    const encoded = encodeDxfText(chunk);
    if (!encoded) return;
    const y = at.y - index * height * 1.4;
    dxf.pair(0, "TEXT");
    dxf.pair(5, dxf.nextHandle());
    dxf.pair(330, "1F");
    dxf.pair(100, "AcDbEntity");
    dxf.pair(8, layer);
    dxf.pair(100, "AcDbText");
    dxf.pair(10, at.x);
    dxf.pair(20, y);
    dxf.pair(30, 0);
    dxf.pair(40, height);
    dxf.pair(1, encoded);
    dxf.pair(50, angleDeg);
    dxf.pair(7, "STANDARD");
  });
}

function tick(dxf: Dxf, a: Point, b: Point): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = Math.hypot(dx, dy) || 1;
  const px = (-dy / span) * 40;
  const py = (dx / span) * 40;
  pushLine(dxf, "DIM", { x: a.x - px, y: a.y - py }, { x: a.x + px, y: a.y + py });
}

function pushSegment(dxf: Dxf, segment: SegmentAnno): void {
  pushLine(dxf, "WALL", segment.sideA[0], segment.sideA[1]);
  pushLine(dxf, "WALL", segment.sideB[0], segment.sideB[1]);
  if (segment.insideClearMm <= 0) return;
  pushLine(dxf, "DIM", segment.extA[0], segment.extA[1]);
  pushLine(dxf, "DIM", segment.extB[0], segment.extB[1]);
  pushLine(dxf, "DIM", segment.dimA, segment.dimB);
  tick(dxf, segment.dimA, segment.dimB);
  tick(dxf, segment.dimB, segment.dimA);
  pushText(dxf, "DIM", segment.labelAt, 140, String(segment.insideClearMm), segment.angleDeg);
}

function boundsOf(layouts: readonly WallLayout[], rooms: readonly DxfRoom[]): { minX: number; minY: number } {
  const points: Point[] = [];
  for (const layout of layouts) {
    for (const segment of layout.segments) {
      points.push(segment.sideA[0], segment.sideA[1], segment.sideB[0], segment.sideB[1], segment.dimA, segment.dimB, segment.labelAt);
    }
  }
  for (const room of rooms) points.push(room.at);
  if (points.length === 0) return { minX: 0, minY: 0 };
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
  };
}

export function writeDxf(input: {
  layouts: readonly WallLayout[];
  rooms: readonly DxfRoom[];
  notes: readonly string[];
}): string {
  const dxf = new Dxf();
  const header = [
    0, "SECTION",
    2, "HEADER",
    9, "$ACADVER",
    1, "AC1015",
    9, "$HANDSEED",
    5, "FFFF",
    9, "$INSUNITS",
    70, "4",
    9, "$MEASUREMENT",
    70, "1",
    9, "$LUNITS",
    70, "2",
    9, "$LUPREC",
    70, "0",
    0, "ENDSEC",
    0, "SECTION",
    2, "TABLES",
  ];
  for (let i = 0; i < header.length; i += 2) dxf.pair(Number(header[i]), String(header[i + 1]));

  pushTableStart(dxf, "LTYPE", "5", 1);
  dxf.pair(0, "LTYPE");
  dxf.pair(5, "14");
  dxf.pair(330, "5");
  dxf.pair(100, "AcDbSymbolTableRecord");
  dxf.pair(100, "AcDbLinetypeTableRecord");
  dxf.pair(2, "CONTINUOUS");
  dxf.pair(70, 0);
  dxf.pair(3, "Solid line");
  dxf.pair(72, 65);
  dxf.pair(73, 0);
  dxf.pair(40, 0);
  dxf.pair(0, "ENDTAB");

  pushTableStart(dxf, "LAYER", "2", 5);
  pushLayer(dxf, "10", "0", 7);
  pushLayer(dxf, "30", "WALL", 7);
  pushLayer(dxf, "31", "ROOM", 3);
  pushLayer(dxf, "32", "DIM", 1);
  pushLayer(dxf, "33", "NOTE", 1);
  dxf.pair(0, "ENDTAB");

  pushTableStart(dxf, "STYLE", "3", 1);
  dxf.pair(0, "STYLE");
  dxf.pair(5, "11");
  dxf.pair(330, "3");
  dxf.pair(100, "AcDbSymbolTableRecord");
  dxf.pair(100, "AcDbTextStyleTableRecord");
  dxf.pair(2, "STANDARD");
  dxf.pair(70, 0);
  dxf.pair(40, 0);
  dxf.pair(41, 1);
  dxf.pair(50, 0);
  dxf.pair(71, 0);
  dxf.pair(42, 1);
  dxf.pair(3, "PMingLiU.ttf");
  dxf.pair(4, "");
  dxf.pair(0, "ENDTAB");

  pushTableStart(dxf, "APPID", "9", 1);
  dxf.pair(0, "APPID");
  dxf.pair(5, "12");
  dxf.pair(330, "9");
  dxf.pair(100, "AcDbSymbolTableRecord");
  dxf.pair(100, "AcDbRegAppTableRecord");
  dxf.pair(2, "ACAD");
  dxf.pair(70, 0);
  dxf.pair(0, "ENDTAB");

  pushTableStart(dxf, "BLOCK_RECORD", "1", 2);
  for (const [handle, name] of [
    ["1F", "*MODEL_SPACE"],
    ["1B", "*PAPER_SPACE"],
  ] as const) {
    dxf.pair(0, "BLOCK_RECORD");
    dxf.pair(5, handle);
    dxf.pair(330, "1");
    dxf.pair(100, "AcDbSymbolTableRecord");
    dxf.pair(100, "AcDbBlockTableRecord");
    dxf.pair(2, name);
  }
  dxf.pair(0, "ENDTAB");
  dxf.pair(0, "ENDSEC");

  dxf.pair(0, "SECTION");
  dxf.pair(2, "BLOCKS");
  for (const [blockHandle, endHandle, owner, name] of [
    ["20", "21", "1F", "*MODEL_SPACE"],
    ["1C", "1D", "1B", "*PAPER_SPACE"],
  ] as const) {
    dxf.pair(0, "BLOCK");
    dxf.pair(5, blockHandle);
    dxf.pair(330, owner);
    dxf.pair(100, "AcDbEntity");
    dxf.pair(8, "0");
    dxf.pair(100, "AcDbBlockBegin");
    dxf.pair(2, name);
    dxf.pair(70, 0);
    dxf.pair(10, 0);
    dxf.pair(20, 0);
    dxf.pair(30, 0);
    dxf.pair(3, name);
    dxf.pair(1, "");
    dxf.pair(0, "ENDBLK");
    dxf.pair(5, endHandle);
    dxf.pair(330, owner);
    dxf.pair(100, "AcDbEntity");
    dxf.pair(8, "0");
    dxf.pair(100, "AcDbBlockEnd");
  }
  dxf.pair(0, "ENDSEC");

  dxf.pair(0, "SECTION");
  dxf.pair(2, "ENTITIES");
  for (const layout of input.layouts) {
    for (const segment of layout.segments) pushSegment(dxf, segment);
  }
  for (const room of input.rooms) {
    pushText(dxf, "ROOM", room.at, 250, room.name, 0);
  }
  const bounds = boundsOf(input.layouts, input.rooms);
  input.notes.forEach((note, index) => {
    pushText(dxf, "NOTE", { x: bounds.minX, y: bounds.minY - 600 - index * 320 }, 200, note, 0);
  });
  dxf.pair(0, "ENDSEC");
  dxf.pair(0, "EOF");
  return dxf.text();
}
