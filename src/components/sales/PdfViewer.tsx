"use client";

import { useEffect, useRef, useState } from "react";
import { Share2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { TicketLabels, TicketVM } from "@/components/sales/TicketView";
import type { TicketCompany } from "@/lib/print-ticket";
/// Static: this 3KB runner has zero deps — bundling it removes a runtime
/// fetch that stalled offline on some phones (hang with no resolve/reject).
/// The heavy PDF builder stays lazy (proven cached) by contrast.
import { savePdfFile, sharePdfFile } from "@/lib/share-ticket";

/// In-app facture viewer: the driver SEES the real A4 PDF (built offline by
/// ticketPdf) and shares/saves it from here — like a Chrome PDF viewer.
/// Web/PWA renders the actual PDF in an iframe (with the browser's own
/// toolbar: print / download / share). The native APK WebView cannot render
/// PDFs, so it keeps the JSX sheet preview — but the shared/saved file is
/// always the real PDF blob in both cases.
export function PdfViewer({
  ticket,
  company,
  lang,
  labels,
  qrDataUrl,
  onClose,
}: {
  ticket: TicketVM;
  company: TicketCompany;
  lang: "ar" | "fr";
  labels: TicketLabels & { pdfPreview?: string; save?: string };
  qrDataUrl?: string | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"load" | "share" | "save" | null>("load");
  const [msg, setMsg] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [isNative, setIsNative] = useState(false);
  const blobRef = useRef<Blob | null>(null);
  const rtl = lang !== "fr";
  const total = Number(ticket.total ?? 0);
  const paid = Number(ticket.paid ?? 0);
  const due = Math.round((total - paid) * 100) / 100;
  const fileBase = `facture-${String(ticket.number ?? "ticket").replace(/[^\w.-]+/g, "_")}`;

  // Build the real PDF once; share/save reuse the same blob.
  useEffect(() => {
    let dead = false;
    let obj = "";
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!dead && Capacitor.isNativePlatform()) setIsNative(true);
      } catch {
        /* web — iframe viewer */
      }
      try {
        const { buildTicketPdf } = await import("@/lib/pdf/ticketPdf");
        const blob = await buildTicketPdf({ ticket, company, lang, labels, qrDataUrl: qrDataUrl ?? null });
        if (dead) return;
        blobRef.current = blob;
        obj = URL.createObjectURL(blob);
        setUrl(obj);
      } catch {
        if (!dead) setMsg(labels.shareFail ?? "share failed");
      } finally {
        if (!dead) setBusy(null);
      }
    })();
    return () => {
      dead = true;
      if (obj) URL.revokeObjectURL(obj);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureBlob(): Promise<Blob | null> {
    if (blobRef.current) return blobRef.current;
    try {
      const { buildTicketPdf } = await import("@/lib/pdf/ticketPdf");
      const blob = await buildTicketPdf({ ticket, company, lang, labels, qrDataUrl: qrDataUrl ?? null });
      blobRef.current = blob;
      return blob;
    } catch {
      return null;
    }
  }

  async function onShare() {
    if (busy) return;
    setBusy("share");
    setMsg(null);
    try {
      const blob = await ensureBlob();
      if (!blob) {
        setMsg(labels.shareFail ?? "share failed");
        return;
      }
      const where = await sharePdfFile({ fileName: `${fileBase}.pdf`, blob, title: `N° ${ticket.number ?? ""}` });
      if (where === "saved") setMsg(labels.pdfSaved ?? "saved ✓");
      else if (where === "shared") setMsg(labels.pdfShared ?? "shared ✓");
      else setMsg(labels.shareFail ?? "share failed");
    } catch {
      setMsg(labels.shareFail ?? "share failed");
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    if (busy) return;
    setBusy("save");
    setMsg(null);
    try {
      const blob = await ensureBlob();
      if (!blob) {
        setMsg(labels.shareFail ?? "share failed");
        return;
      }
      const where = await savePdfFile({ fileName: `${fileBase}.pdf`, blob });
      if (where === "saved") setMsg(labels.pdfSaved ?? "saved ✓");
      else if (where === "cancelled") setMsg(null);
      else setMsg(labels.shareFail ?? "share failed");
    } catch {
      setMsg(labels.shareFail ?? "share failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open onClose={onClose} title={labels.pdfPreview ?? "Facture"} subtitle={`N° ${ticket.number ?? ""}`} icon="🧾" width="lg">
      <div className="space-y-3">
        {url && !isNative ? (
          // Real PDF viewer (Chrome toolbar: print / download / share).
          <iframe
            src={url}
            title={`facture-${String(ticket.number ?? "")}`}
            className="h-[60vh] w-full rounded-xl border border-(--border-default) bg-white"
          />
        ) : (
          <div className="overflow-hidden rounded-xl bg-white text-black shadow" dir={rtl ? "rtl" : "ltr"}>
            <div className="p-4">
              <div className="text-center">
                <div className="text-lg font-black">{company.name}</div>
                {[company.address, company.phone, [company.rc && `RC: ${company.rc}`, company.nif && `NIF: ${company.nif}`].filter(Boolean).join(" · ")]
                  .filter(Boolean)
                  .map((line, i) => (
                    <div key={i} className="text-[11px] text-neutral-600">{line}</div>
                  ))}
              </div>
              <div className="my-2 border-t border-dashed border-neutral-300" />
              <div className="flex items-center justify-between text-sm">
                <span className="font-black">N° {ticket.number ?? ""}</span>
                <span className="text-xs text-neutral-600">{ticket.client?.name ?? ""}</span>
              </div>
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {(ticket.lines ?? []).map((l, i) => (
                    <tr key={i} className="border-t border-neutral-100">
                      <td className="py-1 pe-2 font-bold">{l.name ?? ""}</td>
                      <td className="whitespace-nowrap py-1 text-neutral-600" dir="ltr">{l.qty} × {l.unitPrice}</td>
                      <td className="whitespace-nowrap py-1 text-end font-black" dir="ltr">{l.lineTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="my-2 border-t border-dashed border-neutral-300" />
              <div className="space-y-0.5 text-sm">
                {Number(ticket.remise ?? 0) > 0 && (
                  <div className="flex justify-between text-xs text-neutral-600">
                    <span>{labels.remise ?? ""}</span>
                    <span dir="ltr">− {ticket.remise}</span>
                  </div>
                )}
                <div className="flex justify-between font-black">
                  <span>{labels.total ?? ""}</span>
                  <span dir="ltr">{total}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>{labels.paid ?? ""}</span>
                  <span dir="ltr">{paid}</span>
                </div>
                <div className="flex justify-between font-black">
                  <span>{labels.due ?? ""}</span>
                  <span dir="ltr">{due}</span>
                </div>
              </div>
              {qrDataUrl ? (
                <div className="mt-2 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="qr" className="mx-auto h-24 w-24" />
                </div>
              ) : null}
              {labels.thanks ? <div className="mt-2 text-center text-xs font-black">{labels.thanks}</div> : null}
            </div>
          </div>
        )}
        {busy === "load" && <p className="text-center text-xs font-bold opacity-60">…</p>}
        {msg && <p className="rounded-xl bg-emerald-500/10 p-2 text-xs font-bold text-emerald-600">{msg}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1" aria-label="close">
            <X size={16} />
          </Button>
          <Button variant="secondary" onClick={() => void onSave()} disabled={busy !== null} data-testid="pv-save" className="flex-1">
            {busy === "save" ? "…" : (labels.save ?? "Save")}
          </Button>
          <Button onClick={() => void onShare()} disabled={busy !== null} data-testid="pv-share-confirm" className="flex-[2]">
            {busy === "share" ? "…" : (<><Share2 size={16} className="me-1" />{labels.share}</>)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
