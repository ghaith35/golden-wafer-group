import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { CountForm } from "../CountForm";
import { BackButton } from "@/components/ui/BackButton";

export default async function NewCountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("inventory");
  const tc = await getTranslations("common");
  const tp = await getTranslations("purchases");
  const [locations, products] = await Promise.all([
    prisma.store.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({
      where: { companyId: session.companyId, isActive: true },
      include: { baseUnit: true, conversions: { include: { unit: true } } },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);
  return (
    <div className="space-y-4">
      <div className="px-5 pt-5 md:px-6 md:pt-6">
        <BackButton fallback={`/${locale}/inventory/counts`} />
      </div>
      <CountForm
      locale={locale}
      locations={locations}
      products={JSON.parse(JSON.stringify(products))}
      labels={{
        locations: t("locations"), notes: tc("notes"), product: tp("product"),
        unit: tp("unit"), addLine: tp("addLine"), save: tc("save"),
      }}
    />
    </div>
  );
}
