import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { InventoryClient } from "./InventoryClient";

export default async function InventoryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("inventory");
  const tc = await getTranslations("common");
  const [locations, batches, users] = await Promise.all([
    prisma.store.findMany({
      where: { companyId: session.companyId },
      include: { user: { select: { fullName: true, username: true } } },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
    prisma.stockBatch.groupBy({
      by: ["productId", "storeId"],
      where: { companyId: session.companyId, transferId: null, qty: { gt: 0 } },
      _sum: { qty: true },
    }),
    prisma.user.findMany({ where: { companyId: session.companyId, isActive: true }, select: { id: true, fullName: true } }),
  ]);
  const productIds = [...new Set(batches.map((b) => b.productId))];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true, name: true, stockQty: true, minStock: true,
          baseUnit: { select: { name: true } },
          conversions: { select: { unitId: true, factor: true, unit: { select: { name: true } } } },
        },
      })
    : [];
  const { getOrCreateSettings } = await import("@/lib/settings/helpers");
  const settings = await getOrCreateSettings(session.companyId);
  const lowStock = await prisma.product.findMany({
    where: { companyId: session.companyId, isActive: true },
    select: { id: true, name: true, stockQty: true, minStock: true },
  }).then((rows) =>
    rows.filter((p) => Number(p.stockQty) <= Number(p.minStock)).map((p) => ({
      productId: p.id, name: p.name, stock: Number(p.stockQty), min: Number(p.minStock),
    }))
  );
  const now = new Date();
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const [expired, expiring, inTransit] = settings.expiryEnabled
    ? await Promise.all([
        prisma.stockBatch.findMany({
          where: { companyId: session.companyId, transferId: null, qty: { gt: 0 }, expiryDate: { lt: now } },
          include: { product: { select: { name: true } }, location: { select: { name: true } } },
          take: 100,
        }),
        prisma.stockBatch.findMany({
          where: { companyId: session.companyId, transferId: null, qty: { gt: 0 }, expiryDate: { gte: now, lte: soon } },
          include: { product: { select: { name: true } }, location: { select: { name: true } } },
          take: 100,
        }),
        prisma.transfer.count({ where: { companyId: session.companyId, status: "DECLARED" } }),
      ])
    : [[], [], await prisma.transfer.count({ where: { companyId: session.companyId, status: "DECLARED" } })];

  return (
    <InventoryClient
      locale={locale}
      locations={JSON.parse(JSON.stringify(locations))}
      levels={batches.map((b) => ({ productId: b.productId, locationId: b.storeId, qty: Number(b._sum.qty ?? 0) }))}
      products={JSON.parse(JSON.stringify(products)).map((p: { stockQty: unknown; minStock: unknown } & Record<string, unknown>) => ({
        ...p, stockQty: Number(p.stockQty), minStock: Number(p.minStock),
      }))}
      alerts={JSON.parse(JSON.stringify({ lowStock, expired, expiring, inTransit }))}
      users={users}
      canManage={session.role === "Admin"}
      labels={{
        title: t("title"), transfers: t("transfers"), counts: t("counts"), losses: t("losses"),
        addStock: t("addStock"),
        levels: t("levels"), locations: t("locations"), alerts: t("alerts"), search: tc("search"),
        empty: t("empty"), newDepot: t("newDepot"), newVan: t("newVan"), name: tc("name"),
        marque: t("marque"), matricule: t("matricule"), assignedTo: t("assignedTo"),
        save: tc("save"), cancel: tc("cancel"), depot: t("depot"),
        inTransit: t("inTransit"), lowStock: t("lowStock"), expired: t("expired"), expiring: t("expiring"),
      }}
    />
  );
}
