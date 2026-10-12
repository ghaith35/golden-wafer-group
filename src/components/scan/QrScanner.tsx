"use client";

import { useEffect, useRef, useState } from "react";
/// Bundled STATICALLY (not lazy): the camera fallback and the gallery decoder
/// must work fully offline — including on old phones without BarcodeDetector
/// whose service-worker chunk cache never warmed (a lazy chunk is a network
/// fetch, and offline that fetch fails exactly when the driver needs to scan).
/// ~100KB inside the warmed journée pages; reliability over bytes on the van.
import jsQRBundle from "jsqr";

/// Live camera QR scanner.
/// Uses the native BarcodeDetector where available (Android/desktop),
/// and falls back to live jsQR frame decoding where it isn't (iPhone:
/// iOS WebKit has no BarcodeDetector, but getUserMedia works over https).
/// Calls onDetect once per distinct code while mounted.
/// Plus: decodeQrImage() + QrGalleryButton — scan a QR from a saved image
/// (e.g. the client QR the livreur saved as PNG).
/// jsQR frame decoder signature (lazy-loaded only where BarcodeDetector
/// is missing, e.g. iPhone).
type JsQRFn = (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null;

export function QrScanner({
  onDetect,
  onError,
  className,
}: {
  onDetect: (text: string) => void;
  /// Reason the camera can't run: unsupported (no camera / no decoder),
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
    let watchdog = 0;
    // Native detect() throws on some phones (blacklisted WebViews, odd
    // drivers) while the preview runs fine — after N consecutive errors,
    // fall over to jsQR frames instead of spinning silently forever.
    let nativeErrors = 0;
    let useJsQR = false;
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
    (async () => {
      const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
      // No BarcodeDetector (old WebViews): decode video frames with the
      // statically-bundled jsQR instead of giving up — no network needed.
      type BDType = { detect(v: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
      const jsQR = jsQRBundle as unknown as JsQRFn;
      let detector: BDType | null = null;
      if (BD) {
        try {
          detector = new BD({ formats: ["qr_code"] });
        } catch {
          detector = null; // broken constructor → jsQR path below
        }
      }
      useJsQR = !detector;
      // Reused offscreen canvas for the jsQR frame path.
      const frame = document.createElement("canvas");
      const fctx = frame.getContext("2d", { willReadFrequently: true });
      const scanFrame = (): string => {
        const el = videoRef.current;
        if (!el || !fctx) return "";
        const vw = el.videoWidth;
        const vh = el.videoHeight;
        if (!vw || !vh || el.readyState < 2) return "";
        const scale = Math.min(1, 640 / vw);
        frame.width = Math.round(vw * scale);
        frame.height = Math.round(vh * scale);
        fctx.drawImage(el, 0, 0, frame.width, frame.height);
        try {
          const data = fctx.getImageData(0, 0, frame.width, frame.height);
          return jsQR(data.data, data.width, data.height)?.data ?? "";
        } catch {
          return "";
        }
      };
      // Some phones reject the environment constraint outright — fall back
      // to any camera rather than reporting "denied".
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch {
          fail("denied");
          return;
        }
      }
      if (stopped) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      // Set imperatively: React's muted/playsInline props don't stick on
      // iOS Safari, and without both the video never plays there.
      video.muted = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("muted", "");
      video.srcObject = stream;
      await video.play().catch(() => {});
      // Black/frozen-preview watchdog: a stream that never renders (stuck
      // permission, backgrounded WebView, zombie track, refused play())
      // must surface the retry UI instead of sitting black forever.
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => {
        const el = videoRef.current;
        if (!stopped && el && (el.readyState < 2 || el.videoWidth === 0 || el.paused)) {
          stream?.getTracks().forEach((tr) => tr.stop());
          fail("unsupported");
        }
      }, 4000);
      const tick = async () => {
        if (stopped) return;
        // Frozen frame (autoplay refused after the watchdog window):
        // nudge playback instead of decoding the same pixels forever.
        if (video.paused) {
          await video.play().catch(() => {});
        }
        try {
          let v = "";
          if (!useJsQR && detector) {
            try {
              const codes = await detector.detect(video);
              v = codes.length > 0 ? codes[0].rawValue : "";
              nativeErrors = 0;
            } catch {
              nativeErrors += 1;
              if (nativeErrors >= 10) {
                // Native path broken on this phone — switch to jsQR frames
                // (statically bundled, always available).
                useJsQR = true;
                detector = null;
              }
            }
          } else {
            v = scanFrame();
          }
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
      window.clearTimeout(watchdog);
      stream?.getTracks().forEach((tr) => tr.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  if (error) return null;
  return (
    <video
      ref={videoRef}
      className={className ?? "h-56 w-full rounded-xl bg-black object-cover"}
      muted
      playsInline
      autoPlay
      disablePictureInPicture
    />
  );
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
  // 2. jsQR fallback: full pixel scan, no camera API needed (statically
  // bundled — works offline on every phone).
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
    const hit = (jsQRBundle as unknown as (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null)(
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
