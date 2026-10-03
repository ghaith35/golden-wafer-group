"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { QrScanner, QrGalleryButton } from "@/components/scan/QrScanner";

/// Single camera-scan block used by vente / commande / device setup:
/// - insecure context (plain http): gallery-first, NO 1s mount flash.
/// - failure: stays visible with the reason + explicit retry (never a
///   silent collapse loop).
/// - sustained black preview (>4s without playing) counts as failure too.
export function CameraBox({
  hint,
  onDetect,
  labels,
}: {
  hint: string;
  onDetect: (text: string) => void;
  labels: {
    scan: string;
    gallery: string;
    qrNotFound: string;
    camNeedHttps: string;
    camDenied: string;
    camUnsupported: string;
  };
}) {
  const insecure = typeof window !== "undefined" && !window.isSecureContext;
  const [camOn, setCamOn] = useState(!insecure);
  const [camTry, setCamTry] = useState(0);
  const [camErr, setCamErr] = useState<string | null>(insecure ? "insecure" : null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setCamOn(!insecure);
    setCamErr(insecure ? "insecure" : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function retry() {
    setCamErr(null);
    setNotFound(false);
    setCamTry((n) => n + 1);
    setCamOn(true);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold opacity-60">{hint}</p>
      {camOn ? (
        <QrScanner
          key={camTry}
          onDetect={(t) => { onDetect(t); }}
          onError={(r) => { setCamErr(r); setCamOn(false); }}
        />
      ) : (
        <>
          <Button onClick={retry} className="w-full">
            <Camera size={15} className="me-1" />
            {labels.scan}
          </Button>
          {camErr === "insecure" && (
            <p className="rounded-lg bg-amber-500/10 p-2 text-xs font-bold text-amber-600">{labels.camNeedHttps}</p>
          )}
          {camErr === "denied" && (
            <p className="rounded-lg bg-red-500/10 p-2 text-xs font-bold text-red-500">{labels.camDenied}</p>
          )}
          {camErr === "unsupported" && (
            <p className="rounded-lg bg-amber-500/10 p-2 text-xs font-bold text-amber-600">{labels.camUnsupported}</p>
          )}
        </>
      )}
      <QrGalleryButton
        onDetect={(t) => { onDetect(t); }}
        onNotFound={() => setNotFound(true)}
        label={labels.gallery}
      />
      {notFound && (
        <p className="rounded-lg bg-red-500/10 p-2 text-xs font-bold text-red-500">{labels.qrNotFound}</p>
      )}
    </div>
  );
}
