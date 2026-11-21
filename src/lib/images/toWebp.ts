"use client";

/// Any image the browser can decode (JPEG, PNG, HEIC on Safari, GIF, BMP,
/// AVIF…) → WebP, longest side capped so phone photos stay light.
export async function imageToWebp(file: File, maxSide = 2000, quality = 0.82): Promise<File> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unsupported");
  ctx.fillStyle = "#fff"; // transparent PNGs → white paper
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/webp", quality));
  if (!blob || blob.type !== "image/webp") throw new Error("webp_unsupported");
  return new File([blob], "invoice.webp", { type: "image/webp" });
}
