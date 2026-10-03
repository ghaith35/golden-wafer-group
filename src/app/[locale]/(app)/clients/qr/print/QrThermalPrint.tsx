"use client";

import { useEffect, useState } from "react";
import { FileDown, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { qrLabelsPdfUrl } from "@/lib/pdf/clientQrPdf";

type Label = { id: string; code: string; name: string; phone: string | null; dataUrl: string };
type Company = { name: string; phone: string | null; logoUrl: string | null };

/// Thermal-printer QR strip: one label under the other (58/80mm rolls).
/// The print button opens a real PDF preview in-app (proforma-style).
export function QrThermalPrint({
  labels,
  company,
  ui,
}: {
  labels: Label[];
  company: Company | null;
  ui: Record<string, string>;
}) {
  const [width, setWidth] = useState<58 | 80>(80);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [fileName, setFileName] = useState("qr-labels.pdf");

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  async function openPdf() {
    setPdfBusy(true);
    try {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      const url = await qrLabelsPdfUrl({
        company: { name: company?.name ?? "", phone: company?.phone ?? null, logoUrl: company?.logoUrl ?? null },
        labels: labels.map((l) => ({ id: l.id, code: l.code, name: l.name, dataUrl: l.dataUrl })),
        widthMm: width,
      });
      setFileName(`qr-labels-${width}mm-${labels.length}.pdf`);
      setPdfUrl(url);
    } finally {
      setPdfBusy(false);
    }
  }

  function printIframe() {
    const frame = document.getElementById("qr-pdf-frame") as HTMLIFrameElement | null;
    frame?.contentWindow?.print();
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div className="no-print flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">
          {ui.title} ({labels.length})
        </h1>
        <div className="flex gap-2">
          <div className="flex gap-1.5">
            {([58, 80] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWidth(w)}
                className={cn(
                  "h-9 rounded-lg px-3 text-xs font-black tabular-nums transition-colors",
                  width === w ? "bg-(--brand-500)/15 text-(--brand-600)" : "bg-(--bg-sunken) opacity-60 hover:opacity-100"
                )}
              >
                {w}mm
              </button>
            ))}
          </div>
          <Button onClick={() => void openPdf()} disabled={pdfBusy}>
            <FileText size={15} className="me-1" />
            {pdfBusy ? ui.generating : ui.print}
          </Button>
        </div>
      </div>

      <div className="thermal-strip mx-auto space-y-0" style={{ maxWidth: `${width}mm` }}>
        {labels.map((l) => (
          <div key={l.id} className="thermal-label flex flex-col items-center bg-white px-2 py-3 text-center text-black">
            <div className="flex w-full items-center justify-center gap-1.5">
              {company?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logoUrl} alt="" style={{ height: "7mm", width: "7mm", objectFit: "contain" }} />
              ) : null}
              <div className="min-w-0">
                <div className="truncate text-sm font-black leading-tight">{company?.name ?? ""}</div>
                {company?.phone && (
                  <div className="font-mono text-[11px] font-bold opacity-60" dir="ltr">
                    {company.phone}
                  </div>
                )}
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={l.dataUrl}
              alt={l.code}
              className="w-full"
              style={{ maxWidth: `${width - 16}mm`, aspectRatio: "1", imageRendering: "pixelated" }}
            />
            <div className="mt-1 w-full truncate text-sm font-black">{l.name}</div>
            <div className="font-mono text-xs font-bold opacity-60" dir="ltr">
              {l.code}
            </div>
          </div>
        ))}
      </div>

      <style>{`@media print {
        .no-print { display: none !important; }
        body { background: #fff !important; }
        @page { size: ${width}mm auto; margin: 2mm; }
        .thermal-strip { max-width: none !important; }
        .thermal-label { break-inside: avoid !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      }`}</style>

      <Modal
        open={pdfUrl !== null}
        onClose={() => setPdfUrl(null)}
        title={ui.title}
        icon={<FileText size={18} />}
        width="lg"
      >
        {pdfUrl && (
          <div className="space-y-2">
            <iframe
              id="qr-pdf-frame"
              src={pdfUrl}
              title="PDF"
              className="h-[min(72vh,700px)] w-full rounded-xl border border-(--border-default) bg-white"
            />
            <div className="flex justify-end gap-2">
              <a href={pdfUrl} download={fileName}>
                <Button variant="secondary">
                  <FileDown size={15} className="me-1" />
                  {ui.downloadFile}
                </Button>
              </a>
              <Button onClick={printIframe}>{ui.print}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/// Popup wrapper: fetches the batch for the given ids, then renders the strip.
export function QrPrintModal({ ids, ui }: { ids: string[]; ui: Record<string, string> }) {
  const [data, setData] = useState<{ company: Company | null; labels: Label[] } | null>(null);

  useEffect(() => {
    let live = true;
    const sp = new URLSearchParams();
    sp.set("ids", ids.join(","));
    fetch(`/api/clients/qr-batch?${sp}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d) setData(d as { company: Company | null; labels: Label[] });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <p className="py-10 text-center text-sm opacity-60">…</p>;
  return <QrThermalPrint labels={data.labels} company={data.company} ui={ui} />;
}
