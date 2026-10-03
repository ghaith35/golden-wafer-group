"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/// Back button: browser history when there is any, else the fallback page.
/// (Detail pages opened directly have no in-app back affordance otherwise.)
export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="back"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default) bg-(--bg-overlay)"
    >
      <ArrowLeft size={18} className="rtl:rotate-180" />
    </button>
  );
}
