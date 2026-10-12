"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { isPublicHttpsOrigin, normalizeDomain } from "@/lib/sync/urls";

export function DevicesClient({
  serverUrl,
  tunnelActive,
  labels,
}: {
  locale: string;
  serverUrl: string;
  tunnelActive?: boolean;
  vans: Array<{ id: string; name: string }>;
  labels: Record<string, string>;
}) {
  const [serverQr, setServerQr] = useState("");
  const [serverQrOrigin, setServerQrOrigin] = useState("");

  useEffect(() => {
    const origin = normalizeDomain(serverUrl).replace(/\/+$/, "");
    if (!isPublicHttpsOrigin(origin)) return;
    let live = true;
    QRCode.toDataURL(origin, { margin: 2, width: 360, errorCorrectionLevel: "M" })
      .then((qr) => { if (live) { setServerQr(qr); setServerQrOrigin(origin); } })
      .catch(() => { if (live) { setServerQr(""); setServerQrOrigin(""); } });
    return () => { live = false; };
  }, [serverUrl]);

  return (
    <div className="space-y-4">
      <section className="flex flex-col items-center gap-4 border-y border-(--border-default) py-5 sm:flex-row sm:items-center">
        {serverQr && serverQrOrigin === normalizeDomain(serverUrl).replace(/\/+$/, "") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={serverQr} alt={labels.sharedQrTitle} className="h-72 w-72 rounded-xl bg-white p-3 sm:h-96 sm:w-96" />
        ) : (
          <div className="flex h-72 w-72 shrink-0 items-center justify-center rounded-xl border border-dashed border-(--border-default) p-4 text-center text-sm text-(--text-secondary) sm:h-96 sm:w-96">
            {labels.publicDomainMissing}
          </div>
        )}
        <div className="min-w-0 flex-1 text-center sm:text-start">
          <h2 className="text-base font-black">{labels.sharedQrTitle}</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-(--text-secondary)">{labels.sharedQrHint}</p>
          {/* The link itself is never shown — QR only. */}
          <p className="mt-2 text-xs font-bold" dir="auto">
            {tunnelActive
              ? <span className="text-emerald-600">{labels.linkInternet}</span>
              : <span className="text-amber-600">{labels.linkLanOnly}</span>}
          </p>
        </div>
      </section>
    </div>
  );
}
