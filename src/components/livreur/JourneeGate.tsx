"use client";

import { useRouter } from "next/navigation";
import { Lock, Play, Route } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { goPage } from "@/lib/sync/client";
import { useJourneeState, type DayStamp } from "@/lib/journee";
import { todaySlug } from "@/app/[locale]/(app)/livreur/_days";

/// Tour workflow guard for driver pages.
///  require="active": sales & commandes only while the tour is in progress.
///  require="notActive": goods requests (طلب سلعة) before the tour starts or
///                       after it ended — never while the tour is running.
/// Admins are never blocked.
export function JourneeGate({
  locale,
  day,
  role,
  require: need,
  stamp,
  labels,
  children,
}: {
  locale: string;
  day: string;
  role: string;
  require: "active" | "notActive";
  stamp: DayStamp;
  labels: Record<string, string>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const state = useJourneeState(stamp, todaySlug())  // the journée is always today's;
  if (role === "Admin") return <>{children}</>;
  const ok = need === "active" ? state === "active" : state !== "active";
  if (ok) return <>{children}</>;

  const toStart = need === "active"; // not started (or already ended) → go to the start screen
  return (
    <div className="flex min-h-[calc(var(--vh)*0.7)] flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-(--brand-500)/10 text-(--brand-600)">
        <Lock size={28} />
      </span>
      <h1 className="text-lg font-black">{toStart ? labels.gateStartT : labels.gateEndT}</h1>
      <p className="max-w-xs text-sm text-(--text-secondary)">{toStart ? labels.gateStartM : labels.gateEndM}</p>
      <Button
        className="h-12 w-full max-w-xs"
        onClick={() => goPage(router, toStart ? `/${locale}/livreur` : `/${locale}/livreur/${day}/dashboard`)}
      >
        <span className="flex items-center gap-2">
          {toStart ? <Play size={18} /> : <Route size={18} />}
          {toStart ? labels.gateStartBtn : labels.gateEndBtn}
        </span>
      </Button>
    </div>
  );
}
