import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/Button";
import { BackButton } from "@/components/ui/BackButton";

export default async function SupplierReturnsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("purchases");
  const rows = await prisma.supplierReturn.findMany({
    where: { companyId: session.companyId },
    include: { supplier: true },
    orderBy: { date: "desc" },
    take: 200,
  });
  return (
    <div className="space-y-4 p-5 md:p-6">
      <BackButton fallback={`/${locale}/purchases`} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t("returns")}</h1>
        <Link href={`/${locale}/purchases/returns/new`}>
          <Button>{t("newReturn")}</Button>
        </Link>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3">
            <div>
              <div className="text-sm font-bold">{t("number")} {r.number} · {r.supplier.name}</div>
              <div className="text-xs opacity-60">{new Date(r.date).toLocaleDateString(locale)}</div>
            </div>
            <div className="text-sm font-black">− {String(r.total)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
