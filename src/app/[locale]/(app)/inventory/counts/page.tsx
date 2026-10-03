import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/Button";
import { BackButton } from "@/components/ui/BackButton";

export default async function CountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("inventory");
  const rows = await prisma.stockCount.findMany({
    where: { companyId: session.companyId },
    include: { location: true, _count: { select: { lines: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <div className="space-y-4 p-5 md:p-6">
      <BackButton fallback={`/${locale}/inventory`} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t("counts")}</h1>
        <Link href={`/${locale}/inventory/counts/new`}>
          <Button>{t("newCount")}</Button>
        </Link>
      </div>
      {rows.length === 0 && <p className="text-sm opacity-60">{t("empty")}</p>}
      <div className="space-y-2">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/${locale}/inventory/counts/${r.id}`}
            className="flex items-center justify-between rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3"
          >
            <div>
              <div className="text-sm font-bold">{r.number} · {r.location.name}</div>
              <div className="text-xs opacity-60">{new Date(r.date).toLocaleDateString(locale)} · {r._count.lines}</div>
            </div>
            <span className="text-xs font-bold opacity-70">{r.status === "DRAFT" ? t("draft") : t("validated")}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
