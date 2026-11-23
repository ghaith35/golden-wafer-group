"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Gift, Plus, Sparkles, Tag } from "lucide-react";
import { goPage } from "@/lib/sync/client";
import { ProductThumb } from "@/components/products/ProductThumb";
import { RefreshButton } from "@/components/livreur/RefreshButton";
import { windowState, daysLeft, toYmd } from "@/lib/threepack/window";
import { cn } from "@/lib/utils";

type Item = { role: "BUY" | "GIVE"; productId: string; name: string; images: string[]; colis: number; price?: number | null };
type Rule = {
  id: string; name: string; mode: "SINGLE" | "PACK" | "PERCENT" | "PRICE"; percent?: number | null;
  startsAt: string | null; endsAt: string | null; items: Item[];
};

/// One product of the equation: photo (tap = full size), ×qty badge, name.
function Tile({ it, gift, deal }: { it: Item; gift?: boolean; deal?: string }) {
  return (
    <div className="flex w-[5.2rem] flex-col items-center gap-1.5 text-center">
      <div className="relative">
        <ProductThumb
          name={it.name}
          images={it.images}
          className={cn("h-16 w-16 rounded-2xl", gift && "ring-2 ring-emerald-500/70", deal && "ring-2 ring-amber-500/70")}
        />
        <span
          dir="ltr"
          className={cn(
            "absolute -bottom-2 -end-2 rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums leading-tight shadow",
            gift ? "bg-emerald-500 text-white" : deal ? "bg-amber-500 text-white" : "bg-gradient-brand text-(--brand-contrast)"
          )}
        >
          {deal ?? `×${it.colis}`}
        </span>
        {deal && (
          <span className="absolute -start-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white shadow" aria-hidden>
            <Tag size={11} />
          </span>
        )}
        {gift && (
          <span className="absolute -start-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow" aria-hidden>
            <Gift size={11} />
          </span>
        )}
      </div>
      <span className="mt-1 line-clamp-2 text-[11px] font-bold leading-snug">{it.name}</span>
    </div>
  );
}

