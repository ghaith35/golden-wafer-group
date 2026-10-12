"use client";

import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

/// "Not synced yet" pill: tinted wash + dark text (khiata -ink pattern).
/// Label comes straight from the sales namespace so lists don't need
/// label plumbing through every page.
export function UnsyncedBadge({ className }: { className?: string }) {
  const t = useTranslations("sales");
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full pill-amber px-2 py-0.5 text-[10px] font-black", className)}>
      <WifiOff size={11} />
      {t("unsynced")}
    </span>
  );
}
