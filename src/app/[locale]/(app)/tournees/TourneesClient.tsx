"use client";

import { ClientName } from "@/components/clients/ClientName";
import { useEffect, useMemo, useState } from "react";
import { Plus, CalendarCheck, CalendarDays, Pencil, Trash2, Crosshair, Route } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { KpiCard } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { compareNatural } from "@/lib/sort";
import { TourneeDay } from "./[id]/TourneeDay";
import { TourneeForm } from "./TourneeForm";
import { OrderedStops } from "./OrderedStops";
import { useSavedDistances, useTourLegs } from "@/lib/geo";
import { addDaysKey, algiersDayKey, weekStartKey } from "@/lib/tournees/days";
import { nextDueKey } from "@/lib/tournees/plans-pure";
import { useSyncedState } from "@/lib/data-sync";

import { ErrText } from "@/components/ui/ErrText";
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
  autoClosed?: boolean | null;
  /// Recurring plan this day came from (null = one-off) and its cell slot.
  planId?: string | null;
  slot?: number;
  location: { id: string; name: string };
  secteur: { id: string; name: string } | null;
  stops: BoardStop[];
};

type Plan = {
  id: string; locationId: string; secteurId: string | null; secteurName: string | null;
  weekday: number; intervalWeeks: number; anchorKey: string; slot: number; custom: boolean;
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
  sales: Array<{ id: string; number: string; total: unknown; client: { name: string; gpsLat?: number | string | null; gpsLng?: number | string | null } | null }>;
};

/// Calendar day key → a Date at noon UTC (safe to format with timeZone "UTC").
const keyDate = (key: string) => new Date(`${key}T12:00:00Z`);

