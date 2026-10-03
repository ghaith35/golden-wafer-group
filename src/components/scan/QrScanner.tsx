"use client";

import { useEffect, useRef, useState } from "react";

/// Live camera QR scanner (native BarcodeDetector, no dependency).
/// Calls onDetect once per distinct code while mounted.
/// Plus: decodeQrImage() + QrGalleryButton — scan a QR from a saved image
/// (e.g. the client QR the livreur saved as PNG). Tries BarcodeDetector
/// first, falls back to jsQR so it works even where the camera API is
/// missing (older WebViews / iOS).
export function QrScanner({
  onDetect,
  onError,
  className,
}: {
  onDetect: (text: string) => void;
  /// Reason the camera can't run: unsupported (no BarcodeDetector),
  /// denied (permission), insecure (plain http:// — camera needs https).
  onError?: (reason: "unsupported" | "denied" | "insecure") => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    let last = "";
    const fail = (reason: "unsupported" | "denied" | "insecure") => {
      if (!stopped) {
        setError(true);
        onErrorRef.current?.(reason);
      }
    };
    // Plain http:// over LAN = insecure context: the browser blocks the
    // camera outright — don't even prompt, report it so the UI can explain.
    if (!window.isSecureContext) {
      fail("insecure");
      return;
    }
    const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
    if (!BD) {
      fail("unsupported");
      return;
    }
    const detector = new BD({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch {
        fail("denied");
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await detector.detect(video);
          const v = codes.length > 0 ? codes[0].rawValue : "";
          if (v && v !== last) {
            last = v;
            onDetectRef.current(v);
          }
        } catch { /* keep scanning */ }
        timer = window.setTimeout(() => void tick(), 350);
      };
      void tick();
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  if (error) return null;
  return <video ref={videoRef} className={className ?? "h-56 w-full rounded-xl bg-black object-cover"} muted playsInline />;
}

/// Decode a QR code from an image file (gallery pick / saved client QR).
/// Returns the raw text, or null when no QR found. Never throws.
export async function decodeQrImage(file: File): Promise<string | null> {
  // 1. Native BarcodeDetector on a downscaled bitmap (fast path).
  try {
    const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect(img: ImageBitmap): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
    if (BD) {
      const bmp = await loadBitmap(file, 1280);
      if (bmp) {
        const codes = await new BD({ formats: ["qr_code"] }).detect(bmp);
        bmp.close?.();
        const v = codes.length > 0 ? codes[0].rawValue : "";
        if (v) return v;
      }
    }
  } catch { /* fall through to jsQR */ }
  // 2. jsQR fallback: full pixel scan, no camera API needed.
  try {
    const bmp = await loadBitmap(file, 1280);
    if (!bmp) return null;
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) { bmp.close?.(); return null; }
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import("jsqr");
    const hit = (jsQR as (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null)(
      data.data, data.width, data.height
    );
    return hit?.data ?? null;
  } catch {
    return null;
  }
}

async function loadBitmap(file: File, maxSide: number): Promise<ImageBitmap | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale >= 1) return bmp;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) { bmp.close?.(); return null; }
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    return await createImageBitmap(canvas);
  } catch {
    return null;
  }
}

/// Gallery pick button: "scan" a QR from a saved image instead of the camera.
export function QrGalleryButton({
  onDetect,
  onNotFound,
  label,
  className,
}: {
  onDetect: (text: string) => void;
  onNotFound?: () => void;
  label: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={label}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f || busy) return;
          setBusy(true);
          try {
            const text = await decodeQrImage(f);
            if (text) onDetect(text);
            else onNotFound?.();
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={className ?? "flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-(--border-default) text-sm font-black disabled:opacity-50"}
      >
        {busy ? "…" : `🖼️ ${label}`}
      </button>
    </>
  );
}