const fmt = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleDateString(locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "fr" ? "fr-DZ" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

export function GiftsClient({
  locale, day, rules, labels,
}: {
  locale: string;
  day: string;
  rules: Rule[];
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"live" | "upcoming">("live");
  // The phone's own clock decides what is live (works offline, and drops a
  // promotion that ended since this page was cached).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  const live = useMemo(() => rules.filter((r) => windowState(r, now) === "live"), [rules, now]);
  const upcoming = useMemo(
    () => rules.filter((r) => windowState(r, now) === "scheduled").sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))),
    [rules, now]
  );
  const list = tab === "live" ? live : upcoming;

  const tabBtn = (k: "live" | "upcoming", text: string, n: number) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      className={cn(
        "flex-1 rounded-xl px-3 py-2.5 text-sm font-black transition-all active:scale-[0.98]",
        tab === k ? "bg-gradient-brand text-(--brand-contrast) shadow" : "border border-(--border-default) bg-(--bg-overlay)"
      )}
    >
      {text} <span className="tabular-nums opacity-80">({n})</span>
    </button>
  );

  return (
    <div className="space-y-3 p-3 pb-28 md:p-5 md:pb-28">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => goPage(router, `/${locale}/livreur/${day}/dashboard`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black">{labels.title}</h1>
        </div>
        <RefreshButton label={labels.refresh} />
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-brand p-4 text-(--brand-contrast) shadow-lg">
        <Sparkles className="absolute -end-2 -top-2 opacity-20" size={84} aria-hidden />
        <div className="relative flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20"><Gift size={26} /></span>
          <div className="min-w-0">
            <p className="text-2xl font-black tabular-nums leading-none">{live.length}</p>
            <p className="mt-1 text-xs font-bold opacity-90">{labels.live}</p>
          </div>
          {upcoming.length > 0 && (
            <div className="ms-auto text-end">
              <p className="text-lg font-black tabular-nums leading-none">{upcoming.length}</p>
              <p className="mt-1 text-[11px] font-bold opacity-90">{labels.upcoming}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        {tabBtn("live", labels.live, live.length)}
        {tabBtn("upcoming", labels.upcoming, upcoming.length)}
      </div>

      <div className="space-y-3">
        {list.map((r) => {
          const left = daysLeft(r.endsAt, now);
          const isPercent = r.mode === "PERCENT";
          const isDeal = isPercent || r.mode === "PRICE";
          const dealBadge = (it: Item) => (isPercent ? `−${r.percent ?? 0}%` : `${Math.round(it.price ?? 0).toLocaleString("fr-DZ")} DA`);
          const buys = r.items.filter((i) => i.role === "BUY");
          const gives = r.items.filter((i) => i.role === "GIVE");
          const urgent = tab === "live" && left != null && left <= 3;
          const toStart = tab === "upcoming" && r.startsAt ? Math.max(0, Math.ceil((new Date(r.startsAt).getTime() - now) / 86400000)) : null;
          // Elapsed share of the window (live, both dates known).
          const s = r.startsAt ? new Date(r.startsAt).getTime() : null;
          const e = r.endsAt ? new Date(r.endsAt).getTime() : null;
          const pct = tab === "live" && s != null && e != null && e > s ? Math.min(100, Math.max(0, Math.round(((now - s) / (e - s)) * 100))) : null;
          return (
            <article key={r.id} className={cn("overflow-hidden rounded-3xl border bg-(--bg-overlay) shadow-sm", urgent ? "border-amber-500/60" : "border-(--border-default)")}>
              <header className="flex flex-wrap items-center gap-2 border-b border-(--border-default) px-4 py-3">
                <h2 className="min-w-0 flex-1 truncate text-base font-black">{r.name}</h2>
                <span className="rounded-full bg-(--bg-sunken) px-2.5 py-0.5 text-[11px] font-bold opacity-80">
                  {r.mode === "SINGLE" ? labels.single : r.mode === "PACK" ? labels.pack : isPercent ? labels.dealPercent : labels.dealPrice}
                </span>
                {tab === "live" && left != null && (
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-black", urgent ? "bg-amber-500/20 text-amber-600" : "bg-emerald-500/15 text-emerald-600")}>
                    {left === 0 ? labels.endsToday : labels.daysLeft.replace("{n}", String(left))}
                  </span>
                )}
                {tab === "upcoming" && toStart != null && (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-black text-amber-600">
                    {toStart <= 1 ? labels.startsTomorrow : labels.startsIn.replace("{n}", String(toStart))}
                  </span>
                )}
              </header>

              {/* buy → get */}
              <div className="space-y-2 px-4 py-4">
                <div className="flex flex-wrap items-start gap-x-2 gap-y-5">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-wide opacity-60">{labels.buy}</p>
                    <div className="flex flex-wrap items-start gap-x-1.5 gap-y-5">
                      {buys.map((it, i) => (
                        <div key={it.productId} className="flex items-start gap-1.5">
                          {i > 0 && <Plus size={14} className="mt-7 shrink-0 opacity-50" aria-hidden />}
                          <Tile it={it} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <span className="mt-9 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-brand text-(--brand-contrast) shadow" aria-hidden>
                    <ArrowRight size={17} className="rtl:rotate-180" />
                  </span>
                  <div className="space-y-1">
                    <p className={cn("text-[10px] font-black uppercase tracking-wide", isDeal ? "text-amber-600" : "text-emerald-600")}>
                      {isDeal ? `${isPercent ? labels.dealPercent : labels.dealPrice} ${labels.onTargets}` : `${labels.get} · ${labels.free}`}
                    </p>
                    <div className="flex flex-wrap items-start gap-x-1.5 gap-y-5">
                      {gives.map((it, i) => (
                        <div key={it.productId} className="flex items-start gap-1.5">
                          {i > 0 && <Plus size={14} className="mt-7 shrink-0 opacity-50" aria-hidden />}
                          <Tile it={it} gift={!isDeal} deal={isDeal ? dealBadge(it) : undefined} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] font-bold opacity-60">✦ {isDeal ? labels.dealEvery : labels.every}</p>
              </div>

              {/* dates */}
              <footer className="space-y-2 border-t border-(--border-default) bg-(--bg-sunken)/40 px-4 py-3">
                <div className="flex items-center gap-2 text-xs font-black">
                  <CalendarDays size={15} className="shrink-0 text-(--brand-600)" aria-hidden />
                  {r.startsAt || r.endsAt ? (
                    <span className="tabular-nums" dir="ltr">
                      {fmt(r.startsAt, locale) ?? "…"} → {fmt(r.endsAt, locale) ?? "∞"}
                    </span>
                  ) : (
                    <span>{labels.openEnded}</span>
                  )}
                </div>
                {pct != null && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-(--bg-sunken)" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className={cn("h-full rounded-full", urgent ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
                  </div>
                )}
              </footer>
            </article>
          );
        })}
        {list.length === 0 && (
          <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">
            {tab === "live" ? labels.empty : labels.emptyUpcoming}
          </p>
        )}
      </div>
    </div>
  );
}
