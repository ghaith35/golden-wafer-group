"use client";

import { matchClient } from "@/lib/clients/display";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QrPrintModal } from "./QrThermalPrint";

type PickRow = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  secteur: { name: string } | null;
  wilaya: { code: number; nameAr: string } | null;
};

/// QR print wizard, all inside one popup (no page redirect):
/// step 1 — choose the clients (search / wilaya / secteur filters + select all),
/// step 2 — size + PDF preview/print, with a Back button to change the pick.
/// `initialIds` non-empty (rows ticked in the list) skips straight to step 2.
export function QrPrintWizard({
  rows,
  wilayas,
  secteurs,
  initialIds,
  ui,
}: {
  rows: PickRow[];
  wilayas: Array<{ code: number; nameAr: string }>;
  secteurs: Array<{ id: string; name: string; wilayaCode: number }>;
  initialIds: string[];
  ui: Record<string, string>;
}) {
  const [step, setStep] = useState<"pick" | "print">(initialIds.length ? "print" : "pick");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialIds));
  const [q, setQ] = useState("");
  const [wilaya, setWilaya] = useState("");
  const [secteur, setSecteur] = useState("");

  const secName = secteurs.find((s) => s.id === secteur)?.name;
  const filtered = useMemo(
    () =>
      rows.filter(
        (c) =>
          (!wilaya || c.wilaya?.code === Number(wilaya)) &&
          (!secName || c.secteur?.name === secName) &&
          matchClient(q, c)
      ),
    [rows, wilaya, secName, q]
  );
  const allShown = filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => {
      const n = new Set(s);
      if (allShown) filtered.forEach((c) => n.delete(c.id));
      else filtered.forEach((c) => n.add(c.id));
      return n;
    });
  }

  if (step === "print") {
    const ids = [...selected];
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setStep("pick")}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-(--bg-sunken) px-3 text-xs font-black"
        >
          <ArrowLeft size={14} className="rtl:rotate-180" />
          {ui.back} · {ids.length}
        </button>
        <QrPrintModal key={ids.join(",")} ids={ids} ui={ui} />
      </div>
    );
  }

  const selectCls = "h-11 min-w-0 flex-1 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm";
  return (
    <div className="space-y-3">
      <Input placeholder={ui.search} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex gap-2">
        <select value={wilaya} onChange={(e) => { setWilaya(e.target.value); setSecteur(""); }} className={selectCls}>
          <option value="">{ui.wilaya}</option>
          {wilayas.map((w) => (
            <option key={w.code} value={w.code}>{w.code} · {w.nameAr}</option>
          ))}
        </select>
        <select value={secteur} onChange={(e) => setSecteur(e.target.value)} className={selectCls}>
          <option value="">{ui.secteur}</option>
          {secteurs.filter((s) => !wilaya || s.wilayaCode === Number(wilaya)).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={toggleAll} className="h-9 rounded-lg bg-(--bg-sunken) px-3 text-xs font-black">
          {ui.selectAll} ({filtered.length})
        </button>
        <span className="text-xs font-bold tabular-nums opacity-60">{selected.size} ✓</span>
      </div>
      <div className="max-h-[48vh] space-y-1 overflow-y-auto rounded-xl border border-(--border-default) p-2">
        {filtered.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-(--bg-sunken)">
            <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4" />
            <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
            <span className="font-mono text-xs opacity-50" dir="ltr">{c.code}</span>
          </label>
        ))}
      </div>
      <Button className="w-full" disabled={selected.size === 0} onClick={() => setStep("print")}>
        {ui.next} ({selected.size})
        <ArrowRight size={15} className="ms-1 rtl:rotate-180" />
      </Button>
    </div>
  );
}
