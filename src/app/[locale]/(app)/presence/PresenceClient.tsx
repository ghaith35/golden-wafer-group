"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bus, Clock } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { dz } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  date: unknown;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  location: { id: string; name: string; matricule: string | null; user: { fullName: string } | null };
};

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
}: {
  locale: string;
  year: number;
  month: number;
  years: number[];
  months: number[];
  rows: Row[];
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [dayIso, setDayIso] = useState("");

  function goSeason(y: number, m: number) {
    router.push(`/${locale}/presence?year=${y}&month=${m}`);
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
      <h1 className="flex items-center gap-2 text-xl font-black">
        <Clock size={20} className="text-(--brand-600)" />
        {labels.title}
      </h1>
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
        {visible.map((r) => (
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
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg bg-(--bg-sunken) px-1 py-1.5">
                <div className="text-[10px] font-bold uppercase opacity-50">{labels.start}</div>
                <div className="text-xs font-black tabular-nums sm:text-[13px]" dir="ltr">{fmtTime(r.startedAt, locale)}</div>
              </div>
              <div className="rounded-lg bg-(--bg-sunken) px-1 py-1.5">
                <div className="text-[10px] font-bold uppercase opacity-50">{labels.end}</div>
                <div className="text-xs font-black tabular-nums sm:text-[13px]" dir="ltr">{fmtTime(r.finishedAt, locale)}</div>
              </div>
              <div className="rounded-lg bg-(--brand-500)/10 px-1 py-1.5">
                <div className="text-[10px] font-black uppercase opacity-60">{labels.duration}</div>
                <div className="text-xs font-black tabular-nums sm:text-[13px]" dir="ltr">{fmtDur(r.startedAt, r.finishedAt)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
