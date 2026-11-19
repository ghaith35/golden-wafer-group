"use client";

import { useState } from "react";
import { FileDown, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { vanSheetPdfUrl, type VanSheetPdfInput } from "@/lib/pdf/vanSheetPdf";
import { dz, dzMoney } from "@/lib/format";

export type SheetRow = {
  name: string;
  reference: string;
  colis: string;
  units: string;
  value: number;
};

export type SheetCompany = {
  name: string;
  phone?: string | null;
  address?: string | null;
  rc?: string | null;
  nif?: string | null;
  ai?: string | null;
  logoUrl?: string | null;
  signatureUrl?: string | null;
  stampUrl?: string | null;
};

export function VanSheet({
  van,
  driverName,
  company,
  currency,
  date,
  rows,
  totals,
  labels,
}: {
  van: { name: string; matricule: string | null };
  driverName: string;
  company: SheetCompany;
  currency: string;
  date: string;
  rows: SheetRow[];
  totals: { units: number; value: number };
  labels: Record<string, string>;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [fileName, setFileName] = useState("sheet.pdf");

  const fmtMoney = (v: number) =>
    `${dzMoney(v)}${currency ? ` ${currency}` : ""}`;

  async function openPdf() {
    setPdfBusy(true);
    try {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      const input: VanSheetPdfInput = { van, driverName, company, currency, date, rows, totals, labels };
      const url = await vanSheetPdfUrl(input);
      setFileName(`kashf-${van.name.replace(/\s+/g, "-")}-${date.replaceAll("/", "-")}.pdf`);
      setPdfUrl(url);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div>
      {/* ── Polished preview ─────────────────────────────────────────── */}
      <div className="van-sheet overflow-hidden rounded-xl border border-(--border-default) bg-white text-black">
        <div className="flex items-center justify-between gap-4 bg-[#3a2b08] px-5 py-4 text-white">
          <div className="flex min-w-0 items-center gap-3">
            {company.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="logo" className="h-12 w-12 shrink-0 rounded-xl bg-white object-contain p-1" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 text-xl font-black">🚚</span>
            )}
            <div className="min-w-0">
              <div className="truncate text-base font-black">{company.name}</div>
              <div className="text-[11px] opacity-80">
                {[company.address, company.phone ? `Tél: ${company.phone}` : null].filter(Boolean).join(" · ")}
              </div>
              {(() => {
                const fiscal = [company.rc && `RC: ${company.rc}`, company.nif && `NIF: ${company.nif}`, company.ai && `AI: ${company.ai}`]
                  .filter(Boolean)
                  .join(" · ");
                return fiscal ? <div className="text-[11px] opacity-80">{fiscal}</div> : null;
              })()}
            </div>
          </div>
          <div className="shrink-0 text-end">
            <div className="text-sm font-black">{labels.sheet}</div>
            <div className="text-[11px] opacity-80">{date}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-[#f3ecda] px-5 py-2.5 text-xs">
          <span className="font-black">{van.name}</span>
          {van.matricule && (
            <span className="font-mono opacity-70" dir="ltr">{van.matricule}</span>
          )}
          <span className="opacity-70">{labels.driver}: <b>{driverName}</b></span>
          <span className="ms-auto font-black tabular-nums" dir="ltr">
            {dz(totals.units)} · {fmtMoney(totals.value)}
          </span>
        </div>

        <div className="overflow-x-auto px-2 py-1">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="text-start text-[11px] uppercase opacity-50">
                <th className="px-3 py-2 text-start font-black">#</th>
                <th className="px-3 py-2 text-start font-black">{labels.product}</th>
                <th className="px-3 py-2 text-start font-black">{labels.reference}</th>
                <th className="px-3 py-2 text-start font-black">{labels.colisage}</th>
                <th className="px-3 py-2 text-start font-black">{labels.units}</th>
                <th className="px-3 py-2 text-end font-black">{labels.value}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gray-100 odd:bg-gray-50/60">
                  <td className="px-3 py-2 tabular-nums opacity-50">{i + 1}</td>
                  <td className="px-3 py-2 font-bold">{r.name}</td>
                  <td className="px-3 py-2 font-mono opacity-70" dir="ltr">{r.reference}</td>
                  <td className="px-3 py-2 font-bold text-[#3a2b08]">{r.colis}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{r.units}</td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{fmtMoney(r.value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black font-black">
                <td colSpan={4} className="px-3 py-2.5 text-start">{labels.total}</td>
                <td className="px-3 py-2.5 tabular-nums" dir="ltr">{dz(totals.units)}</td>
                <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{fmtMoney(totals.value)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {(company.signatureUrl || company.stampUrl) && (
          <div className="flex items-end justify-between gap-8 px-5 pb-5">
            {company.signatureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.signatureUrl} alt="signature" className="h-14 object-contain" />
            ) : (
              <span />
            )}
            {company.stampUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.stampUrl} alt="cachet" className="h-20 w-20 rounded-full object-contain opacity-90" />
            )}
          </div>
        )}
      </div>

      <div className="no-print mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => void openPdf()} disabled={pdfBusy}>
          <FileText size={15} className="me-1" />
          {pdfBusy ? labels.generating : labels.pdf}
        </Button>
        <Button onClick={() => window.print()}>
          <Printer size={15} className="me-1" />
          {labels.print}
        </Button>
      </div>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        .van-sheet, .van-sheet * { visibility: visible !important; }
        .van-sheet { position: fixed !important; inset: 0 !important; border: none !important; border-radius: 0 !important; max-height: none !important; overflow: visible !important; }
        .no-print { display: none !important; }
      } @page { size: A4; margin: 12mm; }`}</style>

      {/* ── In-app PDF preview (proforma-style) ────────────────────────── */}
      <Modal
        open={pdfUrl !== null}
        onClose={() => setPdfUrl(null)}
        title={labels.sheet}
        icon={<FileText size={18} />}
        width="xl"
      >
        {pdfUrl && (
          <div className="space-y-2">
            <iframe src={pdfUrl} title="PDF" className="h-[min(72vh,700px)] w-full rounded-xl border border-(--border-default) bg-white" />
            <div className="flex justify-end">
              <a href={pdfUrl} download={fileName}>
                <Button variant="secondary">
                  <FileDown size={15} className="me-1" />
                  {labels.downloadFile}
                </Button>
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
