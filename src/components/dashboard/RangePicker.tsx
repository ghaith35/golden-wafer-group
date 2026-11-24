"use client";

import * as React from "react";
import { CalendarRange, Check, ChevronDown, X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/// "Custom range" control next to the day / week / month switch: a pill that
/// opens a small panel with quick presets and two date fields. Pure UI — the
/// parent decides what applying / clearing does (it navigates with ?from&to).

export type RangeLabels = {
  btn: string; title: string; from: string; to: string; apply: string; clear: string;
  days: (n: number) => string;
  today: string; yesterday: string; last7: string; last30: string; thisMonth: string; lastMonth: string; thisYear: string;
  invalid: string; max: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const spanDays = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000) + 1;

export function RangePicker({
  value, now, locale, labels, small, busy, onApply, onClear,
}: {
  value: { from: string; to: string } | null;
  now: Date;
  locale: string;
  labels: RangeLabels;
  small?: boolean;
  busy?: boolean;
  onApply: (from: string, to: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const todayKey = key(now);
  const [from, setFrom] = React.useState(value?.from ?? todayKey);
  const [to, setTo] = React.useState(value?.to ?? todayKey);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (value) { setFrom(value.from); setTo(value.to); }
  }, [value?.from, value?.to]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const loc = `${locale === "ar" ? "ar-DZ" : locale}-u-nu-latn`;
  const short = React.useMemo(() => new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" }), [loc]);
  const long = React.useMemo(() => new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", year: "numeric" }), [loc]);

  const presets: Array<{ l: string; a: string; b: string }> = React.useMemo(() => {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const add = (n: number) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + n);
    return [
      { l: labels.today, a: key(t), b: key(t) },
      { l: labels.yesterday, a: key(add(-1)), b: key(add(-1)) },
      { l: labels.last7, a: key(add(-6)), b: key(t) },
      { l: labels.last30, a: key(add(-29)), b: key(t) },
      { l: labels.thisMonth, a: key(new Date(t.getFullYear(), t.getMonth(), 1)), b: key(t) },
      { l: labels.lastMonth, a: key(new Date(t.getFullYear(), t.getMonth() - 1, 1)), b: key(new Date(t.getFullYear(), t.getMonth(), 0)) },
      { l: labels.thisYear, a: key(new Date(t.getFullYear(), 0, 1)), b: key(t) },
    ];
  }, [now, labels]);

  const valid = !!from && !!to && from <= to;
  const n = valid ? spanDays(from, to) : 0;
  const tooLong = valid && n > 366;
  const error = !from || !to || from > to ? labels.invalid : tooLong ? labels.max : null;

  const apply = (a = from, b = to) => {
    if (!a || !b || a > b || spanDays(a, b) > 366) return;
    setOpen(false);
    onApply(a, b);
  };

  const active = !!value;
  const pill = active
    ? `${value.from === value.to ? long.format(parse(value.from)) : `${short.format(parse(value.from))} → ${short.format(parse(value.to))}`}`
    : labels.btn;

  return (
    <div ref={boxRef} className="relative">
      <div
        className={cn(
          "inline-flex items-center rounded-xl border transition-all",
          active
            ? "border-(--brand-500) bg-[linear-gradient(135deg,var(--gold-wash),var(--bg-overlay)_80%)] shadow-[0_10px_26px_-14px_var(--brand-500)]"
            : "border-(--border-default) bg-(--bg-surface) hover:border-(--brand-500)"
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(
            "flex min-h-0 min-w-0 items-center gap-1.5 whitespace-nowrap font-black text-(--text-primary)",
            small ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs"
          )}
        >
          <CalendarRange size={small ? 12 : 15} className="text-(--gold-text)" />
          <span dir="auto">{pill}</span>
          {active && <span className="rounded-full bg-(--brand-500)/15 px-1.5 text-[10px] font-black tabular-nums text-(--gold-text)">{labels.days(value.from === value.to ? 1 : spanDays(value.from, value.to))}</span>}
          {!active && <ChevronDown size={small ? 11 : 13} className={cn("text-(--text-tertiary) transition-transform", open && "rotate-180")} />}
        </button>
        {active && (
          <button
            type="button"
            onClick={onClear}
            aria-label={labels.clear}
            title={labels.clear}
            className={cn("me-1 flex min-h-0 min-w-0 items-center justify-center rounded-lg text-(--text-tertiary) hover:bg-(--bg-sunken) hover:text-(--semantic-danger)", small ? "h-5 w-5" : "h-7 w-7")}
          >
            <X size={small ? 11 : 14} />
          </button>
        )}
      </div>

      {open && (
        <div
          role="dialog"
          aria-label={labels.title}
          className="absolute end-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3.5 shadow-[0_28px_60px_-20px_rgba(0,0,0,0.45)]"
          style={{ animation: "gw-pop 0.2s var(--ease-out)" }}
        >
          <div className="mb-2.5 flex items-center gap-2 text-[13px] font-black">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-brand text-(--brand-contrast)"><CalendarRange size={15} /></span>
            {labels.title}
          </div>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const on = p.a === from && p.b === to;
              return (
                <button
                  key={p.l}
                  type="button"
                  onClick={() => { setFrom(p.a); setTo(p.b); }}
                  onDoubleClick={() => apply(p.a, p.b)}
                  className={cn(
                    "min-h-0 rounded-full border px-2.5 py-1 text-[11px] font-black transition-colors",
                    on ? "border-(--brand-500) bg-(--brand-500)/15 text-(--gold-text)" : "border-(--border-default) bg-(--bg-sunken) text-(--text-secondary) hover:border-(--brand-500)"
                  )}
                >
                  {p.l}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <label className="min-w-0">
              <span className="mb-1 block text-[10.5px] font-black text-(--text-tertiary)">{labels.from}</span>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="h-10 w-full min-w-0 rounded-xl border border-(--border-default) bg-(--bg-surface) px-2 text-xs font-black tabular-nums outline-none focus:border-(--brand-500)"
              />
            </label>
            <ArrowRight size={15} className="mb-3 text-(--text-tertiary) rtl:rotate-180" />
            <label className="min-w-0">
              <span className="mb-1 block text-[10.5px] font-black text-(--text-tertiary)">{labels.to}</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                max={todayKey}
                onChange={(e) => setTo(e.target.value)}
                className="h-10 w-full min-w-0 rounded-xl border border-(--border-default) bg-(--bg-surface) px-2 text-xs font-black tabular-nums outline-none focus:border-(--brand-500)"
              />
            </label>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className={cn("text-[11px] font-black", error ? "text-(--semantic-danger)" : "text-(--text-secondary)")} aria-live="polite">
              {error ?? `${long.format(parse(from))} → ${long.format(parse(to))} · ${labels.days(n)}`}
            </span>
            <button
              type="button"
              disabled={!!error || busy}
              onClick={() => apply()}
              className="flex min-h-0 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-brand px-4 py-2 text-xs font-black text-(--brand-contrast) shadow transition-opacity disabled:opacity-40"
            >
              <Check size={14} />
              {labels.apply}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
