import type { Point } from "../geom/points";

export const PROJECT_VERSION = 1;
export const DEFAULT_WALL_THICKNESS_MM = 150;
export const SITE_MEASURE_WARNING = "此圖依平面圖繪製，下單前須現場丈量。";

export type Calibration = {
  a: Point;
  b: Point;
  lengthMm: number;
};

export type LengthCheck = {
  a: Point;
  b: Point;
  typedMm: number;
};

export type Wall = {
  id: string;
  /** Centreline clicks in source-image pixels, Y down, before rotation. */
  pointsPx: Point[];
  thicknessMm: number;
  closed: boolean;
};

export type RoomLabel = {
  id: string;
  name: string;
  atPx: Point;
};

export type Project = {
  version: 1;
  name: string;
  rotationDeg: number;
  leveled: boolean;
  /** True after upload found a wall angle and turned the sheet. */
  autoLeveled: boolean;
  imageWidth: number;
  imageHeight: number;
  calibration: Calibration | null;
  check: LengthCheck | null;
  walls: Wall[];
  rooms: RoomLabel[];
};

export function createProject(name = "未命名案子"): Project {
  return {
    version: PROJECT_VERSION,
    name,
    rotationDeg: 0,
    leveled: false,
    autoLeveled: false,
    imageWidth: 0,
    imageHeight: 0,
    calibration: null,
    check: null,
    walls: [],
    rooms: [],
  };
}

export function uid(): string {
  return crypto.randomUUID();
}

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Point;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isWall(value: unknown): value is Wall {
  if (!value || typeof value !== "object") return false;
  const wall = value as Wall;
  return (
    typeof wall.id === "string" &&
    Array.isArray(wall.pointsPx) &&
    wall.pointsPx.every(isPoint) &&
    Number.isFinite(wall.thicknessMm) &&
    typeof wall.closed === "boolean"
  );
}

function isRoom(value: unknown): value is RoomLabel {
  if (!value || typeof value !== "object") return false;
  const room = value as RoomLabel;
  return typeof room.id === "string" && typeof room.name === "string" && isPoint(room.atPx);
}

export function sanitizeProject(value: unknown): Project | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Project>;
  if (raw.version !== PROJECT_VERSION) return null;
  if (typeof raw.name !== "string") return null;
  if (!Array.isArray(raw.walls) || !raw.walls.every(isWall)) return null;
  if (!Array.isArray(raw.rooms) || !raw.rooms.every(isRoom)) return null;
  const calibration = raw.calibration;
  if (
    calibration !== null &&
    (!calibration || !isPoint(calibration.a) || !isPoint(calibration.b) || !(calibration.lengthMm > 0))
  ) {
    return null;
  }
  const check = raw.check;
  if (check !== null && (!check || !isPoint(check.a) || !isPoint(check.b) || !(check.typedMm > 0))) {
    return null;
  }
  return {
    version: PROJECT_VERSION,
    name: raw.name,
    rotationDeg: Number.isFinite(raw.rotationDeg) ? raw.rotationDeg! : 0,
    leveled: Boolean(raw.leveled),
    autoLeveled: Boolean(raw.autoLeveled),
    imageWidth: Number.isFinite(raw.imageWidth) ? raw.imageWidth! : 0,
    imageHeight: Number.isFinite(raw.imageHeight) ? raw.imageHeight! : 0,
    calibration: calibration ?? null,
    check: check ?? null,
    walls: raw.walls,
    rooms: raw.rooms.map((room) => ({ ...room, name: room.name.trim() })).filter((room) => room.name),
  };
}
