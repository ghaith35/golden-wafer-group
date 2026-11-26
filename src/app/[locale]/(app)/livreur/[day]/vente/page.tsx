import { pickCurrentTour } from "@/lib/tournees/day-tours";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan, getDayStamp } from "../../_data";
import { JourneeGate } from "@/components/livreur/JourneeGate";
import { parseDay, sameDay, todaySlug } from "../../_days";
import { VenteClient } from "./VenteClient";

/// Step 4 — Vente page: scan popup → products → facture → confirm → print.
export default async function LivreurVentePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; day: string }>;
  searchParams: Promise<{ client?: string; edit?: string }>;
}) {
  const { locale, day } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  // Mandob (Vendeur): orders only — sale creation is Admin/Livreur.
  if (session.role === "Vendeur") redirect(`/${locale}/livreur/${day}/dashboard`);
  const date = parseDay(day);
  if (!date) redirect(`/${locale}/livreur`);
  const t = await getTranslations("livreur");
  const tc = await getTranslations("common");
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);
  const driver = await prisma.user.findFirst({ where: { id: session.userId, companyId: session.companyId }, select: { fullName: true, phone: true } });

  const [client, products, categories, tiers, vanStock, settings, tournees] = await Promise.all([
    sp.client
      ? prisma.customer.findFirst({
          where: { id: sp.client, companyId: session.companyId },
          select: { id: true, name: true, code: true, phone: true, gpsLat: true, gpsLng: true, tierId: true, balance: true },
        })
      : null,
    prisma.product.findMany({
      where: { companyId: session.companyId, isActive: true },
      include: {
        images: { orderBy: { sortOrder: "asc" } },
        tierPrices: true,
        qtyTiers: true,
        conversions: { include: { unit: true } },
        baseUnit: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.productCategory.findMany({
      where: { companyId: session.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.priceTier.findMany({
      where: { companyId: session.companyId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.stockBatch.groupBy({
      by: ["productId"],
      where: { companyId: session.companyId, storeId: van.id, transferId: null },
      _sum: { qty: true },
    }),
    prisma.companySettings.findUnique({
      where: { companyId: session.companyId },
      select: { pieceSalesEnabled: true, ticketLang: true },
    }),
    prisma.tournee.findMany({
      where: { companyId: session.companyId, locationId: van.id, status: "OPEN" },
      select: { id: true, date: true, slot: true, createdAt: true, startedAt: true, finishedAt: true, status: true },
    }),
  ]);

  // Two tours may run that day: sales attach to the one being driven.
  // The journée (stamps, sales, orders) is ALWAYS today's; the picked day only
  // chooses which clients are listed.
  const jDate = parseDay(todaySlug())!;
  const listTour = pickCurrentTour(tournees.filter((x) => sameDay(new Date(x.date), date)));
  const tour = pickCurrentTour(tournees.filter((x) => sameDay(new Date(x.date), jDate)));
  // Edit mode (?edit=<ticketId>): reopen a posted ticket of THIS van as a
  // prefilled sale screen. Anything else → back to the factures list.
  const editing = sp.edit
    ? await prisma.sale.findFirst({
        where: { id: sp.edit, companyId: session.companyId, kind: "TICKET", locationId: van.id, status: { not: "CANCELLED" } },
        include: {
          client: { select: { id: true, name: true, code: true, phone: true, gpsLat: true, gpsLng: true, tierId: true, balance: true } },
          lines: true,
        },
      })
    : null;
  // Confirmed tickets are final: only an admin may reopen them.
  if (sp.edit && (!editing || (session.role !== "Admin" && editing.confirmedAt))) redirect(`/${locale}/livreur/${day}/factures`);
  const stockMap: Record<string, number> = {};
  for (const b of vanStock) stockMap[b.productId] = Number(b._sum.qty ?? 0);
  // Ticket labels follow the admin ticket language (default French),
  // not the UI locale the livreur browses in.
  const ticketLang = settings?.ticketLang === "ar" ? "ar" : "fr";
  const tt = await getTranslations({ locale: ticketLang, namespace: "sales" });

  const dayStamp = await getDayStamp(session.companyId, van.id, jDate);
  return (
    <JourneeGate
      locale={locale}
      day={day}
      role={session.role}
      require="active"
      stamp={dayStamp}
      labels={{ gateStartT: t("gateStartT"), gateStartM: t("gateStartM"), gateStartBtn: t("gateStartBtn"), gateEndT: t("gateEndT"), gateEndM: t("gateEndM"), gateEndBtn: t("gateEndBtn") }}
    >
    <VenteClient
      locale={locale}
      companyId={session.companyId}
      day={day}
      vanId={van.id}
      vanName={van.name}
      tourneeId={tour?.id ?? null}
      listTourneeId={listTour?.id ?? null}
      initialClient={editing ? JSON.parse(JSON.stringify(editing.client)) : client ? JSON.parse(JSON.stringify(client)) : null}
      editingTicket={
        editing
          ? {
              id: editing.id,
              paid: Number(editing.paid ?? 0),
              notes: editing.notes,
              // 3pack gift lines are derived from the purchases, never edited.
              lines: editing.lines.filter((l) => !l.isBonus).map((l) => ({
                productId: l.productId,
                unitId: l.unitId,
                qty: Number(l.qty),
                unitPrice: Number(l.unitPrice),
              })),
            }
          : null
      }
      products={JSON.parse(JSON.stringify(products)).map((p: { qtyTiers?: Array<{ unitKey: string; minQty: unknown; tierId: string | null }> } & Record<string, unknown>) => ({
        ...p,
        qtyTiers: (p.qtyTiers ?? []).map((r) => ({ unitKey: r.unitKey, minQty: Number(r.minQty), tierId: r.tierId })),
      }))}
      categories={JSON.parse(JSON.stringify(categories))}
      vanStock={stockMap}
      tiers={JSON.parse(JSON.stringify(tiers))}
      allowPieces={settings?.pieceSalesEnabled ?? false}
      labels={{
        remove: t("remove"),
        scanTitle: t("scanTitle"), scanHint: t("scanHint"), skip: t("skip"),
        chooseClient: t("chooseClient"), searchClient: t("searchClient"),
        products: t("products"), searchProduct: t("searchProduct"), allCats: t("allCats"),
        qty: t("qty"), colis: t("colis"), confirm: t("confirm"), cancel: t("cancel"),
        facture: t("facture"), total: t("total"), paid: t("paid"), print: t("print"),
        printTitle: t("printTitle"), printHint: t("printHint"), backToProducts: t("backToProducts"),
        empty: t("empty"), saved: t("saved"), stock: t("stock"), clients: t("clients"),
        gallery: t("gallery"), qrNotFound: t("qrNotFound"),
        backToDash: t("backToDash"), scan: t("scan"), camNeedHttps: t("camNeedHttps"),
        camDenied: t("camDenied"), camUnsupported: t("camUnsupported"), held: t("held"),
        ticketQueued: t("ticketQueued"), offline: t("offline"),
        errRemise: t("errRemise"), errQr: t("errQr"), errStock: t("errStock"), errBonus: t("errBonus"),
        errCashOnly: t("errCashOnly"), errDebtOff: t("errDebtOff"),
        errClientReq: t("errClientReq"), errCreditLimit: t("errCreditLimit"),
        errOverpaid: t("errOverpaid"), errSaveFailed: t("errSaveFailed"),
        syncFirst: t("syncFirst"), tierBase: t("tierBase"), tierBaseBtn: t("tierBaseBtn"),
      }}
      ticketLabels={{
        total: tt("total"), paid: tt("paid"), due: tt("due"), remise: tt("remise"),
        thanks: tt("thanks"), seller: tt("seller"), client: tt("client"), share: tt("share"),
        copied: tt("copied"), shareFail: tt("shareFail"),
        printFail: tt("printFail"),
        pdfSaved: tt("pdfSaved"), pdfShared: tt("pdfShared"),
        pdfPreview: tt("pdfPreview"), save: tc("save"),
        packs: tt("packs"), articles: tt("articles"), oldDebt: tt("oldDebt"), newDebt: tt("newDebt"),
        design: tt("product"), qty: tt("qty"), price: tt("price"), unitPrice: tt("unitPrice"),
      }}
      ticketLang={ticketLang}
      driver={driver}
    />
    </JourneeGate>
  );
}
