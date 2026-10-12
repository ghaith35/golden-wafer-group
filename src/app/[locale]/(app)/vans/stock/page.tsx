import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { prisma } from "@/lib/db";
import { sortByName } from "@/lib/sort";
import { StockBoard } from "./StockBoard";

export default async function VanStockBoardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("vans");
  const tc = await getTranslations("common");
  const tp = await getTranslations("products");
  const ti = await getTranslations("inventory");
  const tpu = await getTranslations("purchases");

  const [company, settings] = await Promise.all([
    prisma.company.findUnique({
      where: { id: session.companyId },
      select: { name: true, phone: true, address: true, rc: true, nif: true, ai: true, logoUrl: true, signatureUrl: true, stampUrl: true },
    }),
    getOrCreateSettings(session.companyId),
  ]);
  const vans = await prisma.store.findMany({
    where: { companyId: session.companyId, kind: "VAN", isActive: true },
    include: { user: { select: { id: true, fullName: true, username: true } } },
    orderBy: { name: "asc" },
    take: 100,
  });
  // General depot(s) — always shown pinned at the top of the board.
  const depots = await prisma.store.findMany({
    where: { companyId: session.companyId, kind: "DEPOT", isActive: true },
    include: { user: { select: { id: true, fullName: true, username: true } } },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  const locIds = [...depots, ...vans].map((v) => v.id);

  const [levels, transfers, devices, batches, users] = await Promise.all([
    locIds.length
      ? prisma.stockBatch.groupBy({
          by: ["productId", "storeId"],
          where: { companyId: session.companyId, storeId: { in: locIds }, transferId: null, qty: { gt: 0 } },
          _sum: { qty: true },
        })
      : [],
    locIds.length
      ? prisma.transfer.findMany({
          where: {
            companyId: session.companyId,
            OR: [{ fromLocationId: { in: locIds } }, { toLocationId: { in: locIds } }],
          },
          include: {
            lines: { include: { product: { select: { id: true, name: true } } } },
            fromLocation: { select: { id: true, name: true } },
            toLocation: { select: { id: true, name: true } },
          },
          orderBy: { date: "desc" },
          take: 200,
        })
      : [],
    locIds.length
      ? prisma.device.findMany({
          where: { companyId: session.companyId, locationId: { in: locIds }, isActive: true },
          select: {
            locationId: true,
            label: true,
            lastSyncAt: true,
            _count: { select: { ops: { where: { status: "FAILED" } } } },
          },
        })
      : [],
    locIds.length
      ? prisma.stockBatch.findMany({
          where: { companyId: session.companyId, storeId: { in: locIds }, transferId: null, qty: { gt: 0 } },
          select: { productId: true, storeId: true, qty: true, unitCost: true },
        })
      : [],
    prisma.user.findMany({
      where: { companyId: session.companyId, isActive: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const valuations = new Map<string, { qty: number; value: number; perProduct: Map<string, { qty: number; value: number }> }>();
  for (const b of batches) {
    const q = Number(b.qty ?? 0);
    const v = q * Number(b.unitCost ?? 0);
    let entry = valuations.get(b.storeId!);
    if (!entry) {
      entry = { qty: 0, value: 0, perProduct: new Map() };
      valuations.set(b.storeId!, entry);
    }
    entry.qty += q;
    entry.value += v;
    const pp = entry.perProduct.get(b.productId) ?? { qty: 0, value: 0 };
    pp.qty += q;
    pp.value += v;
    entry.perProduct.set(b.productId, pp);
  }

  const productIds = [...new Set(levels.map((l) => l.productId))];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          name: true,
          reference: true,
          minStock: true,
          baseUnit: { select: { name: true } },
          images: { select: { url: true }, orderBy: { sortOrder: "asc" }, take: 1 },
          conversions: { select: { unitId: true, factor: true, unit: { select: { name: true } } } },
        },
      })
    : [];

  return (
    <StockBoard
      locale={locale}
      vans={JSON.parse(JSON.stringify(sortByName(vans, locale)))}
      depots={JSON.parse(JSON.stringify(depots))}
      levels={JSON.parse(JSON.stringify(levels)).map((l: { _sum: { qty: unknown } }) => ({ ...l, qty: Number(l._sum.qty ?? 0) }))}
      products={JSON.parse(JSON.stringify(products)).map((p: { minStock: unknown; conversions: Array<{ factor: unknown }> }) => ({
        ...p,
        minStock: Number(p.minStock ?? 0),
        conversions: p.conversions.map((c) => ({ ...c, factor: Number(c.factor) })),
      }))}
      transfers={JSON.parse(JSON.stringify(transfers)).map((r: {
        cashAmount: unknown;
        lines: Array<{ declaredQty: unknown; confirmedQty: unknown }>;
      }) => ({
        ...r,
        cashAmount: Number(r.cashAmount ?? 0),
        lines: r.lines.map((l) => ({
          ...l,
          declaredQty: Number(l.declaredQty ?? 0),
          confirmedQty: l.confirmedQty != null ? Number(l.confirmedQty) : null,
        })),
      }))}
      devices={JSON.parse(JSON.stringify(devices))}
      valuations={[...valuations.entries()].map(([storeId, e]) => ({
        storeId,
        qty: e.qty,
        value: e.value,
        perProduct: [...e.perProduct.entries()].map(([productId, p]) => ({ productId, ...p })),
      }))}
      users={JSON.parse(JSON.stringify(users))}
      company={JSON.parse(JSON.stringify(company ?? { name: "" }))}
      currency={settings.currency}
      labels={{
        title: t("stockBoard"),
        search: tc("search"),
        empty: t("empty"),
        load: t("load"),
        unload: t("unload"),
        onVan: t("onVan"),
        low: t("low"),
        inTransit: t("inTransit"),
        lastSync: t("lastSync"),
        neverSynced: t("neverSynced"),
        failedSync: t("failedSync"),
        details: tc("details"),
        stock: tp("stock"),
        value: t("value"),
        vanToVan: t("vanToVan"),
        sheet: t("sheet"),
        print: t("print"),
        sortBy: t("sortBy"),
        sortName: t("sortName"),
        sortUnits: t("sortUnits"),
        sortValue: t("sortValue"),
        sortLow: t("sortLow"),
        driver: t("driver"),
        depot: t("depot"),
        inDepot: t("inDepot"),
        allDrivers: t("allDrivers"),
        noChauffeur: t("noChauffeur"),
      }}
      wizardLabels={{
        from: ti("from"), to: ti("to"), cashAmount: ti("cashAmount"), notes: tc("notes"),
        product: tpu("product"), unit: tpu("unit"), addLine: tpu("addLine"), save: tc("save"),
        stepRoute: ti("stepRoute"), stepLines: ti("stepLines"), stepReview: ti("stepReview"),
        next: ti("next"), back: ti("back"), queued: ti("queued"), search: tc("search"),
        sourceStock: ti("sourceStock"), emptySource: ti("emptySource"), onlyAvailable: ti("onlyAvailable"),
        loadingStock: ti("loadingStock"), emptyLocation: ti("emptyLocation"), addAll: ti("addAll"),
        multiSelect: ti("multiSelect"), addSelected: ti("addSelected"),
      }}
      detailLabels={{
        load: t("load"), unload: t("unload"), onVan: t("onVan"), inDepot: t("inDepot"), depot: t("depot"), value: t("value"),
        levels: ti("levels"), lowStock: ti("lowStock"), inTransit: ti("inTransit"),
        search: tc("search"), empty: t("empty"), total: tc("total"),
        history: t("history"), transfers: ti("transfers"), confirm: ti("confirm"),
        from: ti("from"), to: ti("to"), cashAmount: ti("cashAmount"),
        reject: ti("reject"), cancel: ti("cancel"), queued: ti("queued"),
        declared: ti("declared"), confirmed: ti("confirmed"),
        rejected: ti("rejected"), cancelled: ti("cancelled"),
        journal: t("journal"), stockTab: tp("stock"), stockIn: t("stockIn"), stockOut: t("stockOut"),
        noMovements: t("noMovements"), pending: ti("declared"),
      }}
      sheetLabels={{
        sheet: t("sheet"),
        product: tpu("product"),
        reference: tp("reference"),
        colisage: tp("colisage"),
        units: t("sortUnits"),
        value: t("value"),
        total: tc("total"),
        date: tc("date"),
        driver: t("driver"),
        receivedBy: t("receivedBy"),
        deliveredBy: t("deliveredBy"),
        print: t("print"),
        pdf: t("pdf"),
        downloadFile: t("downloadFile"),
        page: t("page"),
        generating: t("generating"),
      }}
    />
  );
}
