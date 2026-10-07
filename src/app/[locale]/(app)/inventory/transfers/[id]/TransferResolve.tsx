"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Package, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { queueOp } from "@/lib/sync/client";
import { packBreakdown } from "@/components/products/UnitQty";
import { cn } from "@/lib/utils";

export type TLine = {
  id: string;
  declaredQty: number;
  confirmedQty: number | null;
  product: {
    name: string;
    imageUrl?: string | null;
    conversions?: Array<{ unitId: string; factor: unknown; unit: { name: string } }>;
    baseName?: string;
  };
};

/// Pack hint under the product name ("15 كرتون"), or "" without packs.
function packHint(l: TLine): string {
  const convs = (l.product.conversions ?? []).map((c) => ({ unitId: c.unitId, factor: Number(c.factor) }));
  if (!convs.some((c) => c.factor > 1)) return "";
  const uname = (id: string) => l.product.conversions?.find((c) => c.unitId === id)?.unit.name ?? "";
  return packBreakdown(Number(l.declaredQty), convs, uname, l.product.baseName ?? "");
}

export function TransferResolve({
  transferId,
  lines,
  labels,
  onDone,
}: {
  transferId: string;
  lines: TLine[];
  labels: Record<string, string>;
  /// Called after a successful online resolve (so a popup can close).
  onDone?: () => void;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.id, l.declaredQty])));
  const [armed, setArmed] = useState<"confirm" | "reject" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  async function act(action: "confirm" | "reject" | "cancel") {
    if (armed !== action) {
      setArmed(action);
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      action,
      lines: action === "confirm" ? lines.map((l) => ({ lineId: l.id, confirmedQty: qty[l.id] ?? 0 })) : undefined,
    };
    try {
      let res: Response;
      try {
        res = await fetch(`/api/transfers/${transferId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        // Offline van receipt: only confirm can queue (reject/cancel need connection).
        if (action !== "confirm") throw new Error("offline");
        try {
          await queueOp("transfer-confirm", { transferId, lines: body.lines ?? [] } as Record<string, unknown>);
        } catch {
          setError("failed");
          return;
        }
        setQueued(true);
        return;
      }
      if (!res.ok) {
        setError((await res.json()).error ?? "failed");
        return;
      }
      router.refresh();
      onDone?.();
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
      setArmed(null);
    }
  }

  const btn = (action: "confirm" | "reject" | "cancel", variant: "primary" | "secondary" | "ghost" | "destructive", Icon: typeof Check) => (
    <Button
      variant={action === armed ? variant : "secondary"}
      onClick={() => (armed === action ? void act(action) : setArmed(action))}
      disabled={busy}
      className="flex flex-1 items-center justify-center gap-1"
    >
      <Icon size={15} />
      {armed === action ? `؟ ${labels[action]}` : labels[action]}
    </Button>
  );

  return (
    <Card>
      {error && <p className="mb-2 text-sm text-red-500">{error}</p>}
      {queued && <p className="mb-2 rounded-lg bg-amber-500/10 p-2 text-sm font-bold text-amber-600">{labels.queued}</p>}
      <div className="space-y-1.5">
        {lines.map((l) => (
          <div key={l.id} className="flex items-center gap-2 rounded-xl bg-(--bg-sunken) px-2 py-1.5">
            {l.product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.product.imageUrl} alt={l.product.name} className="h-9 w-9 shrink-0 rounded-lg object-cover" loading="lazy" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-overlay)">
                <Package size={15} className="opacity-60" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{l.product.name}</span>
              {packHint(l) !== "" && (
                <span className="block truncate text-[11px] font-bold text-(--brand-600)" dir="ltr">{packHint(l)}</span>
              )}
            </span>
            <span className="shrink-0 text-xs tabular-nums opacity-60" dir="ltr">
              {l.declaredQty.toLocaleString()}
            </span>
            <span className={cn("shrink-0 font-black", (qty[l.id] ?? 0) < l.declaredQty ? "text-amber-600" : "text-(--brand-600)")}>→</span>
            <Input
              type="number" min={0} max={l.declaredQty} step="any" value={qty[l.id] ?? 0}
              onChange={(e) => setQty((s) => ({ ...s, [l.id]: Number(e.target.value) }))}
              className="w-24 shrink-0 text-end font-black"
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        {btn("confirm", "primary", Check)}
        {btn("reject", "destructive", X)}
        {btn("cancel", "ghost", X)}
      </div>
    </Card>
  );
}
