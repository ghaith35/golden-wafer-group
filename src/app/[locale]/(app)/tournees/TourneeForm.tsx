"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none";

/// Secteur-only creation: pick a secteur and ALL its clients are uploaded to
/// the tournée automatically (server fills clientIds from secteurId).
/// Van + weekday can be preset (matrix "+" cells) — then shown as static
/// text instead of selects.
export function TourneeForm({
  locale,
  vans,
  secteurs,
  clients,
  labels,
  onSuccess,
  onClose,
  presetVanId,
  presetWeekday,
}: {
  locale: string;
  vans: Array<{ id: string; name: string; matricule: string | null }>;
  secteurs: Array<{ id: string; name: string }>;
  clients: Array<{ id: string; name: string; code: string; secteurId: string | null; gpsLat: number | null; gpsLng: number | null }>;
  labels: Record<string, string>;
  onSuccess?: (created?: { date?: unknown }) => void;
  onClose?: () => void;
  presetVanId?: string;
  presetWeekday?: number;
}) {
  const router = useRouter();
  const goBoard = () => {
    router.push(`/${locale}/tournees`);
    router.refresh();
  };
  const handleSuccess = onSuccess ?? goBoard;
  const handleClose = onClose ?? goBoard;
  const [locationId, setLocationId] = useState(presetVanId ?? vans[0]?.id ?? "");
  // Fixed weekly day (0 = Saturday … 6 = Friday). The stored date is the
  // upcoming occurrence of the chosen weekday — weeks repeat the schedule.
  const weekdayNames = (() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "long" });
    const sat = new Date(2026, 8, 26); // a Saturday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sat);
      d.setDate(d.getDate() + i);
      return fmt.format(d);
    });
  })();
  const [weekday, setWeekday] = useState(() => presetWeekday ?? (new Date().getDay() + 1) % 7);
  const [secteurId, setSecteurId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitGuard = useRef(false);

  const secteurClients = secteurId ? clients.filter((c) => c.secteurId === secteurId) : [];

  const presetVan = presetVanId ? vans.find((v) => v.id === presetVanId) : null;

  async function submit() {
    if (submitGuard.current) return;
    setError(null);
    if (!locationId) {
      setError(labels.missingFields ?? "missing_fields");
      return;
    }
    if (!secteurId) {
      setError(labels.secteurRequired ?? "secteur_required");
      return;
    }
    // Upcoming date for the chosen fixed weekday (0 = Saturday).
    const target = (weekday + 6) % 7; // JS getDay (Sat = 6)
    const d = new Date();
    d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7));
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    submitGuard.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/tournees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          locationId,
          secteurId,
          notes: notes || null,
          clientIds: [], // server uploads ALL clients of the secteur
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data.error as string | undefined;
        const issues = Array.isArray(data.issues)
          ? data.issues.map((i: { path?: Array<string | number>; message?: string }) => [...(i.path ?? []), i.message ?? ""].filter(Boolean).join(": ")).join("; ")
          : "";
        setError(code === "duplicate_day" ? (labels.duplicateDay ?? code) : ([code ?? "save_failed", issues].filter(Boolean).join(" — ")));
        return;
      }
      handleSuccess(data);
    } finally {
      submitGuard.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.weekday}</label>
            {presetWeekday != null ? (
              <div className="flex h-10 items-center rounded-lg bg-(--bg-sunken) px-2 text-sm font-black">
                {weekdayNames[presetWeekday]}
              </div>
            ) : (
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={inputCls}>
                {weekdayNames.map((n, i) => (
                  <option key={i} value={i}>{n}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.van}</label>
            {presetVan ? (
              <div className="flex h-10 items-center rounded-lg bg-(--bg-sunken) px-2 text-sm font-black">
                {presetVan.name}
              </div>
            ) : (
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {vans.map((v) => (
                  <option key={v.id} value={v.id}>{v.name} {v.matricule ? `· ${v.matricule}` : ""}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.secteur}</label>
            <select value={secteurId} onChange={(e) => setSecteurId(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {secteurs.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {secteurs.length === 0 && (
              <p className="mt-1 text-[11px] font-bold text-amber-600">
                <a href={`/${locale}/settings/sectors`} className="underline">→ {labels.secteur}</a>
              </p>
            )}
          </div>
        </div>
        <div className="mt-2">
          <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="mt-2 rounded-xl bg-(--brand-500)/10 px-3 py-2 text-sm font-black text-(--brand-600)">
          {secteurId
            ? `${secteurClients.length} ${labels.stops} · ${labels.allClients}`
            : (labels.secteurRequired ?? "")}
        </div>
      </Card>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleClose} className="flex-1">{labels.cancel}</Button>
        <Button onClick={submit} disabled={busy} className="flex-[2]">{labels.save}</Button>
      </div>
    </div>
  );
}
