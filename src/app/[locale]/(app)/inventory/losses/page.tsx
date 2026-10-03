import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { BackButton } from "@/components/ui/BackButton";
import { LossForm } from "./LossForm";

const MOTIVE_LABEL: Record<string, string> = {
  BREAKAGE: "breakage",
  EXPIRED: "expiredM",
  GIFT: "gift",
  LOSS: "loss",
  OTHER: "other",
};

export default async function LossesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("inventory");
  const tc = await getTranslations("common");
  const tp = await getTranslations("purchases");
  const [locations, products, rows] = await Promise.all([
    prisma.store.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({
      where: { companyId: session.companyId, isActive: true },
      include: { baseUnit: true, conversions: { include: { unit: true } } },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.stockLoss.findMany({
      where: { companyId: session.companyId },
      include: { product: true, location: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-5 md:p-6">
      <BackButton fallback={`/${locale}/inventory`} />
      <LossForm
        locations={locations}
        products={JSON.parse(JSON.stringify(products))}
        labels={{
          title: t("newLoss"), locations: t("locations"), product: tp("product"), unit: tp("unit"), notes: tc("notes"),
          save: tc("save"),
          BREAKAGE: t("breakage"), EXPIRED: t("expiredM"), GIFT: t("gift"), LOSS: t("loss"), OTHER: t("other"),
        }}
      />
      <Card>
        <h2 className="mb-2 text-sm font-bold">{t("losses")}</h2>
        {rows.length === 0 && <p className="text-sm opacity-60">{t("empty")}</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex justify-between border-b border-(--border-subtle) py-2 text-sm last:border-0">
            <span>{r.product.name} · {r.location.name} · {t(MOTIVE_LABEL[r.motive])}</span>
            <span className="font-black">− {String(r.baseQty)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
