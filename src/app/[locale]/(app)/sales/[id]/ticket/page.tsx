import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth/session";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { prisma } from "@/lib/db";
import { PrintButton } from "@/components/ui/PrintButton";
import { BackButton } from "@/components/ui/BackButton";
import { TicketView } from "@/components/sales/TicketView";

/// Thermal ticket (80mm, Arabic RTL).
export default async function TicketPrintPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const [sale, company, settings] = await Promise.all([
    prisma.sale.findFirst({
      where: { id, companyId: session.companyId, kind: "TICKET" },
      include: {
        lines: { include: { product: { select: { name: true } } } },
        client: { include: { tier: { select: { name: true } } } },
        location: true,
        createdBy: { select: { fullName: true, phone: true } },
      },
    }),
    prisma.company.findUnique({ where: { id: session.companyId } }),
    getOrCreateSettings(session.companyId),
  ]);
  if (!sale) notFound();
  // Ticket language is an admin setting (default French), independent of
  // the UI locale the seller browses in.
  const ticketLang = settings.ticketLang === "ar" ? "ar" : "fr";
  const t = await getTranslations({ locale: ticketLang, namespace: "sales" });
  const width = "80" as const; // thermal tickets are 80mm only
  const total = Number(sale.total);
  const paid = Number(sale.paid);
  const due = total - paid;
  // Balance already includes this ticket → old debt = current − due.
  const balance = Number(sale.client?.balance ?? 0);
  const qrDataUrl = await QRCode.toDataURL(
    JSON.stringify({ app: "distribuili", type: "ticket", n: sale.number }),
    { margin: 1, width: 160 }
  ).catch(() => null);

  return (
    <div className="mx-auto bg-white print:m-0" style={{ width: `${width}mm` }}>
      <div className="mb-2 p-2 text-start print:hidden">
        <BackButton fallback={`/${locale}/sales/${id}`} />
      </div>
      <TicketView
        ticket={{
          number: sale.number,
          date: sale.date,
          total,
          paid,
          remise: Number(sale.remise ?? 0),
          oldDebt: sale.client ? balance - due : null,
          newDebt: sale.client ? balance : null,
          client: sale.client ? { name: sale.client.name, code: sale.client.code, phone: sale.client.phone, tierName: sale.client.tier?.name ?? null } : null,
          location: sale.location ? { name: sale.location.name } : null,
          seller: sale.createdBy?.fullName ?? null,
          sellerPhone: sale.createdBy?.phone ?? null,
          lines: sale.lines.map((l) => ({
            name: l.product.name,
            qty: Number(l.qty),
            baseQty: Number(l.baseQty),
            unitPrice: Number(l.unitPrice),
            lineTotal: Number(l.lineTotal),
            bonus: l.isBonus,
          })),
        }}
        company={{
          name: company?.name ?? "",
          phone: company?.phone,
          address: company?.address,
          rc: company?.rc,
          nif: company?.nif,
          logoUrl: company?.logoUrl,
        }}
        width={width}
        locale={ticketLang}
        labels={{
          total: t("total"),
          paid: t("paid"),
          due: t("due"),
          remise: t("remise"),
          thanks: t("thanks"),
          seller: t("seller"),
          client: t("client"),
          share: t("share"),
          packs: t("packs"),
          articles: t("articles"),
          oldDebt: t("oldDebt"),
          newDebt: t("newDebt"),
          design: t("product"),
          qty: t("qty"),
          price: t("price"),
          unitPrice: t("unitPrice"),
        }}
        qrDataUrl={qrDataUrl}
        lang={ticketLang}
      />
      <div className="no-print mt-2 p-2 text-center print:hidden">
        <PrintButton label={t("print")} className="rounded bg-black px-4 py-2 text-sm font-bold text-white" />
      </div>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; margin: 0; } }`}</style>
    </div>
  );
}
