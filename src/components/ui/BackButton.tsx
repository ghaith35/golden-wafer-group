"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { isNative, popCrumb } from "@/lib/sync/client";

/// Back button: browser history when there is any, else the fallback page.
/// Offline (or inside the native APK, where every navigation is a document
/// load and Next's router cache is empty) router.back() replays a client-side
/// transition that needs the network — so hard-load the previous warmed page
/// from the breadcrumb instead; the service worker answers from cache.
export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="back"
      onClick={() => {
        try {
          if (typeof window !== "undefined" && (window.navigator?.onLine === false || isNative())) {
            const prev = popCrumb();
            window.location.assign(prev ?? fallback);
            return;
          }
        } catch { /* fall through to router */ }
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default) bg-(--bg-overlay)"
    >
      <ArrowLeft size={18} className="rtl:rotate-180" />
    </button>
  );
}
