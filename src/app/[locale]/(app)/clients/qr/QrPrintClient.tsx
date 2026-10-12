"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BackButton } from "@/components/ui/BackButton";
import { cn } from "@/lib/utils";

type Label = { id: string; code: string; name: string; phone: string | null; dataUrl: string };
type Wilaya = { code: number; nameAr: string };
type Company = { name: string; phone: string | null; logoUrl: string | null };

/// Label sizes in mm (square stickers). Columns fit A4 (190mm usable).
const SIZES = [
  { key: "40", label: "40mm", box: 40, cols: 4, qrPct: 62, namePx: 8, codePx: 7 },
  { key: "50", label: "50mm", box: 50, cols: 3, qrPct: 66, namePx: 9, codePx: 8 },
  { key: "62", label: "62mm", box: 62, cols: 3, qrPct: 70, namePx: 10, codePx: 9 },
] as const;

export function QrPrintClient({
  locale,
  wilayas,
  secteurs,
  labels,
}: {
  locale: string;
  wilayas: Wilaya[];
  secteurs: Array<{ id: string; name: string; wilayaCode: number }>;
  labels: Record<string, string>;
}) {
  const [q, setQ] = useState("");
  const [wilaya, setWilaya] = useState("");
  const [secteur, setSecteur] = useState("");
  const [all, setAll] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(() => {
    // Preselect from the clients list (?ids=…) — lazy init, no effect needed.
    if (typeof window === "undefined") return new Set();
    const ids = new URLSearchParams(window.location.search)
      .get("ids")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return new Set(ids ?? []);
  });
  const [printed, setPrinted] = useState<Label[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [size, setSize] = useState<(typeof SIZES)[number]>(SIZES[1]);
  /// Manual label dimensions (mm): preset buttons fill these in, the user
  /// can type any width × height and validate — the sheet follows.
  const [boxW, setBoxW] = useState("50");
  const [boxH, setBoxH] = useState("50");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sp = new URLSearchParams({ ...(q ? { q } : {}), ...(secteur ? { secteurId: secteur } : {}), ...(wilaya ? { wilayaCode: wilaya } : {}) });
    fetch(`/api/clients?${sp}`)
      .then((r) => r.json())
      .then((d) => setAll((d as Array<{ id: string; name: string; code: string }>).map((c) => ({ id: c.id, name: c.name, code: c.code }))))
      .catch(() => {});
  }, [q, secteur, wilaya]);

  // Effective label box: manual W×H when valid, else the preset square.
  const wNum = Number(boxW);
  const hNum = Number(boxH);
  const manualOk = Number.isFinite(wNum) && Number.isFinite(hNum) && wNum >= 10 && wNum <= 200 && hNum >= 10 && hNum <= 200;
  const box = { w: manualOk ? wNum : size.box, h: manualOk ? hNum : size.box };
  const cols = Math.max(1, Math.floor(190 / box.w));
  const scale = Math.min(box.w, box.h) / 50;
  const qrPct = Math.min(85, Math.max(40, Math.round(66 * scale)));
  const namePx = Math.max(7, Math.round(9 * scale));
  const codePx = Math.max(6, Math.round(8 * scale));

  function pickSize(s: (typeof SIZES)[number]) {
    setSize(s);
    setBoxW(String(s.box));
    setBoxH(String(s.box));
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function load() {
    setBusy(true);
    try {
      const sp = new URLSearchParams();
      if (selected.size) sp.set("ids", [...selected].join(","));
      else {
        if (secteur) sp.set("secteurId", secteur);
        if (wilaya) sp.set("wilayaCode", wilaya);
      }
      const res = await fetch(`/api/clients/qr-batch?${sp}`);
      const data = (await res.json()) as { company: Company | null; labels: Label[] };
      setCompany(data.company);
      setPrinted(data.labels);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="no-print">
        <BackButton fallback={`/${locale}/clients`} />
      </div>
      <div className="no-print flex items-center justify-between">
        <h1 className="text-xl font-bold">{labels.title}</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setSelected(new Set(all.map((c) => c.id)))}>
            {labels.selectAll}
          </Button>
          <Button onClick={load} disabled={busy}>
            {labels.print}
          </Button>
        </div>
      </div>
      <div className="no-print flex gap-2">
        <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={wilaya} onChange={(e) => { setWilaya(e.target.value); setSecteur(""); }} className="h-11 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm">
          <option value="">—</option>
          {wilayas.map((w) => (
            <option key={w.code} value={w.code}>{w.code} · {w.nameAr}</option>
          ))}
        </select>
        <select value={secteur} onChange={(e) => setSecteur(e.target.value)} className="h-11 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm">
          <option value="">—</option>
          {secteurs.filter((s) => !wilaya || s.wilayaCode === Number(wilaya)).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="no-print max-h-64 space-y-1 overflow-y-auto rounded-xl border border-(--border-default) p-2">
        {all.map((c) => (
          <label key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-(--bg-sunken)">
            <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
            <span className="font-semibold">{c.name}</span>
            <span className="font-mono text-xs opacity-50">{c.code}</span>
          </label>
        ))}
      </div>
      {printed.length > 0 && (
        <>
          <div className="no-print space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1.5">
                {SIZES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => pickSize(s)}
                    className={cn(
                      "h-8 rounded-lg px-3 text-xs font-black transition-colors",
                      Number(boxW) === s.box && Number(boxH) === s.box
                        ? "bg-(--brand-500)/15 text-(--brand-600)"
                        : "bg-(--bg-sunken) opacity-60 hover:opacity-100"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <Button onClick={() => window.print()}>{labels.print} ({printed.length})</Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs font-bold opacity-60">{labels.labelSize}</span>
              <Input
                type="number" min={10} max={200} value={boxW}
                onChange={(e) => setBoxW(e.target.value)} dir="ltr" inputMode="decimal"
                aria-label={labels.width} placeholder={labels.width}
                className="h-10"
              />
              <span className="opacity-60">×</span>
              <Input
                type="number" min={10} max={200} value={boxH}
                onChange={(e) => setBoxH(e.target.value)} dir="ltr" inputMode="decimal"
                aria-label={labels.height} placeholder={labels.height}
                className="h-10"
              />
              <span className="shrink-0 text-[11px] tabular-nums opacity-60" dir="ltr">
                {manualOk ? `${box.w}×${box.h}mm · ${cols}/row` : ""}
              </span>
            </div>
          </div>
          <div
            className="qr-sheet grid justify-center"
            style={{ gridTemplateColumns: `repeat(${cols}, ${box.w}mm)`, gap: "4mm" }}
          >
            {printed.map((l) => (
              <div
                key={l.id}
                className="qr-label flex flex-col items-center justify-center overflow-hidden rounded bg-white text-black"
                style={{ width: `${box.w}mm`, height: `${box.h}mm`, padding: "2.5mm" }}
              >
                <div className="flex w-full items-center justify-center gap-1">
                  {company?.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={company.logoUrl} alt="" style={{ height: "5mm", width: "5mm", objectFit: "contain" }} />
                  ) : null}
                  <div className="min-w-0 text-center font-black leading-tight" style={{ fontSize: `${codePx}px` }}>
                    <div className="truncate">{company?.name ?? ""}</div>
                    {company?.phone && (
                      <div className="font-mono font-bold opacity-60" dir="ltr" style={{ fontSize: `${Math.max(6, codePx - 1)}px` }}>
                        {company.phone}
                      </div>
                    )}
                  </div>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={l.dataUrl}
                  alt={l.code}
                  style={{ width: `${qrPct}%`, aspectRatio: "1", marginTop: "1.5mm", imageRendering: "pixelated" }}
                />
                <div className="mt-auto w-full truncate text-center font-black" style={{ fontSize: `${namePx}px` }}>
                  {l.name}
                </div>
                <div className="font-mono font-bold opacity-60" dir="ltr" style={{ fontSize: `${codePx}px` }}>
                  {l.code}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <style>{`@media print {
        .no-print { display: none !important; }
        body { background: #fff !important; }
        .qr-sheet { display: grid !important; }
        .qr-label { break-inside: avoid !important; border: 0.3mm solid #999 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      } @page { size: A4; margin: 10mm; }`}</style>
    </div>
  );
}
