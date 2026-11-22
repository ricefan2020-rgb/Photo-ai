import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Stage, Text } from "react-konva";
import type { Point } from "../geom/points";
import { rotatedPixelBounds, worldToImagePx } from "../geom/frame";
import type { Derived } from "../model/derive";
import type { Project } from "../model/project";

export type EditorTool = "straighten" | "calibrate" | "check" | "wall" | "room" | "pan";

type Props = {
  imageUrl: string | null;
  project: Project;
  derived: Derived;
  tool: EditorTool;
  draft: Point[];
  selectedWallId: string | null;
  fitNonce: number;
  onPick: (point: Point) => void;
};

type View = { x: number; y: number; scale: number };

const FONT =
  '"Droid Sans Fallback", "WenQuanYi Micro Hei", "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';

function useHtmlImage(url: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) {
      setImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = url;
    return () => {
      img.onload = null;
    };
  }, [url]);
  return image;
}

function projectOnSegment(p: Point, a: Point, b: Point): Point | null {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-6) return null;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  if (t < 0 || t > 1) return null;
  return { x: a.x + t * abx, y: a.y + t * aby };
}

function textOffset(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    width += code > 255 ? fontSize : fontSize * 0.62;
  }
  return width / 2;
}

function uprightRotation(localDeg: number, viewRotation: number): number {
  let screen = localDeg + viewRotation;
  screen = ((screen + 180) % 360 + 360) % 360 - 180;
  if (screen > 90 || screen <= -90) return localDeg + 180;
  return localDeg;
}

function drawLoupe(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  point: Point,
  rotationDeg: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  const zoom = 6;
  const span = size / zoom;
  ctx.fillStyle = "#171512";
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.drawImage(image, point.x - span / 2, point.y - span / 2, span, span, -size / 2, -size / 2, size, size);
  ctx.restore();
  ctx.strokeStyle = "#c24b32";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size / 2, 10);
  ctx.lineTo(size / 2, size - 10);
  ctx.moveTo(10, size / 2);
  ctx.lineTo(size - 10, size / 2);
  ctx.stroke();
}

