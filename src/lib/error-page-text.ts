/// Error boundaries render without next-intl (they must work when the app
/// shell itself is broken), so they carry their own tiny 3-language table and
/// pick the language from the URL's first segment.
type Dict = {
  title: string; offline: string; nav: string; offlinePhone: string; navPhone: string;
  reload: string; retry: string; back: string; details: string;
};
const T: Record<"ar" | "fr" | "en", Dict> = {
  ar: {
    title: "تعذّر فتح هذه الصفحة",
    offline: "لا يوجد اتصال — أعد التحميل لفتح النسخة المحفوظة.",
    nav: "حدث خطأ أثناء التنقل — أعد التحميل للمتابعة.",
    offlinePhone: "لا يوجد اتصال — أعد التحميل لفتح النسخة المحفوظة على الهاتف.",
    navPhone: "حدث خطأ أثناء التنقل — أعد التحميل للمتابعة من حيث توقفت.",
    reload: "↻ إعادة تحميل الصفحة", retry: "إعادة المحاولة", back: "→ رجوع",
    details: "تفاصيل الخطأ (لإرسالها للدعم)",
  },
  fr: {
    title: "Impossible d'ouvrir cette page",
    offline: "Pas de connexion — rechargez pour ouvrir la version enregistrée.",
    nav: "Une erreur est survenue — rechargez pour continuer.",
    offlinePhone: "Pas de connexion — rechargez pour ouvrir la version enregistrée sur le téléphone.",
    navPhone: "Une erreur est survenue — rechargez pour reprendre là où vous étiez.",
    reload: "↻ Recharger la page", retry: "Réessayer", back: "← Retour",
    details: "Détails de l'erreur (à envoyer au support)",
  },
  en: {
    title: "This page couldn't be opened",
    offline: "No connection — reload to open the saved copy.",
    nav: "Something went wrong — reload to continue.",
    offlinePhone: "No connection — reload to open the copy saved on the phone.",
    navPhone: "Something went wrong — reload to pick up where you left off.",
    reload: "↻ Reload page", retry: "Try again", back: "← Back",
    details: "Error details (send to support)",
  },
};
export function errorPageText(): { t: Dict; dir: "rtl" | "ltr" } {
  const seg = typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "";
  const l = (seg === "fr" || seg === "en" ? seg : "ar") as "ar" | "fr" | "en";
  return { t: T[l], dir: l === "ar" ? "rtl" : "ltr" };
}
