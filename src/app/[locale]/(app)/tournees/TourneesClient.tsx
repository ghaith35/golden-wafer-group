"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, ChevronRight, ChevronLeft, CalendarDays, Pencil, Trash2, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import { TourneeDay } from "./[id]/TourneeDay";
import { TourneeForm } from "./TourneeForm";
import { OrderedStops } from "./OrderedStops";
import { useSavedDistances, useTourLegs } from "@/lib/geo";

type BoardStop = {
  id: string;
  visited: boolean;
  sold: boolean;
  skipped?: boolean;
  client?: { id: string; name: string; code: string; gpsLat: number | null; gpsLng: number | null } | null;
};
type Row = {
  id: string;
  date: unknown;
  status: string;
  location: { id: string; name: string };
  secteur: { id: string; name: string } | null;
  stops: BoardStop[];
};

type DayDetail = {
  id: string;
  date: unknown;
  status: string;
  locationId: string;
  location: { name: string };
  secteur: { name: string } | null;
  stops: Array<{
    id: string; position: number; visited: boolean; sold: boolean; skipped: boolean;
    total: unknown; clientId: string;
    client: { id: string; name: string; code: string; phone: string | null; gpsLat: number | null; gpsLng: number | null };
  }>;
  sales: Array<{ id: string; number: string; total: unknown; client: { name: string } | null }>;
};

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/// Saturday-start week (DZ weekend): the 7 fixed days always shown.
function weekStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 1) % 7));
  return x;
}

