import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { BackButton } from "@/components/ui/BackButton";
import { CountValidate } from "./CountValidate";

export default async function CountDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("inventory");
  const row = await prisma.stockCount.findFirst({
    where: { id, companyId: session.companyId },
    include: { lines: { include: { product: true } }, location: true },
  });
  if (!row) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-5 md:p-6 lg:max-w-4xl xl:max-w-5xl">
      <BackButton fallback={`/${locale}/inventory/counts`} />
      <h1 className="text-xl font-bold">{row.number} · {row.location.name}</h1>
      <Card>
        {row.lines.map((l) => {
          const diff = Number(l.countedQty) - Number(l.expectedQty);
          return (
            <div key={l.id} className="flex justify-between border-b border-(--border-subtle) py-2 text-sm last:border-0">
              <span className="font-semibold">{l.product.name}</span>
              <span>
                {t("expected")}: {String(l.expectedQty)} · {t("counted")}: <b>{String(l.countedQty)}</b>{" "}
                {diff !== 0 && (
                  <span className={diff > 0 ? "font-bold text-emerald-600" : "font-bold text-red-500"}>
                    ({diff > 0 ? "+" : ""}{diff})
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </Card>
      {row.status === "DRAFT" && session.role === "Admin" && (
        <CountValidate countId={row.id} label={t("validate")} />
      )}
    </div>
  );
}
