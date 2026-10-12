"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/// Connectivity pill for the van flow: the driver always sees whether the
/// phone is online or working from cache. Default online so server and
/// client render the same (true state syncs on mount + live events).
export function OnlineBadge({ onlineLabel, offlineLabel }: { onlineLabel: string; offlineLabel: string }) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    try {
      setOnline(navigator.onLine);
    } catch {
      /* assume online */
    }
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return (
    <span
      dir="auto"
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black",
        online ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", online ? "bg-emerald-500" : "bg-amber-500")} />
      {online ? onlineLabel : offlineLabel}
    </span>
  );
}
