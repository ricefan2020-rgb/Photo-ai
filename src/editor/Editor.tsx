import { useEffect, useMemo, useRef, useState } from "react";
import {
  assessCheck,
  describeCheck,
  measureLengthMm,
  normalizeDeg,
  rotationToLevel,
} from "../geom/calibrate";
import { distance, type Point } from "../geom/points";
import { derive, toleranceNote } from "../model/derive";
import {
  DEFAULT_WALL_THICKNESS_MM,
  SITE_MEASURE_WARNING,
  createProject,
  sanitizeProject,
  uid,
  type Project,
  type Wall,
} from "../model/project";
import { writeDxf } from "../dxf/write";
import { clearCase, loadCase, saveCase } from "../storage/db";
import { CanvasView, type EditorTool } from "./CanvasView";
import { blobToDataUrl, dataUrlToBlob, downloadBlob } from "./download";

const TOOLS: { id: EditorTool; label: string; hint: string }[] = [
  { id: "straighten", label: "拉正", hint: "1" },
  { id: "calibrate", label: "校正", hint: "2" },
  { id: "check", label: "覆核", hint: "3" },
  { id: "wall", label: "描牆", hint: "4" },
  { id: "room", label: "房名", hint: "5" },
];

function clampThickness(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WALL_THICKNESS_MM;
  return Math.max(10, Math.min(2000, Math.round(value)));
}

function hasWork(project: Project): boolean {
  return Boolean(
    project.calibration ||
      project.check ||
      project.walls.length ||
      project.rooms.length ||
      project.rotationDeg !== 0,
  );
}

function readImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("無法讀取圖片"));
    img.src = url;
  });
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;
}

