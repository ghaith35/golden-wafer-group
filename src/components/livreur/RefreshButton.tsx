"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { syncNow } from "@/lib/sync/client";
import { cn } from "@/lib/utils";

/// Actualise a driver screen: push/pull the sync when online, then re-fetch
/// the page's server data. Offline it only calls `onLocal` (e.g. re-read GPS)
/// — never errors, never blocks the phone.
export function RefreshButton({
  label,
  onLocal,
  className,
}: {
  label: string;
  onLocal?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      onLocal?.();
      if (typeof navigator === "undefined" || navigator.onLine !== false) {
        try {
          await syncNow();
        } catch {
          /* stays queued; the page refresh below still runs */
        }
        router.refresh();
      }
    } finally {
      window.setTimeout(() => setBusy(false), 600);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      title={label}
      aria-label={label}
      className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)", className)}
    >
      <RefreshCw size={16} className={cn(busy && "animate-spin")} />
    </button>
  );
}
