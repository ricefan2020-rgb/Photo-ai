import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type RasterPage = {
  blob: Blob;
  width: number;
  height: number;
  pageCount: number;
  pageNumber: number;
};

export async function rasterizePdf(data: ArrayBuffer, pageNumber: number): Promise<RasterPage> {
  const pdf = await pdfjs.getDocument({ data: data.slice(0) }).promise;
  const pageCount = pdf.numPages;
  const pageNo = Math.min(Math.max(1, pageNumber), pageCount);
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const longEdge = Math.max(base.width, base.height);
  const scale = Math.min(8, 5600 / longEdge);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("無法建立畫布");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("無法轉出頁面"))), "image/png");
  });
  return { blob, width: canvas.width, height: canvas.height, pageCount, pageNumber: pageNo };
}
