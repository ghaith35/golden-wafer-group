"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { daySlug } from "./_days";
import { cn } from "@/lib/utils";

/// Step 1 — 7 weekday buttons (current week Mon → Sun), no dates.
export function DaysClient({
  locale,
  van,
  labels,
}: {
  locale: string;
  van: { id: string; name: string; matricule: string | null } | null;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const days = useMemo(() => {
    const out: Date[] = [];
    const base = new Date();
    const dow = (base.getDay() + 6) % 7;
    const monday = new Date(base);
    monday.setDate(base.getDate() - dow);
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      out.push(d);
    }
    return out;
  }, []);

  if (!van) {
    return (
      <div className="space-y-4 p-5">
        <h1 className="text-xl font-black">{labels.title}</h1>
        <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">
          {labels.empty} — no van
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-5">
      <h1 className="text-lg font-black">{labels.days}</h1>
      <div className="flex items-center gap-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--brand-500)/10 text-(--brand-600)">
          <Truck size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-black">{van.name}</div>
          <div className="truncate text-xs opacity-60" dir="ltr">{van.matricule ?? ""}</div>
        </div>
      </div>
      <h1 className="text-lg font-black">{labels.days}</h1>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {days.map((d, i) => {
          const isToday = daySlug(d) === daySlug(new Date());
          return (
            <button
              key={i}
              onClick={() => router.push(`/${locale}/livreur/${daySlug(d)}/start`)}
              className={cn(
                "flex min-h-14 items-center gap-3 rounded-2xl border p-3 text-start transition-all active:scale-[0.99]",
                isToday
                  ? "border-transparent bg-gradient-brand text-white shadow-lg"
                  : "border-(--border-default) bg-(--bg-overlay) hover:border-(--brand-500)"
              )}
            >
              <span className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-black",
                isToday ? "bg-white/20 text-white" : "bg-(--brand-500)/10 text-(--brand-600)"
              )}>
                {d.toLocaleDateString(locale, { weekday: "narrow" })}
              </span>
              <span className="min-w-0 flex-1 truncate text-base font-black">
                {d.toLocaleDateString(locale, { weekday: "long" })}
              </span>
              {isToday && (
                <span className="shrink-0 rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-black">•</span>
              )}
              <span className={cn("shrink-0 text-lg font-black", isToday ? "text-white" : "opacity-30")}>{locale === "ar" ? "‹" : "›"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
