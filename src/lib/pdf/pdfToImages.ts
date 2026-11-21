"use client";

/// Rasterises a PDF blob to PNG data URLs (one per page). Used to hand the
/// desktop shell exact-size label images to print (see QrThermalPrint).
/// pdf.js is loaded lazily; the worker runs on the main thread (fake worker)
/// via the bundled worker module, so no worker URL/CSP setup is needed.
export async function pdfBlobToPngs(blob: Blob, dpi = 300): Promise<{ images: string[]; widthMm: number; heightMm: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const images: string[] = [];
  let widthMm = 0;
  let heightMm = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 }); // PDF points
    widthMm = (base.width / 72) * 25.4;
    heightMm = (base.height / 72) * 25.4;
    const vp = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    images.push(canvas.toDataURL("image/png"));
  }
  return { images, widthMm: Math.round(widthMm), heightMm: Math.round(heightMm) };
}