export function Editor() {
  const [ready, setReady] = useState(false);
  const [project, setProject] = useState<Project>(() => createProject());
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [tool, setTool] = useState<EditorTool>("straighten");
  const [draft, setDraft] = useState<Point[]>([]);
  const [leveling, setLeveling] = useState(false);
  const [calLength, setCalLength] = useState("3600");
  const [checkLength, setCheckLength] = useState("3600");
  const [thickness, setThickness] = useState(DEFAULT_WALL_THICKNESS_MM);
  const [closedWall, setClosedWall] = useState(true);
  const [roomName, setRoomName] = useState("主臥");
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [persistNote, setPersistNote] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfPages, setPdfPages] = useState(0);
  const [pdfPage, setPdfPage] = useState(1);
  const [fitNonce, setFitNonce] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const pdfBytesRef = useRef<ArrayBuffer | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  imageUrlRef.current = imageUrl;

  const derived = useMemo(() => derive(project), [project]);

  useEffect(() => {
    let cancel = false;
    loadCase()
      .then((saved) => {
        if (cancel || !saved) return;
        setProject(saved.project);
        if (saved.image) {
          setImageBlob(saved.image);
          setImageUrl(URL.createObjectURL(saved.image));
        }
      })
      .catch(() => {
        if (!cancel) setPersistNote("這個瀏覽器存不了案子，請自行下載 JSON。");
      })
      .finally(() => {
        if (!cancel) setReady(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      saveCase(project, imageBlob).catch(() => {
        setPersistNote("這個瀏覽器存不了案子，請自行下載 JSON。");
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [project, imageBlob, ready]);

  useEffect(() => {
    return () => {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    };
  }, []);

  const actions = useRef({
    finishWall: (_closed?: boolean) => {},
    deleteSelection: () => {},
    chooseTool: (_tool: EditorTool) => {},
    tool,
    draftLength: draft.length,
  });

  function chooseTool(next: EditorTool) {
    setTool(next);
    setDraft([]);
    if (next !== "straighten") setLeveling(false);
  }

  function finishWall(closed = closedWall) {
    let points = draft;
    if (points.length >= 2 && distance(points[0], points[points.length - 1]) < 1) {
      points = points.slice(0, -1);
    }
    if (points.length < 2) {
      setMessage("一道牆至少要兩個點");
      return;
    }
    const wall: Wall = {
      id: uid(),
      pointsPx: points,
      thicknessMm: clampThickness(thickness),
      closed,
    };
    setProject((current) => ({ ...current, walls: [...current.walls, wall] }));
    setSelectedWallId(wall.id);
    setDraft([]);
    setMessage(closed ? "已加上一道閉合牆，內側淨距標在外側。" : "已加上一道牆。");
  }

  function deleteSelection() {
    if (!selectedWallId) return;
    setProject((current) => ({
      ...current,
      walls: current.walls.filter((wall) => wall.id !== selectedWallId),
    }));
    setSelectedWallId(null);
  }

  actions.current = {
    finishWall,
    deleteSelection,
    chooseTool,
    tool,
    draftLength: draft.length,
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const current = actions.current;
      if (event.key === "Enter" && current.tool === "wall") {
        event.preventDefault();
        current.finishWall();
      } else if (event.key === "Escape") {
        setDraft([]);
        setLeveling(false);
      } else if (event.key === "Backspace" && current.draftLength > 0) {
        event.preventDefault();
        setDraft((points) => points.slice(0, -1));
      } else if (event.key === "Delete") {
        current.deleteSelection();
      } else if (event.key >= "1" && event.key <= "5") {
        const next = TOOLS[Number(event.key) - 1];
        if (next) current.chooseTool(next.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function rotateBy(delta: number) {
    setProject((current) => ({
      ...current,
      rotationDeg: normalizeDeg(current.rotationDeg + delta),
      leveled: true,
    }));
    setFitNonce((value) => value + 1);
  }

  function adoptImage(blob: Blob, width: number, height: number) {
    if (hasWork(project) && !window.confirm("換圖會清掉校正、覆核和已經描的牆。要繼續嗎？")) return false;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageBlob(blob);
    setImageUrl(URL.createObjectURL(blob));
    setDraft([]);
    setSelectedWallId(null);
    setProject((current) => ({
      ...createProject(current.name),
      imageWidth: width,
      imageHeight: height,
    }));
    return true;
  }

  async function onUpload(file: File) {
    setMessage(null);
    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        const { rasterizePdf } = await import("../pdf/rasterize");
        const bytes = await file.arrayBuffer();
        const raster = await rasterizePdf(bytes, 1);
        if (!adoptImage(raster.blob, raster.width, raster.height)) return;
        pdfBytesRef.current = bytes;
        setPdfPages(raster.pageCount);
        setPdfPage(raster.pageNumber);
      } else {
        const url = URL.createObjectURL(file);
        try {
          const size = await readImageSize(url);
          if (!adoptImage(file, size.width, size.height)) return;
        } finally {
          URL.revokeObjectURL(url);
        }
        pdfBytesRef.current = null;
        setPdfPages(0);
      }
      setTool("straighten");
      setFitNonce((value) => value + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法讀取檔案");
    }
  }

  async function changePage(page: number) {
    const bytes = pdfBytesRef.current;
    if (!bytes) return;
    try {
      const { rasterizePdf } = await import("../pdf/rasterize");
      const raster = await rasterizePdf(bytes, page);
      if (!adoptImage(raster.blob, raster.width, raster.height)) return;
      setPdfPage(raster.pageNumber);
      setPdfPages(raster.pageCount);
      setFitNonce((value) => value + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法讀取這頁");
    }
  }

  function onPick(point: Point) {
    if (tool === "pan") return;
    if (!imageUrl) {
      setMessage("請先上傳平面圖");
      return;
    }
    if (tool === "straighten" && leveling) {
      const next = [...draft, point];
      if (next.length < 2) {
        setDraft(next);
        return;
      }
      const deg = rotationToLevel(next[0], next[1]);
      setProject((current) => ({ ...current, rotationDeg: deg, leveled: true }));
      setDraft([]);
      setLeveling(false);
      setFitNonce((value) => value + 1);
      setMessage(`已轉到 ${deg.toFixed(2)}°，這條線現在是水平的。`);
      return;
    }
    if (tool === "calibrate" || tool === "check") {
      if (draft.length >= 2) return;
      setDraft([...draft, point]);
      return;
    }
    if (tool === "wall") {
      if (!project.calibration) {
        setMessage("請先校正比例，牆才有公厘。");
        return;
      }
      if (draft.length >= 3 && samePoint(point, draft[0])) {
        finishWall(true);
        return;
      }
      if (draft.length > 0 && distance(point, draft[draft.length - 1]) < 1.5) return;
      setDraft([...draft, point]);
      setSelectedWallId(null);
      return;
    }
    if (tool === "room") {
      const name = roomName.trim();
      if (!name) {
        setMessage("請先輸入房間名");
        return;
      }
      if (!project.calibration) {
        setMessage("請先校正比例");
        return;
      }
      setProject((current) => ({
        ...current,
        rooms: [...current.rooms, { id: uid(), name, atPx: point }],
      }));
    }
  }

  function confirmCalibration() {
    if (draft.length < 2) return;
    const lengthMm = Math.round(Number(calLength));
    if (!(lengthMm > 0)) {
      setMessage("請輸入大於 0 的公厘");
      return;
    }
    if (distance(draft[0], draft[1]) < 2) {
      setMessage("兩個點太近");
      return;
    }
    const segment = { a: draft[0], b: draft[1] };
    setProject((current) => ({ ...current, calibration: { ...segment, lengthMm } }));
    setDraft([]);
    setTool("check");
    setMessage(`比例已套用：這一段是 ${lengthMm} mm。接著覆核另一段。`);
  }

  function confirmCheck() {
    if (draft.length < 2 || !derived.mmPerPx) return;
    const typedMm = Math.round(Number(checkLength));
    if (!(typedMm > 0)) {
      setMessage("請輸入大於 0 的公厘");
      return;
    }
    if (distance(draft[0], draft[1]) < 2) {
      setMessage("兩個點太近");
      return;
    }
    const segment = { a: draft[0], b: draft[1] };
    setProject((current) => ({ ...current, check: { ...segment, typedMm } }));
    setDraft([]);
  }

  function changeThickness(value: number) {
    const next = clampThickness(value);
    setThickness(next);
    if (!selectedWallId) return;
    setProject((current) => ({
      ...current,
      walls: current.walls.map((wall) => (wall.id === selectedWallId ? { ...wall, thicknessMm: next } : wall)),
    }));
  }

  async function downloadJson() {
    const imageDataUrl = imageBlob ? await blobToDataUrl(imageBlob) : null;
    const payload = {
      ...project,
      imageDataUrl,
      geometryMm: {
        unit: "mm",
        mmPerPx: derived.mmPerPx,
        check: derived.scaleCheck,
        walls: derived.wallInputs,
        rooms: derived.rooms.map((room) => ({ name: room.name, at: room.at })),
        insideClearMm: derived.layouts.map((layout) => ({
          id: layout.id,
          segments: layout.segments.map((segment) => segment.insideClearMm),
        })),
      },
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "plan.json");
  }

  async function openJson(file: File) {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const loaded = sanitizeProject(parsed);
      if (!loaded) {
        setMessage("這份 JSON 不是這個版本的案子");
        return;
      }
      const imageDataUrl =
        parsed && typeof parsed === "object" && "imageDataUrl" in parsed
          ? (parsed as { imageDataUrl?: unknown }).imageDataUrl
          : null;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      pdfBytesRef.current = null;
      setPdfPages(0);
      if (typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:")) {
        const blob = dataUrlToBlob(imageDataUrl);
        setImageBlob(blob);
        setImageUrl(URL.createObjectURL(blob));
      } else {
        setImageBlob(null);
        setImageUrl(null);
      }
      setProject(loaded);
      setDraft([]);
      setSelectedWallId(null);
      setFitNonce((value) => value + 1);
    } catch {
      setMessage("無法讀取 JSON");
    }
  }

  function exportDxf() {
    if (derived.blockReason) return;
    const dxf = writeDxf({
      layouts: derived.layouts,
      rooms: derived.rooms.map((room) => ({ name: room.name, at: room.at })),
      notes: [SITE_MEASURE_WARNING, toleranceNote()],
    });
    downloadBlob(new Blob([dxf], { type: "application/dxf" }), "plan.dxf");
  }

  async function exportPdf() {
    if (derived.blockReason) return;
    setPdfBusy(true);
    try {
      const { buildPreviewPdf } = await import("../pdf/preview");
      const bytes = await buildPreviewPdf({
        layouts: derived.layouts,
        rooms: derived.rooms.map((room) => ({ name: room.name, at: room.at })),
        notes: [SITE_MEASURE_WARNING, toleranceNote()],
      });
      downloadBlob(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), "plan-preview.pdf");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法寫出 PDF");
    } finally {
      setPdfBusy(false);
    }
  }

  async function newCase() {
    if (hasWork(project) && !window.confirm("清掉這份案子？圖和描線都會去掉。")) return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    pdfBytesRef.current = null;
    setPdfPages(0);
    setImageBlob(null);
    setImageUrl(null);
    setDraft([]);
    setSelectedWallId(null);
    setProject(createProject());
    await clearCase().catch(() => undefined);
  }

  const liveCheck =
    tool === "check" && draft.length >= 2 && derived.mmPerPx && Number(checkLength) > 0
      ? assessCheck(measureLengthMm(draft[0], draft[1], derived.mmPerPx), Number(checkLength))
      : null;
  const blockReason = derived.blockReason;
  const statusState = derived.scaleCheck?.ok ? "ok" : (derived.scaleCheck?.reason ?? "pending");
  const selected = project.walls.find((wall) => wall.id === selectedWallId) ?? null;
  const selectedLayout = derived.layouts.find((layout) => layout.id === selectedWallId) ?? null;

  if (!ready) return <div className="booting">正在打開案子…</div>;

  return (
    <div
      className="app"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) void onUpload(file);
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">平</span>
          <div>
            <strong>平面配置</strong>
            <small>售樓圖進、CAD 出</small>
          </div>
        </div>
        <label className="name">
          案子
          <input
            value={project.name}
            aria-label="案子名稱"
            onChange={(event) => setProject((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <div className="top-actions">
          <button type="button" onClick={() => fileRef.current?.click()}>
            上傳
          </button>
          <button type="button" onClick={() => void downloadJson()}>
            JSON
          </button>
          <button type="button" onClick={() => jsonRef.current?.click()}>
            開啟
          </button>
          <button type="button" onClick={() => void newCase()}>
            新案子
          </button>
          <button type="button" onClick={() => setFitNonce((value) => value + 1)}>
            適合畫面
          </button>
          <button
            type="button"
            data-testid="export-pdf"
            disabled={Boolean(blockReason) || pdfBusy}
            title={blockReason ?? "下載一頁 PDF 預覽"}
            onClick={() => void exportPdf()}
          >
            PDF 預覽
          </button>
          <button
            type="button"
            className="primary"
            data-testid="export-dxf"
            disabled={Boolean(blockReason)}
            title={blockReason ?? "下載 plan.dxf"}
            onClick={exportDxf}
          >
            匯出 DXF
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="tools">
          {pdfPages > 1 && (
            <div className="row" style={{ marginBottom: 12 }}>
              <button type="button" disabled={pdfPage <= 1} onClick={() => void changePage(pdfPage - 1)}>
                上一頁
              </button>
              <span>
                第 {pdfPage} / {pdfPages} 頁
              </span>
              <button type="button" disabled={pdfPage >= pdfPages} onClick={() => void changePage(pdfPage + 1)}>
                下一頁
              </button>
            </div>
          )}
          <div className="steps">
            {TOOLS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={tool === item.id}
                onClick={() => chooseTool(item.id)}
              >
                {item.label}
                <small>{item.hint}</small>
              </button>
            ))}
            <button className="pan-btn" type="button" aria-pressed={tool === "pan"} onClick={() => chooseTool("pan")}>
              平移
            </button>
          </div>
          {tool === "straighten" && (
            <div className="stack">
              <p>售樓說明書的圖常常整頁斜放。轉到牆是水平的，再量尺寸。拉正不改變比例。</p>
              <div className="row">
                <button type="button" onClick={() => rotateBy(-90)}>
                  左轉 90°
                </button>
                <button type="button" onClick={() => rotateBy(90)}>
                  右轉 90°
                </button>
                <button type="button" onClick={() => rotateBy(180)}>
                  轉 180°
                </button>
              </div>
              <div className="row">
                <button type="button" onClick={() => rotateBy(-0.1)}>
                  −0.1°
                </button>
                <button type="button" onClick={() => rotateBy(0.1)}>
                  +0.1°
                </button>
                <input
                  className="angle"
                  type="number"
                  step="0.01"
                  aria-label="旋轉角度"
                  value={Math.round(project.rotationDeg * 100) / 100}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    setProject((current) => ({
                      ...current,
                      rotationDeg: normalizeDeg(value),
                      leveled: true,
                    }));
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setLeveling(true);
                  setDraft([]);
                  setMessage("在應該水平的牆或尺寸線上點兩個點。");
                }}
              >
                以兩點拉平
              </button>
              <button
                type="button"
                onClick={() => {
                  setProject((current) => ({ ...current, leveled: true }));
                  setMessage("已標記為水平。");
                }}
              >
                平面已水平
              </button>
              {!project.leveled && <p className="hint">還沒確認拉正。匯出的牆會跟著目前的角度。</p>}
            </div>
          )}
          {tool === "calibrate" && (
            <div className="stack">
              <p>點在一段已知尺寸的兩端，輸入圖上印刷的公厘。不要用頁寬反推。</p>
              <label className="field">
                圖上長度（mm）
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={calLength}
                  aria-label="校正長度"
                  onChange={(event) => setCalLength(event.target.value)}
                />
              </label>
              <button
                type="button"
                data-testid="confirm-calibration"
                disabled={draft.length < 2}
                onClick={confirmCalibration}
              >
                套用比例
              </button>
              {draft.length > 0 && <p className="hint">已點 {draft.length} / 2 點</p>}
              {derived.mmPerPx && project.calibration && (
                <p className="hint">
                  目前 1 px = {derived.mmPerPx.toFixed(3)} mm，校正段 {project.calibration.lengthMm} mm
                </p>
              )}
            </div>
          )}
          {tool === "check" && (
            <div className="stack">
              <p>用另一段獨立的已知長度覆核。實測可以比圖上短 5 mm，不可以長過。</p>
              <label className="field">
                圖上長度（mm）
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={checkLength}
                  aria-label="覆核長度"
                  onChange={(event) => setCheckLength(event.target.value)}
                />
              </label>
              <button type="button" data-testid="confirm-check" disabled={draft.length < 2} onClick={confirmCheck}>
                確認覆核
              </button>
              {draft.length > 0 && <p className="hint">已點 {draft.length} / 2 點</p>}
              {liveCheck && <p className={liveCheck.ok ? "hint" : "message"}>{describeCheck(liveCheck)}</p>}
            </div>
          )}
          {tool === "wall" && (
            <div className="stack">
              <p>沿著牆的中心線點。程式依牆厚偏移成雙線，並在外側標內側淨距。</p>
              <label className="field">
                牆厚（mm）
                <input
                  type="number"
                  min={10}
                  max={2000}
                  step={1}
                  value={thickness}
                  aria-label="牆厚"
                  onChange={(event) => changeThickness(Number(event.target.value))}
                />
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={closedWall}
                  onChange={(event) => setClosedWall(event.target.checked)}
                />
                閉合
              </label>
              <div className="row">
                <button type="button" onClick={() => finishWall()}>
                  完成這道牆
                </button>
                <button type="button" onClick={() => setDraft((points) => points.slice(0, -1))}>
                  退回上一點
                </button>
                <button type="button" onClick={() => setDraft([])}>
                  取消
                </button>
              </div>
              <p className="hint">Enter 完成，Backspace 退點，點回起點會閉合。未閉合的牆若接到別的牆，淨距會扣掉那些牆的一半厚度。</p>
            </div>
          )}
          {tool === "room" && (
            <div className="stack">
              <p>名稱自己打，程式不猜。點在房間裡面放下。</p>
              <label className="field">
                名稱
                <input
                  type="text"
                  value={roomName}
                  aria-label="房間名稱"
                  onChange={(event) => setRoomName(event.target.value)}
                />
              </label>
            </div>
          )}
          {tool === "pan" && <p className="hint">拖曳平移。滾輪縮放，中鍵或右鍵在其他工具裡也能拖。</p>}
          {message && <p className="message">{message}</p>}
        </aside>
        <CanvasView
          imageUrl={imageUrl}
          project={project}
          derived={derived}
          tool={tool}
          draft={draft}
          selectedWallId={selectedWallId}
          fitNonce={fitNonce}
          onPick={onPick}
        />
        <aside className="side">
          <h2>比例</h2>
          <p className="hint">
            {derived.mmPerPx && project.calibration
              ? `1 px = ${derived.mmPerPx.toFixed(3)} mm，校正段 ${project.calibration.lengthMm} mm`
              : "還沒校正"}
          </p>
          <h2>覆核</h2>
          <div className={`result ${statusState === "ok" ? "ok" : statusState === "pending" ? "pending" : "bad"}`} data-testid="scale-status" data-state={statusState}>
            {derived.scaleCheck ? describeCheck(derived.scaleCheck) : "還沒有第二段尺寸。不准匯出。"}
          </div>
          {selected && (
            <>
              <h2>這道牆</h2>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={selected.closed}
                  onChange={(event) => {
                    const closed = event.target.checked;
                    setProject((current) => ({
                      ...current,
                      walls: current.walls.map((wall) => (wall.id === selected.id ? { ...wall, closed } : wall)),
                    }));
                  }}
                />
                閉合
              </label>
              {selectedLayout && (
                <p className="hint">
                  內側淨距 {selectedLayout.segments.map((segment) => segment.insideClearMm).join("、")} mm
                </p>
              )}
              <button type="button" className="danger" onClick={deleteSelection}>
                刪除這道牆
              </button>
            </>
          )}
          <h2>牆</h2>
          {project.walls.length === 0 && <p className="hint">還沒描牆</p>}
          <ul className="list">
            {project.walls.map((wall, index) => (
              <li key={wall.id}>
                <button type="button" aria-pressed={wall.id === selectedWallId} onClick={() => {
                  setSelectedWallId(wall.id);
                  setThickness(wall.thicknessMm);
                }}>
                  牆 {index + 1} · {wall.thicknessMm} mm{wall.closed ? " · 閉合" : ""}
                </button>
              </li>
            ))}
          </ul>
          <h2>房間</h2>
          {project.rooms.length === 0 && <p className="hint">還沒標房名</p>}
          <ul className="list">
            {project.rooms.map((room) => (
              <li key={room.id} className="mini">
                <input
                  value={room.name}
                  aria-label="房間名"
                  onChange={(event) => {
                    const name = event.target.value;
                    setProject((current) => ({
                      ...current,
                      rooms: current.rooms.map((item) => (item.id === room.id ? { ...item, name } : item)),
                    }));
                  }}
                />
                <button
                  type="button"
                  onClick={() =>
                    setProject((current) => ({
                      ...current,
                      rooms: current.rooms.filter((item) => item.id !== room.id),
                    }))
                  }
                >
                  刪除
                </button>
              </li>
            ))}
          </ul>
          <h2>圖層</h2>
          <div className="legend">
            <span>WALL 牆的雙線</span>
            <span>ROOM 房間名</span>
            <span>DIM 內側淨距</span>
            <span>NOTE 下單前須現場丈量</span>
          </div>
          {persistNote && <p className="hint">{persistNote}</p>}
        </aside>
      </div>
      <footer className="statusbar">
        <span>{SITE_MEASURE_WARNING}</span>
        <span className="quiet">覆核容許短 5 mm，不可長過圖上尺寸</span>
      </footer>
      <input
        ref={fileRef}
        data-testid="file-input"
        hidden
        type="file"
        accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onUpload(file);
        }}
      />
      <input
        ref={jsonRef}
        hidden
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void openJson(file);
        }}
      />
    </div>
  );
}
