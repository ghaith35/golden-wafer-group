"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type AreaValue = { wilayas: number[]; secteurs: string[] };
type W = { code: number; nameFr: string; nameAr: string };
type S = { id: string; name: string; wilayaCode: number };

/// Admin picker for a staffer's zones: tick a wilaya for ALL its secteurs,
/// or open it and tick individual secteurs. Nothing ticked = unrestricted
/// (the staffer sees every wilaya and secteur).
export function AreaPicker({
  locale,
  wilayas,
  secteurs,
  value,
  onChange,
  labels,
}: {
  locale: string;
  wilayas: W[];
  secteurs: S[];
  value: AreaValue;
  onChange: (v: AreaValue) => void;
  labels: Record<string, string>;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const nameOf = (w: W) => (locale === "ar" ? w.nameAr : w.nameFr);
  const byWilaya = useMemo(() => {
    const m = new Map<number, S[]>();
    for (const s of secteurs) m.set(s.wilayaCode, [...(m.get(s.wilayaCode) ?? []), s]);
    return m;
  }, [secteurs]);

  const needle = q.trim().toLowerCase();
  const rows = wilayas.filter((w) => {
    if (!needle) return true;
    return `${w.code} ${w.nameFr} ${w.nameAr}`.toLowerCase().includes(needle);
  });
  // Assigned wilayas float to the top so the admin sees what is set.
  const touched = (w: W) =>
    value.wilayas.includes(w.code) || (byWilaya.get(w.code) ?? []).some((s) => value.secteurs.includes(s.id));
  rows.sort((a, b) => Number(touched(b)) - Number(touched(a)) || a.code - b.code);

  function toggleWilaya(code: number) {
    const ids = new Set((byWilaya.get(code) ?? []).map((s) => s.id));
    if (value.wilayas.includes(code)) {
      onChange({ ...value, wilayas: value.wilayas.filter((c) => c !== code) });
    } else {
      onChange({
        wilayas: [...value.wilayas, code],
        secteurs: value.secteurs.filter((id) => !ids.has(id)),
      });
    }
  }
  function toggleSecteur(s: S) {
    onChange({
      ...value,
      secteurs: value.secteurs.includes(s.id) ? value.secteurs.filter((id) => id !== s.id) : [...value.secteurs, s.id],
    });
  }

  const total = value.wilayas.length + value.secteurs.length;

  return (
    <div className="grid gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black">{labels.areas}</div>
          <div className="text-xs opacity-60">{total === 0 ? labels.areasAll : labels.areasHint}</div>
        </div>
        {total > 0 && (
          <button type="button" className="text-xs font-bold text-(--brand-600) underline" onClick={() => onChange({ wilayas: [], secteurs: [] })}>
            {labels.areasClear}
          </button>
        )}
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={labels.areasSearch}
        className="h-10 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)"
      />
      <div className="max-h-64 overflow-y-auto rounded-lg border border-(--border-default) bg-(--bg-surface)">
        {rows.map((w) => {
          const list = byWilaya.get(w.code) ?? [];
          const whole = value.wilayas.includes(w.code);
          const some = !whole && list.some((s) => value.secteurs.includes(s.id));
          const expanded = open === w.code;
          return (
            <div key={w.code} className="border-b border-(--border-default) last:border-b-0">
              <div className={cn("flex items-center gap-2 px-2 py-1.5", (whole || some) && "bg-(--brand-50)")}>
                <input
                  type="checkbox"
                  checked={whole}
                  ref={(el) => {
                    if (el) el.indeterminate = some;
                  }}
                  onChange={() => toggleWilaya(w.code)}
                  aria-label={nameOf(w)}
                />
                <button type="button" className="flex flex-1 items-center justify-between text-start text-sm" onClick={() => setOpen(expanded ? null : w.code)}>
                  <span className="font-bold">
                    <bdi className="tabular-nums opacity-60">{String(w.code).padStart(2, "0")}</bdi> · {nameOf(w)}
                    {whole && <span className="ms-2 text-xs font-bold text-(--brand-600)">{labels.areasWhole}</span>}
                    {some && (
                      <span className="ms-2 text-xs font-bold text-(--brand-600)">
                        {list.filter((s) => value.secteurs.includes(s.id)).length}/{list.length}
                      </span>
                    )}
                  </span>
                  {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>
              {expanded && (
                <div className="grid gap-1 bg-(--bg-overlay) px-3 py-2">
                  {list.length === 0 ? (
                    <div className="text-xs opacity-60">{labels.areasNoSecteurs}</div>
                  ) : (
                    list.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={whole || value.secteurs.includes(s.id)} disabled={whole} onChange={() => toggleSecteur(s)} />
                        {s.name}
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
