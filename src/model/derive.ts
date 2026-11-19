import {
  ALLOWED_SHORT_MM,
  assessCheck,
  exportBlockReason,
  measureLengthMm,
  mmPerPixel,
  type ScaleCheck,
} from "../geom/calibrate";
import { imagePxToWorld, type Frame } from "../geom/frame";
import type { Point } from "../geom/points";
import { layoutWalls, type WallInput, type WallLayout } from "../geom/walls";
import type { Project } from "./project";

export type DerivedRoom = {
  id: string;
  name: string;
  atPx: Point;
  at: Point;
};

export type Derived = {
  mmPerPx: number | null;
  frame: Frame | null;
  scaleCheck: ScaleCheck | null;
  blockReason: string | null;
  layouts: WallLayout[];
  rooms: DerivedRoom[];
  wallInputs: WallInput[];
};

export function toleranceNote(): string {
  return `單位：公厘。覆核可以比圖上短 ${ALLOWED_SHORT_MM} mm，不可以長過。`;
}

export function derive(project: Project): Derived {
  const hasImage = project.imageWidth > 0 && project.imageHeight > 0;
  let mmPerPx: number | null = null;
  if (project.calibration) {
    try {
      mmPerPx = mmPerPixel(
        project.calibration.a,
        project.calibration.b,
        project.calibration.lengthMm,
      );
    } catch {
      mmPerPx = null;
    }
  }
  const frame: Frame | null =
    mmPerPx !== null && hasImage
      ? {
          imageWidth: project.imageWidth,
          imageHeight: project.imageHeight,
          rotationDeg: project.rotationDeg,
          mmPerPx,
        }
      : null;

  let scaleCheck: ScaleCheck | null = null;
  if (project.check && mmPerPx !== null) {
    scaleCheck = assessCheck(measureLengthMm(project.check.a, project.check.b, mmPerPx), project.check.typedMm);
  }

  const wallInputs: WallInput[] = frame
    ? project.walls.map((wall) => ({
        id: wall.id,
        thicknessMm: wall.thicknessMm,
        closed: wall.closed,
        points: wall.pointsPx.map((point) => imagePxToWorld(point, frame)),
      }))
    : [];

  return {
    mmPerPx,
    frame,
    scaleCheck,
    blockReason: exportBlockReason({
      hasImage,
      hasCalibration: mmPerPx !== null,
      scaleCheck,
    }),
    layouts: layoutWalls(wallInputs),
    rooms: frame
      ? project.rooms.map((room) => ({
          id: room.id,
          name: room.name,
          atPx: room.atPx,
          at: imagePxToWorld(room.atPx, frame),
        }))
      : [],
    wallInputs,
  };
}