export function TourneesClient({
  locale,
  initial,
  plans: initialPlans,
  vans: initialVans,
  isAdmin,
  labels,
}: {
  locale: string;
  initial: Row[];
  /// Active recurring tours (endless, weekly or every 2 weeks).
  plans: Plan[];
  vans: Array<{ id: string; name: string; marque: string | null; matricule: string | null; imageUrl: string | null; user: { fullName: string } | null }>;
  isAdmin: boolean;
  labels: Record<string, string>;
}) {
  const [error, setError] = useState<string | null>(null);
  const fail = (code?: string) => setError(`${labels.actionFailed}${code ? ` (${code})` : ""}`);
  const [q, setQ] = useState("");
  const [vans, setVans] = useSyncedState(initialVans);
  const [rows, setRows] = useSyncedState(initial);
  const [plans, setPlans] = useSyncedState(initialPlans);
  const [day, setDay] = useState<DayDetail | null>(null);
  // Preset creation from a matrix "+" cell (van + weekday locked in the form).
  const [preset, setPreset] = useState<{ vanId: string; weekday: number; date: string } | null>(null);
  // Live position (refresh button) → per-client distances.
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState<{
    secteurs: Array<{ id: string; name: string }>;
    clients: Array<{ id: string; name: string; code: string; secteurId: string | null; gpsLat: number | null; gpsLng: number | null }>;
  } | null>(null);
  const [editingStops, setEditingStops] = useState<{ id: string; secteurId: string | null; stopIds: string[] } | null>(null);
  /// id = a generated day (null for a "ghost" plan chip); planId = its recurring plan.
  const [deletingTour, setDeletingTour] = useState<{ id: string | null; planId: string | null; label: string } | null>(null);

  async function reload() {
    const [res, pr] = await Promise.all([fetch("/api/tournees?take=500"), fetch("/api/tournees/plans")]);
    if (res.ok) setRows(await res.json());
    if (pr.ok) setPlans(await pr.json());
  }

  async function openCreate(keepPreset = false) {
    if (!keepPreset) setPreset(null);
    setCreating(true);
    // Always refetch: a secteur/client added since last time must show up.
    const [sec, cli] = await Promise.all([
      fetch("/api/settings/secteurs").then((r) => (r.ok ? r.json() : formData?.secteurs ?? [])),
      fetch("/api/clients").then((r) => (r.ok ? r.json() : formData?.clients ?? [])),
    ]);
    setFormData({ secteurs: sec, clients: cli });
  }

  async function openDay(id: string) {
    const res = await fetch(`/api/tournees/${id}`);
    if (!res.ok) return fail(String(res.status));
    setError(null);
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

  /// "this day only" (the plan keeps running) · "end the recurring tour" (no
  /// more days from now on) · plain delete of a one-off.
  async function runDelete(mode: "day" | "plan" | "oneoff") {
    const d = deletingTour;
    if (!d) return;
    const url =
      mode === "plan" && d.planId ? `/api/tournees/plans/${d.planId}`
      : mode === "oneoff" && d.id ? `/api/tournees/${d.id}?series=1`
      : d.id ? `/api/tournees/${d.id}` : "";
    if (!url) return setDeletingTour(null);
    const res = await fetch(url, { method: "DELETE" });
    setDeletingTour(null);
    if (!res.ok) return fail(String(res.status));
    if (d.id && day?.id === d.id) setDay(null);
    await reload();
  }
  // All day maths is on the Algiers calendar (YYYY-MM-DD keys) — the same
  // calendar the server uses — so a tour never lands in the wrong column
  // because of the device timezone.
  const todayKey = algiersDayKey(new Date());
  const currentWeekKey = weekStartKey(todayKey);
  // One fixed weekly plan: the board always shows the current week (no navigation).
  const startKey = currentWeekKey;
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysKey(startKey, i)), [startKey]);

  // Weekly recurrence: every week shows the same tours — the server fills any
  // empty van/weekday cell of this (current or future) week from the van's
  // latest earlier tour, then we reload the board once.
  useEffect(() => {
    if (startKey < currentWeekKey) return;
    let cancelled = false;
    fetch("/api/tournees/ensure-week", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart: startKey }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.created > 0) void reload();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey]);
  const rowKey = (r: Row) => algiersDayKey(new Date(r.date as string));
  // Matrix lookup: van × day → its tours (a cell holds up to two), by slot.
  const toursFor = (van: string, key: string): Row[] =>
    rows
      .filter((r) => r.location.id === van && rowKey(r) === key)
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));

  const dayLabels = {
    stops: labels.stops,
    locate: labels.locate, geoDenied: labels.geoDenied,
    unitM: labels.unitM, unitKm: labels.unitKm, unitMin: labels.unitMin,
  };

  const weekRows = useMemo(
    () => rows.filter((r) => days.includes(algiersDayKey(new Date(r.date as string)))),
    [rows, days]
  );
  const totalStops = weekRows.reduce((s, r) => s + r.stops.length, 0);
  const shownVans = useMemo(
    () => vans.filter((v) => {
      const n = q.trim().toLowerCase();
      return !n || v.name.toLowerCase().includes(n) || (v.matricule ?? "").toLowerCase().includes(n)
        || (v.user?.fullName ?? "").toLowerCase().includes(n);
    })
      .sort((a, b) => compareNatural(a.name, b.name, locale)),
    [vans, q, locale]
  );

  const fmtDay = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });

  return (
    <div className="space-y-4 p-5 md:p-6 lg:flex lg:h-[calc(var(--vh)-57px)] lg:flex-col lg:space-y-3 lg:overflow-hidden">
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <KpiCard
          label={labels.today}
          value={String(weekRows.filter((r) => rowKey(r) === todayKey).length)}
          icon={<CalendarCheck size={18} />}
          accent="bg-emerald-500/15 text-emerald-600"
          valueClassName="whitespace-normal! text-clip! break-words leading-tight"
          compact
        />
        <KpiCard
          label={labels.open}
          value={String(weekRows.filter((r) => r.status === "OPEN").length)}
          icon={<Route size={18} />}
          accent="bg-sky-500/15 text-sky-600"
          valueClassName="whitespace-normal! text-clip! break-words leading-tight"
          compact
        />
        <KpiCard
          label={labels.stops}
          value={String(totalStops)}
          icon={<CalendarDays size={18} />}
          accent="bg-violet-500/15 text-violet-500"
          valueClassName="whitespace-normal! text-clip! break-words leading-tight"
          compact
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {isAdmin && (
          <Button onClick={() => void openCreate(false)} className="shrink-0">
            <Plus size={16} className="me-1" />
            {labels.neW}
          </Button>
        )}
        {geoOn && (
          <button
            type="button"
            onClick={() => locate()}
            disabled={locating}
            title={labels.locate}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-(--border-default) px-3 py-2 text-xs font-black text-(--text-secondary) transition-colors hover:border-(--brand-500) hover:text-(--brand-600) disabled:opacity-50"
          >
            <Crosshair size={14} className={locating ? "animate-spin" : ""} />
            {locating ? "…" : labels.locate}
          </button>
        )}
        <div className="order-last min-w-0 basis-full sm:order-none sm:min-w-40 sm:basis-0 sm:flex-1">
          <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {error && (
        <p role="alert" className="shrink-0 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-bold text-red-500"><ErrText code={error} /></p>
      )}

      {/* GPS refresh */}
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
                const isToday = d === todayKey;
                return (
                  <th
                    key={d}
                    className={cn(
                      "min-w-32 border-b border-(--border-default) bg-(--bg-overlay) p-2.5 text-center text-xs font-black",
                      isToday ? "text-(--brand-600)" : "opacity-70"
                    )}
                  >
                    {fmtDay.format(keyDate(d))}
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
                        <span className="flex h-full w-full items-center justify-center bg-gradient-brand text-base text-(--brand-contrast)">
                          🚚
                        </span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-black leading-tight">{v.name}</span>
                      <span className="block truncate font-mono text-[11px] opacity-60" dir="ltr">{v.matricule ?? ""}</span>
                      <span className="block truncate text-[11px] opacity-60">
                        {v.marque ?? ""}{v.user ? ` · 👨‍✈️ ${v.user.fullName}` : ""}
                      </span>
                    </span>
                  </div>
                </th>
                {days.map((d) => {
                  const dayTours = toursFor(v.id, d);
                  const weekdayNum = keyDate(d).getUTCDay();
                  const cellPlans = plans.filter((p) => p.locationId === v.id && p.weekday === weekdayNum);
                  // Plans of this cell with no day generated here (not their week / removed day).
                  const ghosts = cellPlans.filter((p) => !dayTours.some((t) => t.planId === p.id));
                  const capacity = cellPlans.length + dayTours.filter((t) => !t.planId).length;
                  const full = capacity >= 2;
                  const tag = (planId: string | null | undefined) => {
                    const pl = planId ? plans.find((p) => p.id === planId) : null;
                    return pl ? (pl.intervalWeeks === 2 ? { icon: "↻²", text: labels.biweeklyTag } : { icon: "↻", text: labels.weeklyTag }) : null;
                  };
                  const addCell = (compact: boolean) => (
                    <button
                      type="button"
                      onClick={() => {
                        setPreset({ vanId: v.id, weekday: (keyDate(d).getUTCDay() + 1) % 7, date: d });
                        void openCreate(true);
                      }}
                      aria-label={labels.neW}
                      className={cn(
                        "flex w-full items-center justify-center rounded-xl border border-dashed border-(--border-default) font-black opacity-40 transition-colors hover:border-(--brand-500) hover:text-(--brand-600) hover:opacity-100",
                        compact ? "mt-1 h-7 text-sm" : "h-[52px] text-xl"
                      )}
                    >
                      +
                    </button>
                  );
                  return (
                    <td key={d} className="border-b border-(--border-subtle) p-1.5 align-top">
                      <div className="space-y-1">
                        {dayTours.map((t) => {
                          const tg = tag(t.planId);
                          return (
                            <div key={t.id} className="flex items-stretch gap-1">
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
                                <span className="flex items-center gap-1.5">
                                  <span className="block min-w-0 flex-1 truncate text-xs font-black">{t.secteur?.name ?? "—"}</span>
                                  {tg && (
                                    <span title={tg.text} className="shrink-0 rounded-md bg-(--brand-500)/15 px-1 text-[11px] font-black text-(--brand-600)" dir="ltr">{tg.icon}</span>
                                  )}
                                </span>
                                <span className="mt-0.5 block text-[11px] font-bold opacity-70">
                                  {t.stops.length} {labels.stops}
                                  {t.autoClosed ? ` · ⚠ ${labels.unclosed}` : ""}
                                </span>
                              </button>
                              {isAdmin && (
                                <span className="flex shrink-0 flex-col gap-1">
                                  <button
                                    type="button"
                                    title={labels.edit}
                                    aria-label={labels.edit}
                                    onClick={() => setEditingStops({ id: t.id, secteurId: t.secteur?.id ?? null, stopIds: t.stops.map((s) => s.client?.id ?? s.id) })}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 hover:bg-amber-500/25"
                                  >
                                    <Pencil size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    title={labels.delete}
                                    aria-label={labels.delete}
                                    onClick={() => setDeletingTour({ id: t.id, planId: t.planId ?? null, label: `${v.name} · ${fmtDay.format(keyDate(d))}` })}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/15 text-red-500 hover:bg-red-500/25"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {ghosts.map((p) => {
                          const next = nextDueKey(p, d);
                          return (
                            <div key={`g-${p.id}`} className="flex items-stretch gap-1">
                              <div className="min-w-0 flex-1 rounded-xl border border-dashed border-(--border-default) p-2 opacity-70">
                                <span className="flex items-center gap-1.5">
                                  <span className="block min-w-0 flex-1 truncate text-xs font-black">{p.secteurName ?? "—"}</span>
                                  <span className="shrink-0 rounded-md bg-(--bg-sunken) px-1 text-[11px] font-black" dir="ltr">{p.intervalWeeks === 2 ? "↻²" : "↻"}</span>
                                </span>
                                <span className="mt-0.5 block text-[11px] font-bold opacity-70" dir="auto">
                                  {labels.nextOn}: {next ? new Date(`${next}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" }) : "—"}
                                </span>
                              </div>
                              {isAdmin && (
                                <button
                                  type="button"
                                  title={labels.endPlan}
                                  aria-label={labels.endPlan}
                                  onClick={() => setDeletingTour({ id: null, planId: p.id, label: `${v.name} · ${p.secteurName ?? ""}` })}
                                  className="flex w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-500 hover:bg-red-500/25"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {isAdmin && !full && addCell(dayTours.length + ghosts.length > 0)}
                        {!isAdmin && dayTours.length + ghosts.length === 0 && <p className="py-3 text-center text-[11px] opacity-40">—</p>}
                      </div>
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
            key={preset ? `${preset.vanId}-${preset.date}` : `new-${startKey}`}
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
              frequency: labels.frequency, freqWeekly: labels.freqWeekly, freqWeeklyHint: labels.freqWeeklyHint,
              freqBiweekly: labels.freqBiweekly, freqBiweeklyHint: labels.freqBiweeklyHint,
              pickSector: labels.pickSector, week1: labels.week1, thenEvery2: labels.thenEvery2,
            }}
            presetVanId={preset?.vanId}
            presetWeekday={preset?.weekday}
            presetDate={preset?.date}
            weekStartKey={startKey}
            onSuccess={() => {
              setCreating(false);
              setPreset(null);
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
        title={day ? `${keyDate(algiersDayKey(new Date(day.date as string))).toLocaleDateString(locale, { timeZone: "UTC" })} · ${day.location.name}${day.secteur ? ` · ${day.secteur.name}` : ""}` : ""}
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
              } else {
                fail(String(res.status));
              }
            }}
          />
        )}
      </Modal>

      {/* Remove: a recurring day offers "this day only" or "end the tour". */}
      <Modal
        open={deletingTour !== null}
        onClose={() => setDeletingTour(null)}
        title={labels.deleteTitle}
        subtitle={deletingTour?.label ?? ""}
        icon="🗑"
        width="sm"
      >
        {deletingTour && (
          <div className="space-y-2">
            {deletingTour.planId ? (
              <>
                {deletingTour.id && (
                  <button type="button" onClick={() => void runDelete("day")} className="w-full rounded-xl border border-(--border-default) p-3 text-start transition-colors hover:border-(--brand-500)">
                    <span className="block text-sm font-black">{labels.removeDay}</span>
                    <span className="block text-[11px] font-bold opacity-60">{labels.removeDayHint}</span>
                  </button>
                )}
                <button type="button" onClick={() => void runDelete("plan")} className="w-full rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-start transition-colors hover:border-red-500">
                  <span className="block text-sm font-black text-red-600">{labels.endPlan}</span>
                  <span className="block text-[11px] font-bold opacity-60">{labels.endPlanHint}</span>
                </button>
              </>
            ) : (
              <button type="button" onClick={() => void runDelete("oneoff")} className="w-full rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-start text-sm font-black text-red-600">
                {labels.deleteMessage.replace("{name}", deletingTour.label)}
              </button>
            )}
            <Button variant="secondary" onClick={() => setDeletingTour(null)} className="w-full">{labels.cancel}</Button>
          </div>
        )}
      </Modal>
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
                  <span className="block text-sm font-semibold leading-tight"><ClientName name={c.name} lat={c.gpsLat} lng={c.gpsLng} /></span>
                  <span className="block font-mono text-[11px] opacity-50" dir="ltr">
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
