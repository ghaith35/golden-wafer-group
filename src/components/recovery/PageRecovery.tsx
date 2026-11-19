"use client";

import { useEffect, useState } from "react";
import { recoveryDestination } from "@/lib/navigation-recovery";

const words = {
  ar: { restoring: "جارٍ استعادة الصفحة…", waiting: "هذا القسم غير متاح مؤقتًا. يمكنك العودة إلى مساحة العمل.", home: "الرئيسية" },
  fr: { restoring: "Rétablissement de la page…", waiting: "Cette section est temporairement indisponible. Vous pouvez revenir à votre espace de travail.", home: "Accueil" },
  en: { restoring: "Restoring your page…", waiting: "This section is temporarily unavailable. You can return to your workspace.", home: "Home" },
};

export function PageRecovery({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [waiting, setWaiting] = useState(false);
  const locale = typeof window === "undefined" ? "ar" : window.location.pathname.split("/")[1];
  const text = words[locale as keyof typeof words] ?? words.ar;
  const home = `/${locale in words ? locale : "ar"}/${typeof window !== "undefined" && window.location.pathname.includes("/livreur") ? "livreur" : "dashboard"}`;

  useEffect(() => {
    console.error("[page-recovery]", error.message, error.digest ?? "");
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      try {
        const next = recoveryDestination(window.location.pathname, sessionStorage);
        if (next) window.location.replace(next);
        else setWaiting(true);
      } catch {
        setWaiting(true);
      }
    }, 100);
    // A restored connection retries the render without refreshing the outbox.
    const retry = () => reset();
    window.addEventListener("online", retry);
    return () => { cancelled = true; window.clearTimeout(timer); window.removeEventListener("online", retry); };
  }, [error, reset]);

  return (
    <div data-route-recovery role="status" aria-live="polite" dir={locale === "ar" ? "rtl" : "ltr"} className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold">{waiting ? text.waiting : text.restoring}</p>
      {waiting && <a href={home} className="rounded-lg bg-(--brand-500) px-5 py-3 font-semibold text-(--brand-contrast)">{text.home}</a>}
    </div>
  );
}
