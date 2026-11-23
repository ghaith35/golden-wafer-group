/// Phone-side photo prep: camera files are 3–8 MB — shrink them to a JPEG
/// data URL small enough to sit in the offline outbox (SQLite / localStorage)
/// and to cross a weak 4G link. Honours EXIF rotation. Browser-only.

const TARGET_BYTES = 450 * 1024;

async function decode(file: Blob): Promise<{ draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h), w: bmp.width, h: bmp.height, close: () => bmp.close?.() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("bad_image"));
    img.src = url;
  });
  return { draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h), w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

/// Longest side ≤ maxDim, JPEG; quality steps down until it fits TARGET_BYTES.
export async function compressToJpegDataUrl(file: Blob, maxDim = 1280): Promise<string> {
  const src = await decode(file);
  try {
    let dim = maxDim;
    let out = "";
    for (const q of [0.7, 0.6, 0.5, 0.4]) {
      const scale = Math.min(1, dim / Math.max(src.w, src.h));
      const w = Math.max(1, Math.round(src.w * scale));
      const h = Math.max(1, Math.round(src.h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no_canvas");
      src.draw(ctx, w, h);
      out = canvas.toDataURL("image/jpeg", q);
      // base64 → bytes ≈ ×0.75
      if (out.length * 0.75 <= TARGET_BYTES) break;
      dim = Math.round(dim * 0.85);
    }
    return out;
  } finally {
    src.close();
  }
}
