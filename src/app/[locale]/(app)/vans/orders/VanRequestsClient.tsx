"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fmtDT } from "@/lib/format";
import { cn } from "@/lib/utils";

import { packBreakdown } from "@/components/products/UnitQty";
import { useSyncedState } from "@/lib/data-sync";

type Row = {
  id: string; number: string; status: string; date: unknown; notes: string | null;
  fromLocation: { name: string } | null;
  toLocation: { name: string } | null;
  lines: Array<{ id: string; declaredQty: unknown; confirmedQty: unknown; product: { id: string; name: string; baseUnit?: { name: string } | null; conversions?: Array<{ unitId: string; factor: unknown; unit: { name: string } }> } | null }>;
};

/// Colisage display (like the rest of the app): base qty broken down
/// through pack levels ("5 كرتون"), falling back to the raw base qty
/// when the product has no packs. Display-only, stored qty is untouched.
function colisText(qty: number, product: Row["lines"][number]["product"]): string {
  const convs = (product?.conversions ?? []).map((c) => ({ unitId: c.unitId, factor: Number(c.factor) }));
  if (!convs.some((c) => c.factor > 1)) return `× ${qty}`;
  const uname = (id: string) => product?.conversions?.find((c) => c.unitId === id)?.unit.name ?? "";
  return packBreakdown(qty, convs, uname, product?.baseUnit?.name ?? "");
}

/// Admin van-requests board: every depot→van transfer, newest first.
/// Validate = confirm immediately (single step — stock leaves the depot and
/// lands on the van at once, no van-side confirmation). Reject returns the
/// holding to the depot. Both are 2-tap armed. Admin-only page (proxy).
export function VanRequestsClient({
  locale,
  rows: initial,
  labels,
  statusLabel,
}: {
  locale: string;
  rows: Row[];
  labels: Record<string, string>;
  statusLabel: Record<string, string>;
}) {
  const router = useRouter();
  const [rows, setRows] = useSyncedState(initial);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"DECLARED" | "ALL">("DECLARED");

  async function act(id: string, action: "confirm" | "reject") {
    const key = `${id}:${action}`;
    if (armed !== key) {
      setArmed(key);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/transfers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      setArmed(null);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: action === "confirm" ? "CONFIRMED" : "REJECTED" } : r)));
      router.refresh();
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  }

  const visible = filter === "ALL" ? rows : rows.filter((r) => r.status === "DECLARED");

  return (
    <div className="space-y-3 p-4 pb-8 md:p-5">
      <div className="flex items-center gap-2">
        <Truck size={20} className="text-(--brand-600)" />
        <h1 className="text-lg font-black">{labels.title} ({visible.length})</h1>
        <div className="ms-auto flex gap-1.5">
          {(["DECLARED", "ALL"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "h-9 rounded-full px-3 text-xs font-black",
                filter === f ? "bg-(--brand-500) text-(--brand-contrast)" : "bg-(--bg-sunken) opacity-70"
              )}
            >
              {f === "ALL" ? labels.statusAll ?? f : (statusLabel.DECLARED ?? f)}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500" dir="ltr">{error}</p>}
      <div className="space-y-2">
        {visible.map((r) => (
          <div key={r.id} className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-black" dir="ltr">{r.number}</div>
                <div className="truncate text-[11px] opacity-60">
                  {r.fromLocation?.name ?? ""} → {r.toLocation?.name ?? ""} · {fmtDT(r.date as string, locale)}
                </div>
              </div>
              <span className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black",
                r.status === "DECLARED" ? "bg-amber-500/10 text-amber-600" : r.status === "CONFIRMED" ? "bg-emerald-500/15 text-emerald-600" : "bg-(--bg-sunken) opacity-60"
              )}>
                {statusLabel[r.status] ?? r.status}
              </span>
            </div>
            <div className="mt-1.5 space-y-0.5 border-t border-(--border-subtle) pt-1.5">
              {r.lines.map((l) => (
                <div key={l.id} className="flex justify-between gap-2 text-xs tabular-nums">
                  <span className="truncate">{l.product?.name ?? ""}</span>
                  <span className="shrink-0 font-bold" dir="ltr">{colisText(Number(l.confirmedQty ?? l.declaredQty ?? 0), l.product)}</span>
                </div>
              ))}
            </div>
            {r.notes && <p className="mt-1 text-xs opacity-60">{r.notes}</p>}
            {r.status === "DECLARED" && (
              <div className="mt-2 flex gap-2">
                <Button
                  variant={armed === `${r.id}:reject` ? "destructive" : "secondary"}
                  onClick={() => void act(r.id, "reject")}
                  disabled={busy}
                  className="flex-1"
                  data-testid={`reject-${r.number}`}
                >
                  {armed === `${r.id}:reject` ? (
                    <><X size={15} /> ؟ {labels.reject}</>
                  ) : (
                    <><X size={15} /> {labels.reject}</>
                  )}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void act(r.id, "confirm")}
                  disabled={busy}
                  className="flex-[2]"
                  data-testid={`validate-${r.number}`}
                >
                  {busy && armed === `${r.id}:confirm` ? "…" : (
                    <><Check size={15} /> {armed === `${r.id}:confirm` ? `؟ ${labels.validate}` : labels.validate}</>
                  )}
                </Button>
              </div>
            )}
          </div>
        ))}
        {visible.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      </div>
    </div>
  );
}
