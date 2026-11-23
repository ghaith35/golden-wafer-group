"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";

/// Full-screen live camera: shows the back camera and a shutter button. Works
/// offline (it is the phone's own camera, same getUserMedia path the QR
/// scanner already uses in the APK). `onFail` fires when the camera can't be
/// used (no camera / permission denied / unsupported) so the caller can fall
/// back to the system picker.
export function CameraCapture({
  onCapture,
  onClose,
  onFail,
  labels,
}: {
  onCapture: (blob: Blob) => void;
  onClose: () => void;
  onFail: () => void;
  labels: { shoot: string; cancel: string };
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onFail();
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch {
          if (!stopped) onFail();
          return;
        }
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) return;
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      try {
        await v.play();
      } catch {
        /* autoplay quirk — the frame still renders once metadata loads */
      }
      if (!stopped) setReady(true);
    })();
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy) return;
    setBusy(true);
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(
      (b) => {
        setBusy(false);
        if (b) onCapture(b);
        else onFail();
      },
      "image/jpeg",
      0.92
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black" role="dialog" aria-label={labels.shoot}>
      <button
        type="button"
        aria-label={labels.cancel}
        onClick={onClose}
        className="absolute end-4 top-[calc(1rem+env(safe-area-inset-top))] z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white"
      >
        <X size={20} />
      </button>
      <video ref={videoRef} className="h-full w-full flex-1 object-cover" playsInline muted autoPlay />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-black/70 to-transparent pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-10">
        <button
          type="button"
          onClick={shoot}
          disabled={!ready || busy}
          aria-label={labels.shoot}
          className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/20 text-white shadow-xl transition-transform active:scale-90 disabled:opacity-40"
        >
          <Camera size={30} />
        </button>
      </div>
      {!ready && <p className="absolute inset-0 flex items-center justify-center text-sm font-black text-white/80">…</p>}
    </div>
  );
}
