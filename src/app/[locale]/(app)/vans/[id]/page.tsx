import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { VanDetailClient } from "./VanDetailClient";

export default async function VanDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("vans");
  const ti = await getTranslations("inventory");
  const tc = await getTranslations("common");
  const tp = await getTranslations("products");
  const van = await prisma.store.findFirst({
    where: { id, companyId: session.companyId, kind: "VAN" },
    include: { user: { select: { id: true, fullName: true, username: true } } },
  });
  if (!van) notFound();
  const [batches, transfers, costRows, settings] = await Promise.all([
    prisma.stockBatch.groupBy({
      by: ["productId"],
      where: { companyId: session.companyId, storeId: van.id, transferId: null, qty: { gt: 0 } },
      _sum: { qty: true },
    }),
    prisma.transfer.findMany({
      where: { companyId: session.companyId, OR: [{ fromLocationId: van.id }, { toLocationId: van.id }] },
      include: {
        lines: { include: { product: { select: { id: true, name: true } } } },
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.stockBatch.findMany({
      where: { companyId: session.companyId, storeId: van.id, transferId: null, qty: { gt: 0 } },
      select: { qty: true, unitCost: true },
    }),
    prisma.companySettings.findUnique({ where: { companyId: session.companyId }, select: { currency: true } }),
  ]);
  const vanValue = costRows.reduce((s, b) => s + Number(b.qty ?? 0) * Number(b.unitCost ?? 0), 0);
  const productIds = [...new Set(batches.map((b) => b.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true, name: true, reference: true, minStock: true,
      baseUnit: { select: { name: true } },
      images: { select: { url: true }, orderBy: { sortOrder: "asc" }, take: 1 },
      conversions: { select: { unitId: true, factor: true, unit: { select: { name: true } } } },
    },
  });
  const pmap = new Map(
    products.map((p) => [
      p.id,
      {
        ...p,
        minStock: Number(p.minStock),
        conversions: p.conversions.map((c) => ({ ...c, factor: Number(c.factor) })),
      },
    ])
  );
  return (
    <VanDetailClient
      locale={locale}
      van={JSON.parse(JSON.stringify(van))}
      levels={batches.map((b) => ({
        productId: b.productId,
        qty: Number(b._sum.qty ?? 0),
        product: pmap.get(b.productId) ?? null,
      }))}
      value={vanValue}
      currency={settings?.currency ?? ""}
      transfers={JSON.parse(JSON.stringify(transfers)).map(
        (r: { cashAmount: unknown; lines: Array<{ declaredQty: unknown; confirmedQty: unknown }> } & Record<string, unknown>) => ({
          ...r,
          cashAmount: Number(r.cashAmount),
          lines: r.lines.map((l) => ({ ...l, declaredQty: Number(l.declaredQty), confirmedQty: l.confirmedQty != null ? Number(l.confirmedQty) : null })),
        })
      )}
      labels={{
        onVan: t("onVan"), load: t("load"), unload: t("unload"), history: t("history"),
        inTransit: ti("inTransit"), transfers: ti("transfers"), levels: ti("levels"),
        lowStock: ti("lowStock"), empty: t("empty"), confirm: ti("confirm"),
        from: ti("from"), to: ti("to"), cashAmount: ti("cashAmount"),
        reject: ti("reject"), cancel: ti("cancel"), queued: ti("queued"),
        declared: ti("declared"), confirmed: ti("confirmed"), rejected: ti("rejected"), cancelled: ti("cancelled"),
        search: tc("search"), total: tc("total"),
        chauffeur: t("chauffeur"), value: t("value"),
        journal: t("journal"), stockTab: tp("stock"), stockIn: t("stockIn"), stockOut: t("stockOut"),
        noMovements: t("noMovements"), pending: ti("declared"), offline: tc("offline"),
      }}
    />
  );
}
