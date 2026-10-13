"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bus, Check, Clock, Flag, Pencil } from "lucide-react";
import { KpiCard } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { dz } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  date: unknown;
  status: string;
  autoClosed?: boolean | null;
  startedAt: string | null;
  finishedAt: string | null;
  startedLat: number | null;
  startedLng: number | null;
  finishedLat: number | null;
  finishedLng: number | null;
  location: { id: string; name: string; matricule: string | null; user: { fullName: string } | null };
};

/// Late départ / overtime / unended day, computed from company expectations.
/// `unclosed` = the driver never ended the journée — the system closed it.
function flagsOf(
  r: Row,
  workStartAt: string | null,
  maxDayHours: number,
): { late: boolean; overtime: boolean; unclosed: boolean } {
  let late = false;
  if (workStartAt && r.startedAt) {
    const [h, m] = workStartAt.split(":").map(Number);
    const s = new Date(r.startedAt);
    const expected = new Date(s);
    expected.setHours(h || 0, m || 0, 0, 0);
    late = s.getTime() > expected.getTime() + 5 * 60 * 1000;
  }
  let overtime = false;
  if (r.startedAt && r.finishedAt && maxDayHours > 0) {
    overtime =
      (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 3600000 > maxDayHours;
  }
  return { late, overtime, unclosed: r.autoClosed === true };
}

function mapsUrl(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function fmtTime(v: string | null, locale: string): string {
  if (!v) return "—";
  return new Date(v).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function fmtDur(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const mins = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${dz(mins % 60)}` : `${dz(mins)} min`;
}

export function PresenceClient({
  locale,
  year,
  month,
  years,
  months,
  rows,
  labels,
  isAdmin,
  workStartAt,
  maxDayHours,
}: {
  locale: string;
  year: number;
  month: number;
  years: number[];
  months: number[];
  rows: Row[];
  labels: Record<string, string>;
  isAdmin: boolean;
  workStartAt: string | null;
  maxDayHours: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [dayIso, setDayIso] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [tStart, setTStart] = useState("");
  const [tEnd, setTEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function goSeason(y: number, m: number) {
    router.push(`/${locale}/presence?year=${y}&month=${m}`);
  }

  const hhmm = (v: string | null): string => {
    if (!v) return "";
    const d = new Date(v);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  function openEdit(r: Row) {
    setEditing(r);
    setTStart(hhmm(r.startedAt));
    setTEnd(hhmm(r.finishedAt));
    setEditError(null);
  }

  async function saveTimes() {
    if (!editing) return;
    const d = new Date(editing.date as string);
    const mk = (t: string) => {
      const [h, mi] = t.split(":").map(Number);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, mi || 0).toISOString();
    };
    setBusy(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/tournees/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "times", startedAt: tStart ? mk(tStart) : null, finishedAt: tEnd ? mk(tEnd) : null }),
      });
      if (!res.ok) {
        setEditError((await res.json().catch(() => null))?.error ?? "failed");
        return;
      }
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const monthName = (m: number) => {
    try {
      return new Date(year, m - 1, 1).toLocaleDateString(locale, { month: "long" });
    } catch {
      return String(m);
    }
  };

  /// Every day of the selected month, horizontal scroll strip.
  const monthDays = useMemo(() => {
    const out: Date[] = [];
    const d = new Date(year, month - 1, 1);
    while (d.getMonth() + 1 === month) {
      out.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [year, month]);

  const isoOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const visible = rows.filter((r) => {
    if (dayIso) {
      const d = new Date(r.date as string);
      if (isoOf(d) !== dayIso) return false;
    }
    return (
      !q ||
      r.location.name.includes(q) ||
      (r.location.user?.fullName ?? "").includes(q)
    );
  });

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard
          label={labels.start}
          value={String(visible.filter((r) => r.startedAt).length)}
          icon={<Clock size={18} />}
          accent="bg-emerald-500/15 text-emerald-600"
          compact
        />
        <KpiCard
          label={labels.end}
          value={String(visible.filter((r) => r.finishedAt).length)}
          icon={<Check size={18} />}
          accent="bg-sky-500/15 text-sky-600"
          compact
        />
        <KpiCard
          label={labels.open}
          value={String(visible.filter((r) => r.startedAt && !r.finishedAt).length)}
          icon={<Flag size={18} />}
          accent="bg-amber-500/15 text-amber-600"
          compact
        />
        <KpiCard
          label={labels.unclosed}
          value={String(visible.filter((r) => r.autoClosed).length)}
          icon={<Flag size={18} />}
          accent="bg-red-500/15 text-red-500"
          compact
        />
      </div>
      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="flex flex-1 gap-2">
          <div className="flex-1">
            <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.van} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select
            value={year}
            onChange={(e) => { setDayIso(""); goSeason(Number(e.target.value), month); }}
            className="h-11 shrink-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm font-bold outline-none focus:border-(--brand-500)"
            aria-label="year"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={month}
            onChange={(e) => { setDayIso(""); goSeason(year, Number(e.target.value)); }}
            className="h-11 shrink-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm font-bold outline-none focus:border-(--brand-500)"
            aria-label="month"
          >
            {months.map((m) => (
              <option key={m} value={m}>{monthName(m)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {monthDays.map((d) => {
          const iso = isoOf(d);
          const active = dayIso === iso;
          return (
            <button
              key={iso}
              onClick={() => setDayIso(active ? "" : iso)}
              className={cn(
                "flex min-h-11 min-w-14 shrink-0 flex-col items-center justify-center rounded-xl border px-2",
                active
                  ? "border-(--brand-500) bg-(--brand-500)/10 text-(--brand-600)"
                  : "border-(--border-default) opacity-70"
              )}
            >
              <span className="text-[10px] font-black">{d.toLocaleDateString(locale, { weekday: "short" })}</span>
              <span className="text-sm font-black tabular-nums">{d.getDate()}</span>
            </button>
          );
        })}
      </div>
      {visible.length === 0 && <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">{labels.empty}</p>}
      <div className="grid items-start gap-2 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((r) => {
          const fl = flagsOf(r, workStartAt, maxDayHours);
          const startUrl = mapsUrl(r.startedLat, r.startedLng);
          const endUrl = mapsUrl(r.finishedLat, r.finishedLng);
          return (
          <div key={r.id} className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3.5">
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken)">
                <Bus size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black">{r.location.name}</div>
                <div className="truncate text-[11px] opacity-60">
                  {new Date(r.date as string).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" })}
                  {r.location.user ? ` · ${r.location.user.fullName}` : ""}
                </div>
              </div>
              {fl.unclosed && (
                <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-1 text-[10px] font-black text-red-500">
                  ⚠ {labels.unclosed}
                </span>
              )}
              {fl.late && (
                <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-1 text-[10px] font-black text-red-500">
                  {labels.late}
                </span>
              )}
              {fl.overtime && (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-black text-amber-600">
                  {labels.overtime}
                </span>
              )}
              <span className={cn(
                "shrink-0 rounded-full px-2 py-1 text-[10px] font-black",
                r.finishedAt
                  ? "bg-(--bg-sunken) opacity-60"
                  : r.startedAt
                    ? "bg-emerald-500/15 text-emerald-600"
                    : "bg-amber-500/15 text-amber-600"
              )}>
                {r.finishedAt ? labels.end : r.startedAt ? labels.open : "—"}
              </span>
              {isAdmin && (
                <button
                  type="button"
                  aria-label={labels.edit}
                  onClick={() => openEdit(r)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-(--border-default) opacity-70 hover:opacity-100"
                >
                  <Pencil size={14} />
                </button>
              )}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg bg-(--bg-sunken) px-1 py-1.5">
                <div className="text-[10px] font-bold uppercase opacity-50">{labels.start}</div>
                <div className="text-xs font-black tabular-nums sm:text-[13px]" dir="ltr">{fmtTime(r.startedAt, locale)}</div>
                {startUrl && (
                  <a href={startUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-[10px] font-black text-(--brand-600) underline">📍</a>
                )}
              </div>
              <div className="rounded-lg bg-(--bg-sunken) px-1 py-1.5">
                <div className="text-[10px] font-bold uppercase opacity-50">{labels.end}</div>
                <div className="text-xs font-black tabular-nums sm:text-[13px]" dir="ltr">{fmtTime(r.finishedAt, locale)}</div>
                {endUrl && (
                  <a href={endUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-[10px] font-black text-(--brand-600) underline">📍</a>
                )}
              </div>
              <div className="rounded-lg bg-(--brand-500)/10 px-1 py-1.5">
                <div className="text-[10px] font-black uppercase opacity-60">{labels.duration}</div>
                <div className="text-xs font-black tabular-nums sm:text-[13px]" dir="ltr">{fmtDur(r.startedAt, r.finishedAt)}</div>
              </div>
            </div>
          </div>
          );
        })}
      </div>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={labels.edit} icon={<Pencil size={18} />} width="sm">
        <div className="space-y-3">
          <div className="rounded-xl bg-(--bg-sunken) px-3 py-2 text-sm font-bold">
            {editing?.location.name ?? ""} · {editing ? new Date(editing.date as string).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" }) : ""}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase opacity-60">{labels.start}</span>
              <Input type="time" value={tStart} onChange={(e) => setTStart(e.target.value)} dir="ltr" className="text-center tabular-nums" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase opacity-60">{labels.end}</span>
              <Input type="time" value={tEnd} onChange={(e) => setTEnd(e.target.value)} dir="ltr" className="text-center tabular-nums" />
            </label>
          </div>
          {editError && <p className="rounded-lg bg-red-500/10 p-2 text-xs font-bold text-red-500" dir="ltr">{editError}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)} className="flex-1">{labels.cancel}</Button>
            <Button variant="secondary" onClick={() => { setTStart(""); setTEnd(""); }} disabled={busy} aria-label="clear">×</Button>
            <Button onClick={() => void saveTimes()} disabled={busy} className="flex-[2]">
              {busy ? "…" : labels.save}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