export function CanvasView({
  imageUrl,
  project,
  derived,
  tool,
  draft,
  selectedWallId,
  fitNonce,
  onPick,
}: Props) {
  const image = useHtmlImage(imageUrl);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const groupRef = useRef<Konva.Group>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const space = useRef(false);
  const drag = useRef<{ x: number; y: number; panning: boolean } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!project.imageWidth || size.width < 40 || size.height < 40) return;
    const bounds = rotatedPixelBounds(project.imageWidth, project.imageHeight, project.rotationDeg);
    const scale = Math.min((size.width - 48) / bounds.width, (size.height - 48) / bounds.height);
    const next = Math.max(0.02, Math.min(scale, 12));
    setView({
      scale: next,
      x: size.width / 2 - (project.imageWidth / 2) * next,
      y: size.height / 2 - (project.imageHeight / 2) * next,
    });
    // Slider tweaks should not throw away the user's pan. 90° turns bump fitNonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, fitNonce, size.width, size.height]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        space.current = true;
        event.preventDefault();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  function toImage(): Point | null {
    const stage = stageRef.current;
    const group = groupRef.current;
    if (!stage || !group) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    const point = group.getAbsoluteTransform().copy().invert().point(pointer);
    return { x: point.x, y: point.y };
  }

  function snap(point: Point): Point {
    if (tool !== "wall") return point;
    if (draft.length >= 3) {
      const close = Math.hypot(draft[0].x - point.x, draft[0].y - point.y);
      if (close < 18 / view.scale) return draft[0];
    }
    const limit = 14 / view.scale;
    let best = point;
    let bestD = limit;
    const consider = (candidate: Point) => {
      const span = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (span < bestD) {
        best = candidate;
        bestD = span;
      }
    };
    for (const wall of project.walls) {
      const pts = wall.pointsPx;
      pts.forEach(consider);
      const count = wall.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < count; i++) {
        const projected = projectOnSegment(point, pts[i], pts[(i + 1) % pts.length]);
        if (projected) consider(projected);
      }
    }
    return best;
  }

  function onWheel(event: Konva.KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const factor = event.evt.deltaY < 0 ? 1.08 : 1 / 1.08;
    setView((current) => {
      const scale = Math.max(0.02, Math.min(40, current.scale * factor));
      const imageX = (pointer.x - current.x) / current.scale;
      const imageY = (pointer.y - current.y) / current.scale;
      return { scale, x: pointer.x - imageX * scale, y: pointer.y - imageY * scale };
    });
  }

  function onMouseDown(event: Konva.KonvaEventObject<MouseEvent>) {
    const panning = tool === "pan" || event.evt.button === 1 || event.evt.button === 2 || space.current;
    drag.current = { x: event.evt.clientX, y: event.evt.clientY, panning };
  }

  function onMouseMove(event: Konva.KonvaEventObject<MouseEvent>) {
    const point = toImage();
    if (point && image && loupeRef.current) drawLoupe(loupeRef.current, image, point, project.rotationDeg);
    const current = drag.current;
    if (!current?.panning) return;
    const dx = event.evt.clientX - current.x;
    const dy = event.evt.clientY - current.y;
    current.x = event.evt.clientX;
    current.y = event.evt.clientY;
    setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }

  function onMouseUp(event: Konva.KonvaEventObject<MouseEvent>) {
    const current = drag.current;
    drag.current = null;
    if (!current || current.panning) return;
    if (Math.hypot(event.evt.clientX - current.x, event.evt.clientY - current.y) > 4) return;
    const point = toImage();
    if (!point) return;
    onPick(snap(point));
  }

  const frame = derived.frame;
  const dimSize = frame ? Math.max(13, Math.min(64, 150 / frame.mmPerPx)) : 16;
  const roomSize = frame ? Math.max(16, Math.min(80, 240 / frame.mmPerPx)) : 20;
  const checkOk = derived.scaleCheck?.ok === true;

  return (
    <div
      ref={wrapRef}
      className={`stage-wrap tool-${tool}`}
      data-testid="stage-wrap"
      data-view-x={view.x}
      data-view-y={view.y}
      data-view-scale={view.scale}
      data-image-width={project.imageWidth}
      data-image-height={project.imageHeight}
      data-draft={draft.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")}
    >
      {size.width > 0 && size.height > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onContextMenu={(event) => event.evt.preventDefault()}
        >
          <Layer>
            <Group
              ref={groupRef}
              x={project.imageWidth / 2}
              y={project.imageHeight / 2}
              offsetX={project.imageWidth / 2}
              offsetY={project.imageHeight / 2}
              rotation={project.rotationDeg}
            >
              {image && (
                <KonvaImage
                  image={image}
                  width={project.imageWidth}
                  height={project.imageHeight}
                  listening={false}
                />
              )}
              {project.calibration && (
                <Line
                  points={[project.calibration.a.x, project.calibration.a.y, project.calibration.b.x, project.calibration.b.y]}
                  stroke="#1d4e89"
                  strokeWidth={2}
                  strokeScaleEnabled={false}
                  listening={false}
                />
              )}
              {project.check && (
                <Line
                  points={[project.check.a.x, project.check.a.y, project.check.b.x, project.check.b.y]}
                  stroke={checkOk ? "#1f6b45" : "#9d1c1c"}
                  strokeWidth={2}
                  dash={[8, 5]}
                  strokeScaleEnabled={false}
                  listening={false}
                />
              )}
              {frame &&
                derived.layouts.map((layout) => {
                  const selected = layout.id === selectedWallId;
                  return (
                    <Group key={layout.id} listening={false}>
                      {layout.segments.map((segment, index) => {
                        const a = worldToImagePx(segment.sideA[0], frame);
                        const b = worldToImagePx(segment.sideA[1], frame);
                        const c = worldToImagePx(segment.sideB[0], frame);
                        const d = worldToImagePx(segment.sideB[1], frame);
                        const dimA = worldToImagePx(segment.dimA, frame);
                        const dimB = worldToImagePx(segment.dimB, frame);
                        const label = worldToImagePx(segment.labelAt, frame);
                        const local = (Math.atan2(dimB.y - dimA.y, dimB.x - dimA.x) * 180) / Math.PI;
                        const rotation = uprightRotation(local, project.rotationDeg);
                        const caption = String(segment.insideClearMm);
                        return (
                          <Group key={index}>
                            <Line
                              points={[a.x, a.y, b.x, b.y]}
                              stroke={selected ? "#c24b32" : "#1a1a1a"}
                              strokeWidth={selected ? 2.4 : 1.6}
                              strokeScaleEnabled={false}
                            />
                            <Line
                              points={[c.x, c.y, d.x, d.y]}
                              stroke={selected ? "#c24b32" : "#1a1a1a"}
                              strokeWidth={selected ? 2.4 : 1.6}
                              strokeScaleEnabled={false}
                            />
                            {segment.insideClearMm > 0 && (
                              <>
                                <Line
                                  points={[dimA.x, dimA.y, dimB.x, dimB.y]}
                                  stroke="#8a3b12"
                                  strokeWidth={1}
                                  strokeScaleEnabled={false}
                                />
                                <Text
                                  x={label.x}
                                  y={label.y}
                                  text={caption}
                                  fontSize={dimSize}
                                  fontFamily={FONT}
                                  fill="#8a3b12"
                                  rotation={rotation}
                                  offsetX={textOffset(caption, dimSize)}
                                  offsetY={dimSize / 2}
                                />
                              </>
                            )}
                          </Group>
                        );
                      })}
                    </Group>
                  );
                })}
              {project.walls.map((wall) => {
                const pts = wall.closed && wall.pointsPx.length > 2 ? [...wall.pointsPx, wall.pointsPx[0]] : wall.pointsPx;
                return (
                  <Line
                    key={wall.id}
                    points={pts.flatMap((p) => [p.x, p.y])}
                    stroke={wall.id === selectedWallId ? "#c24b32" : "#24324a"}
                    strokeWidth={1}
                    dash={[5, 4]}
                    strokeScaleEnabled={false}
                    listening={false}
                  />
                );
              })}
              {derived.rooms.map((room) => (
                <Text
                  key={room.id}
                  x={room.atPx.x}
                  y={room.atPx.y}
                  text={room.name}
                  fontSize={roomSize}
                  fontFamily={FONT}
                  fontStyle="bold"
                  fill="#16382c"
                  offsetX={textOffset(room.name, roomSize)}
                  offsetY={roomSize / 2}
                  listening={false}
                />
              ))}
              {draft.length > 0 && (
                <>
                  <Line
                    points={draft.flatMap((p) => [p.x, p.y])}
                    stroke="#a9782e"
                    strokeWidth={2}
                    strokeScaleEnabled={false}
                    listening={false}
                  />
                  {draft.map((point, index) => (
                    <Circle
                      key={index}
                      x={point.x}
                      y={point.y}
                      radius={4 / view.scale}
                      fill="#a9782e"
                      listening={false}
                    />
                  ))}
                </>
              )}
            </Group>
          </Layer>
        </Stage>
      )}
      {!imageUrl && (
        <div className="empty">
          <h2>上傳一張售樓平面圖</h2>
          <p>JPG、PNG，或 PDF 的一頁。斜放的圖會自動拉正，再用圖上兩個已知公厘把比例定下來。</p>
        </div>
      )}
      {imageUrl && project.autoLeveled && (
        <div className="level-banner" data-testid="auto-level-banner">
          這張平面圖已自動拉正
        </div>
      )}
      <div className="loupe-wrap">
        <canvas ref={loupeRef} width={168} height={168} />
        <span>放大鏡</span>
      </div>
    </div>
  );
}
