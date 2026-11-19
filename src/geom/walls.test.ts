import { describe, expect, it } from "vitest";
import { distance } from "./points";
import { layoutWalls } from "./walls";

const square = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 3000 },
  { x: 0, y: 3000 },
];

describe("walls", () => {
  it("offsets a closed centreline into double lines and labels the inside clear", () => {
    const [wall] = layoutWalls([{ id: "room", points: square, thicknessMm: 150, closed: true }]);
    expect(wall.segments).toHaveLength(4);
    const clears = wall.segments.map((s) => s.insideClearMm).sort((a, b) => a - b);
    expect(clears).toEqual([2850, 2850, 3850, 3850]);
    const bottom = wall.segments[0];
    expect(bottom.sideA[0].y).toBe(75);
    expect(bottom.sideA[1].y).toBe(75);
    expect(bottom.sideB[0].y).toBe(-75);
    expect(Math.round(distance(bottom.dimA, bottom.dimB))).toBe(3850);
    expect(bottom.dimA.y).toBeLessThan(0);
  });

  it("shortens an open partition by half the walls it meets", () => {
    const [partition] = layoutWalls([
      { id: "shell", points: square, thicknessMm: 150, closed: true },
      {
        id: "part",
        points: [
          { x: 2000, y: 0 },
          { x: 2000, y: 3000 },
        ],
        thicknessMm: 120,
        closed: false,
      },
    ]).filter((w) => w.id === "part");
    expect(partition.segments).toHaveLength(1);
    expect(partition.segments[0].insideClearMm).toBe(2850);
    expect(Math.round(distance(partition.segments[0].dimA, partition.segments[0].dimB))).toBe(2850);
  });
});