export function TourneesClient({
  locale,
  initial,
  vans: initialVans,
  isAdmin,
  labels,
}: {
  locale: string;
  initial: Row[];
  vans: Array<{ id: string; name: string; marque: string | null; matricule: string | null; imageUrl: string | null; user: { fullName: string } | null }>;
  isAdmin: boolean;
  labels: Record<string, string>;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [q, setQ] = useState("");
  const [vans, setVans] = useState(initialVans);
  const [rows, setRows] = useState(initial);
  const [day, setDay] = useState<DayDetail | null>(null);
  // Preset creation from a matrix "+" cell (van + weekday locked in the form).
  const [preset, setPreset] = useState<{ vanId: string; weekday: number } | null>(null);
  // Live position (refresh button) → per-client distances.
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState<{
    secteurs: Array<{ id: string; name: string }>;
    clients: Array<{ id: string; name: string; code: string; secteurId: string | null; gpsLat: number | null; gpsLng: number | null }>;
  } | null>(null);
  const [editingStops, setEditingStops] = useState<{ id: string; secteurId: string | null; stopIds: string[] } | null>(null);
  const [deletingTour, setDeletingTour] = useState<{ id: string; label: string } | null>(null);

  async function reload() {
    const res = await fetch("/api/tournees?take=500");
    if (res.ok) setRows(await res.json());
  }

  async function openCreate() {
    setPreset(null);
    setCreating(true);
    if (!formData) {
      const [sec, cli] = await Promise.all([
        fetch("/api/settings/secteurs").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/clients").then((r) => (r.ok ? r.json() : [])),
      ]);
      setFormData({ secteurs: sec, clients: cli });
    }
  }

  async function openDay(id: string) {
    const res = await fetch(`/api/tournees/${id}`);
    if (!res.ok) return;
    setDay(await res.json());
  }

  async function refreshDay(id: string) {
    await reload();
    const res = await fetch(`/api/tournees/${id}`);
    if (res.ok) setDay(await res.json());
  }

  const { pos, locating, geoError, locate, setManual } = useSavedDistances({
    unitM: labels.unitM, unitKm: labels.unitKm, unitMin: labels.unitMin,
  });
  const [manualPos, setManualPos] = useState("");
  const [manualBad, setManualBad] = useState(false);

  // Global GPS feature flag (settings toggle). Geo UI hides when off.
  const [geoOn, setGeoOn] = useState(true);
  useEffect(() => {
    fetch("/api/settings/public")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.gpsEnabled === "boolean") setGeoOn(d.gpsEnabled);
      })
      .catch(() => {});
  }, []);

  async function confirmTourDelete() {
    if (!deletingTour) return;
    const res = await fetch(`/api/tournees/${deletingTour.id}`, { method: "DELETE" });
    if (!res.ok) return;
    setDeletingTour(null);
    if (day?.id === deletingTour.id) setDay(null);
    await reload();
  }
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const start = useMemo(() => {
    const s = weekStart(new Date());
    s.setDate(s.getDate() + weekOffset * 7);
    return s;
  }, [weekOffset]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  }), [start]);

  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  // Matrix lookup: van × day → tour (OPEN first, else first).
  const tourFor = (van: string, key: string): Row | undefined => {
    const list = rows.filter((r) => r.location.id === van && dayKey(new Date(r.date as string)) === key);
    return list.find((r) => r.status === "OPEN") ?? list[0];
  };

  const dayLabels = {
    stops: labels.stops,
    locate: labels.locate, geoDenied: labels.geoDenied,
    unitM: labels.unitM, unitKm: labels.unitKm, unitMin: labels.unitMin,
  };

  const weekRows = useMemo(
    () => rows.filter((r) => days.some((d) => dayKey(d) === dayKey(new Date(r.date as string)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, weekOffset]
  );
  const totalStops = weekRows.reduce((s, r) => s + r.stops.length, 0);
  const shownVans = useMemo(
    () => vans.filter((v) => !q || v.name.includes(q) || (v.matricule ?? "").includes(q)),
    [vans, q]
  );

  const fmtDay = new Intl.DateTimeFormat(locale, { weekday: "long" });

  return (
    <div className="space-y-4 p-5 md:p-6 lg:flex lg:h-[calc(100dvh-57px)] lg:flex-col lg:space-y-3 lg:overflow-hidden">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-brand text-white shadow-lg">
            <CalendarDays size={22} />
          </div>
          <div>
            <h1 className="text-xl font-black leading-tight">{labels.title}</h1>
            <p className="text-xs opacity-60">
              {vans.length} · {weekRows.length} · {totalStops} {labels.stops}
            </p>
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        {isAdmin && (
          <Button onClick={() => void openCreate()} className="shrink-0">
            <Plus size={16} className="me-1" />
            {labels.neW}
          </Button>
        )}
        <div className="flex-1">
          <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {/* GPS refresh */}
      <div className="flex shrink-0 items-center gap-2">
        {geoOn && (
          <button
            type="button"
            onClick={() => locate()}
            disabled={locating}
            title={labels.locate}
            className="ms-auto flex shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-(--border-default) px-3 py-2 text-xs font-black text-(--text-secondary) transition-colors hover:border-(--brand-500) hover:text-(--brand-600) disabled:opacity-50"
          >
            <Crosshair size={14} className={locating ? "animate-spin" : ""} />
            {locating ? "…" : labels.locate}
          </button>
        )}
      </div>
      {geoOn && geoError && (
        <p className="shrink-0 rounded-xl bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-500">{labels.geoDenied}</p>
      )}
      {geoOn && geoError && (
        <div className="flex shrink-0 gap-1">
          <Input
            value={manualPos}
            onChange={(e) => setManualPos(e.target.value)}
            placeholder="36.75, 3.06"
            dir="ltr"
            className="h-9 font-mono text-xs"
          />
          <Button
            type="button"
            variant="secondary"
            className="h-9 shrink-0 px-2 text-xs"
            onClick={() => {
              setManualBad(!setManual(manualPos));
            }}
          >
            OK
          </Button>
        </div>
      )}
      {geoOn && manualBad && (
        <p className="shrink-0 rounded-xl bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-500">{labels.geoDenied}</p>
      )}

      {/* Matrix: vans × 7 days, cells = secteur. Tap a cell for its clients. */}
      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-(--border-default) bg-(--bg-overlay)">
        <table className="w-full min-w-[880px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky start-0 z-10 border-b border-(--border-default) bg-(--bg-overlay) p-2.5 text-start text-xs font-black opacity-70">
                {labels.van}
              </th>
              {days.map((d) => {
                const isToday = sameDay(d, today);
                return (
                  <th
                    key={dayKey(d)}
                    className={cn(
                      "min-w-32 border-b border-(--border-default) bg-(--bg-overlay) p-2.5 text-center text-xs font-black",
                      isToday ? "text-(--brand-600)" : "opacity-70"
                    )}
                  >
                    {fmtDay.format(d)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shownVans.map((v) => (
              <tr key={v.id} className="align-top">
                <th className="sticky start-0 border-b border-(--border-subtle) bg-(--bg-overlay) p-2 text-start">
                  <div className="flex items-center gap-2">
                    <span className="relative h-10 w-14 shrink-0 overflow-hidden rounded-lg">
                      {v.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={v.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center bg-gradient-brand text-base text-white">
                          🚚
                        </span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-black leading-tight">{v.name}</span>
                      <span className="block truncate font-mono text-[10px] opacity-60" dir="ltr">{v.matricule ?? ""}</span>
                      <span className="block truncate text-[10px] opacity-60">
                        {v.marque ?? ""}{v.user ? ` · 👨‍✈️ ${v.user.fullName}` : ""}
                      </span>
                    </span>
                  </div>
                </th>
                {days.map((d) => {
                  const t = tourFor(v.id, dayKey(d));
                  return (
                    <td key={dayKey(d)} className="border-b border-(--border-subtle) p-1.5">
                      {t ? (
                        <div className="flex items-stretch gap-1">
                          <button
                            type="button"
                            onClick={() => void openDay(t.id)}
                            className={cn(
                              "min-w-0 flex-1 rounded-xl border p-2 text-start transition-colors",
                              t.status === "OPEN"
                                ? "border-(--brand-500)/40 bg-(--brand-500)/5 hover:border-(--brand-500)"
                                : "border-(--border-default) opacity-60 hover:border-(--brand-500)"
                            )}
                          >
                            <span className="block truncate text-xs font-black">
                              {t.secteur?.name ?? "—"}
                            </span>
                            <span className="mt-0.5 block text-[11px] font-bold opacity-70">
                              {t.stops.length} {labels.stops}
                            </span>
                          </button>
                          {isAdmin && (
                            <span className="flex shrink-0 flex-col gap-1">
                              <button
                                type="button"
                                title={labels.edit}
                                aria-label={labels.edit}
                                onClick={() => setEditingStops({ id: t.id, secteurId: t.secteur?.id ?? null, stopIds: t.stops.map((s) => s.client?.id ?? s.id) })}
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 hover:bg-amber-500/25"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                title={labels.delete}
                                aria-label={labels.delete}
                                onClick={() => setDeletingTour({ id: t.id, label: `${v.name} · ${fmtDay.format(d)}` })}
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/15 text-red-500 hover:bg-red-500/25"
                              >
                                <Trash2 size={13} />
                              </button>
                            </span>
                          )}
                        </div>
                      ) : isAdmin ? (
                        <button
                          type="button"
                          onClick={() => {
                            setPreset({ vanId: v.id, weekday: (d.getDay() + 1) % 7 });
                            setCreating(true);
                          }}
                          aria-label={labels.neW}
                          className="flex h-[52px] w-full items-center justify-center rounded-xl border border-dashed border-(--border-default) text-xl font-black opacity-40 transition-colors hover:border-(--brand-500) hover:text-(--brand-600) hover:opacity-100"
                        >
                          +
                        </button>
                      ) : (
                        <p className="py-3 text-center text-[11px] opacity-40">—</p>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {shownVans.length === 0 && (
          <p className="p-4 text-center text-xs opacity-60">{labels.empty}</p>
        )}
      </div>

      {vans.length === 0 && (
        <p className="text-xs opacity-60">{labels.empty}</p>
      )}

      {/* Creation popup — secteur only, van/day preset from "+" cells */}
      <Modal
        open={creating}
        onClose={() => { setCreating(false); setPreset(null); }}
        title={labels.neW}
        subtitle={labels.title}
        icon="+"
        width="xl"
      >
        {formData && (
          <TourneeForm
            key={preset ? `${preset.vanId}-${preset.weekday}` : "new"}
            locale={locale}
            vans={vans.map((v) => ({ id: v.id, name: v.name, matricule: v.matricule ?? null }))}
            secteurs={formData.secteurs}
            clients={formData.clients.map((c) => ({
              id: c.id, name: c.name, code: c.code, secteurId: c.secteurId,
              gpsLat: c.gpsLat != null ? Number(c.gpsLat) : null,
              gpsLng: c.gpsLng != null ? Number(c.gpsLng) : null,
            }))}
            labels={{
              weekday: labels.weekday, van: labels.van, secteur: labels.secteur,
              notes: labels.notes, stops: labels.stops, save: labels.save, cancel: labels.cancel,
              secteurRequired: labels.secteurRequired, allClients: labels.allClients,
              missingFields: labels.missingFields, duplicateDay: labels.duplicateDay,
            }}
            presetVanId={preset?.vanId}
            presetWeekday={preset?.weekday}
            onSuccess={(created) => {
              setCreating(false);
              setPreset(null);
              // Jump the board to the created tour's week so it shows immediately.
              if (created?.date) {
                const nd = new Date(created.date as string);
                if (!Number.isNaN(nd.getTime())) {
                  const diff = weekStart(nd).getTime() - weekStart(new Date()).getTime();
                  setWeekOffset(Math.round(diff / (7 * 86400000)));
                }
              }
              void reload();
            }}
            onClose={() => { setCreating(false); setPreset(null); }}
          />
        )}
      </Modal>

      {/* Execution popup — the day form, no page redirect */}
      <Modal
        open={day !== null}
        onClose={() => setDay(null)}
        title={day ? `${new Date(day.date as string).toLocaleDateString(locale)} · ${day.location.name}${day.secteur ? ` · ${day.secteur.name}` : ""}` : ""}
        subtitle={labels.title}
        width="xl"
      >
        {day && (
          <div className="space-y-4">
            <TourneeDay
              locale={locale}
              tourneeId={day.id}
              locationId={day.locationId}
              isOpen={day.status === "OPEN"}
              stops={day.stops.map((s) => ({ ...s, total: Number(s.total ?? 0) }))}
              sales={day.sales}
              labels={dayLabels}
              onChanged={() => void refreshDay(day.id)}
            />
          </div>
        )}
      </Modal>

      {/* Modify stops popup */}
      <Modal
        open={editingStops !== null}
        onClose={() => setEditingStops(null)}
        title={labels.edit}
        subtitle={labels.title}
        icon="✎"
      >
        {editingStops && (
          <StopEditor
            secteurId={editingStops.secteurId}
            initial={editingStops.stopIds}
            labels={labels}
            geoOn={geoOn}
            onClose={() => setEditingStops(null)}
            onSaved={async (ids) => {
              const res = await fetch(`/api/tournees/${editingStops.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientIds: ids }),
              });
              if (res.ok) {
                setEditingStops(null);
                await reload();
                if (day?.id === editingStops.id) void refreshDay(day.id);
              }
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={deletingTour !== null}
        onClose={() => setDeletingTour(null)}
        onConfirm={confirmTourDelete}
        title={labels.deleteTitle}
        message={deletingTour ? labels.deleteMessage.replace("{name}", deletingTour.label) : ""}
      />
    </div>
  );
}

/// Stop modify editor: ordered visit timeline (drag to reorder) with live
/// distance + ETA per stop, plus secteur picker to add more.
function StopEditor({
  secteurId,
  initial,
  labels,
  onClose,
  onSaved,
  geoOn = true,
}: {
  secteurId: string | null;
  initial: string[];
  labels: Record<string, string>;
  onClose: () => void;
  onSaved: (ids: string[]) => Promise<void>;
  geoOn?: boolean;
}) {
  const [clients, setClients] = useState<Array<{ id: string; name: string; code: string; secteurId: string | null; gpsLat: unknown; gpsLng: unknown }>>([]);
  const [ordered, setOrdered] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  const { locating, geoError, locate, setManual, pos } = useSavedDistances({
    unitM: labels.unitM, unitKm: labels.unitKm, unitMin: labels.unitMin,
  });
  const [manual, setManualText] = useState("");
  const [manualBad, setManualBad] = useState(false);

  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const legPoints = useMemo(
    () =>
      ordered.flatMap((id) => {
        const c = byId.get(id);
        if (!c || c.gpsLat == null || c.gpsLng == null) return [];
        const la = Number(c.gpsLat);
        const ln = Number(c.gpsLng);
        return Number.isFinite(la) && Number.isFinite(ln) ? [{ id, lat: la, lng: ln }] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordered, byId]
  );
  const { meta: legMeta, total: legTotal } = useTourLegs(
    pos,
    legPoints,
    { unitM: labels.unitM, unitKm: labels.unitKm, unitMin: labels.unitMin },
    { persist: false }
  );
  const metaOf = (id: string): string | null => (geoOn ? legMeta.get(id) ?? null : null);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setClients(rows as Array<{ id: string; name: string; code: string; secteurId: string | null; gpsLat: unknown; gpsLng: unknown }>))
      .catch(() => {});
  }, []);

  const visibleClients = secteurId ? clients.filter((c) => c.secteurId === secteurId) : clients;
  const available = visibleClients.filter((c) => !ordered.includes(c.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase opacity-60">
          {labels.stops} ({ordered.length})
          {geoOn && legTotal && <span className="ms-2 font-mono text-sky-600" dir="ltr">Σ {legTotal}</span>}
        </div>
        {geoOn && (
        <button
          type="button"
          onClick={() => locate()}
          disabled={locating}
          className="flex items-center gap-1 rounded-lg bg-(--bg-sunken) px-2.5 py-1.5 text-xs font-black disabled:opacity-50"
        >
          <Crosshair size={13} className={locating ? "animate-spin" : ""} />
          {locating ? "…" : labels.locate}
        </button>
        )}
      </div>
      {geoOn && geoError && <p className="text-xs font-bold text-red-500">{labels.geoDenied}</p>}
      {geoOn && geoError && (
        <div className="flex gap-2">
          <Input
            value={manual}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="36.75, 3.06"
            dir="ltr"
            className="font-mono"
          />
          <Button type="button" variant="secondary" onClick={() => setManualBad(!setManual(manual))}>
            {labels.geoManual}
          </Button>
        </div>
      )}
      {geoOn && manualBad && <p className="text-xs font-bold text-red-500">{labels.geoDenied}</p>}
      <OrderedStops
        items={ordered.map((id) => {
          const c = byId.get(id);
          return { id, name: c?.name ?? "…", code: c?.code ?? "" };
        })}
        onOrder={setOrdered}
        onRemove={(id) => setOrdered((prev) => prev.filter((x) => x !== id))}
        metaText={metaOf}
      />

      <div>
        <div className="mb-1 text-xs font-bold uppercase opacity-60">{labels.stops}</div>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {available.map((c) => {
            const meta = metaOf(c.id);
            return (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-(--bg-sunken)">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => setOrdered((prev) => [...prev, c.id])}
                  className="h-4 w-4 shrink-0 accent-(--brand-500)"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold leading-tight">{c.name}</span>
                  <span className="block font-mono text-[11px] opacity-50">
                    {c.code}{meta ? <span className="font-bold text-sky-600"> · {meta}</span> : ""}
                  </span>
                </span>
              </label>
            );
          })}
          {available.length === 0 && <p className="py-2 text-center text-xs opacity-60">✓</p>}
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          {labels.cancel}
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSaved(ordered);
            } finally {
              setBusy(false);
            }
          }}
          className="flex-[2]"
        >
          {labels.save} ({ordered.length})
        </Button>
      </div>
    </div>
  );
}
