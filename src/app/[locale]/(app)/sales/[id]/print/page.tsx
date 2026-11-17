import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { PrintButton } from "@/components/ui/PrintButton";
import { BackButton } from "@/components/ui/BackButton";

/// A4 print: Bon de livraison / Facture.
/// facturePro toggle switches to the professional template (layout refined later).
export default async function SalePrintPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const [sale, company, settings] = await Promise.all([
    prisma.sale.findFirst({
      where: { id, companyId: session.companyId },
      include: { lines: { include: { product: { select: { name: true, reference: true } } } }, client: true, location: true },
    }),
    prisma.company.findUnique({ where: { id: session.companyId } }),
    getOrCreateSettings(session.companyId),
  ]);
  if (!sale) notFound();
  const t = await getTranslations("sales");
  const fiscalLine = [company?.rc && `RC: ${company.rc}`, company?.nif && `NIF: ${company.nif}`, company?.ai && `AI: ${company.ai}`]
    .filter(Boolean)
    .join(" · ");

  const PT = ({
    ar: { facturePro: "فاتورة احترافية", facture: "فاتورة", delivery: "سند تسليم", order: "سند طلب", ticket: "تذكرة", client: "الزبون", product: "المنتج", qty: "الكمية", unitPrice: "السعر", remise: "تخفيض", total: "المجموع", paid: "المدفوع", rest: "المتبقي", signature: "التوقيع" },
    fr: { facturePro: "Facture Pro", facture: "Facture", delivery: "Bon de livraison", order: "Bon de commande", ticket: "Ticket", client: "Client", product: "Produit", qty: "Qté", unitPrice: "P.U", remise: "Rem.", total: "Total", paid: "Payé", rest: "Reste", signature: "Signature" },
    en: { facturePro: "Pro Invoice", facture: "Invoice", delivery: "Delivery note", order: "Purchase order", ticket: "Receipt", client: "Client", product: "Product", qty: "Qty", unitPrice: "Unit price", remise: "Disc.", total: "Total", paid: "Paid", rest: "Balance", signature: "Signature" },
  } as const)[locale === "fr" || locale === "en" ? locale : "ar"];
  const title = sale.kind === "INVOICE" ? (settings.facturePro ? PT.facturePro : PT.facture) : sale.kind === "DELIVERY" ? PT.delivery : sale.kind === "ORDER" ? PT.order : PT.ticket;
  const qr = sale.client ? `DCLT://${session.companyId}/${sale.client.code}` : null;

  return (
    <div className="print-page mx-auto max-w-3xl bg-white p-8 text-black">
      <div className="mb-4 print:hidden">
        <BackButton fallback={`/${locale}/sales/${id}`} />
      </div>
      <div className="mb-6 flex items-start justify-between border-b-2 border-black pb-4">
        <div className="flex items-center gap-3">
          {company?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt="logo" className="h-14 w-14 rounded-lg object-contain" />
          )}
          <div>
            <div className="text-2xl font-black">{company?.name}</div>
            {company?.address && <div className="text-sm">{company.address}</div>}
            {company?.phone && <div className="text-sm">Tél: {company.phone}</div>}
            {fiscalLine !== "" && <div className="text-xs opacity-70">{fiscalLine}</div>}
          </div>
        </div>
        <div className="text-end">
          <div className="text-xl font-black">{title}</div>
          <div className="font-mono">N° {sale.number}</div>
          <div className="text-sm">{new Date(sale.date).toLocaleDateString(locale === "ar" ? "ar-DZ" : locale === "fr" ? "fr-FR" : "en-US")}</div>
        </div>
      </div>

      {sale.client && (
        <div className="mb-4 text-sm">
          <b>{PT.client}:</b> {sale.client.name} <span className="font-mono">({sale.client.code})</span>
          {sale.client.phone ? ` · ${sale.client.phone}` : ""}
          {sale.client.address ? ` · ${sale.client.address}` : ""}
        </div>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="py-2 text-start">{PT.product}</th>
            <th className="py-2 text-end">{PT.qty}</th>
            <th className="py-2 text-end">{PT.unitPrice}</th>
            {Number(sale.remise) > 0 || sale.lines.some((l) => Number(l.remise) > 0) ? <th className="py-2 text-end">{PT.remise}</th> : null}
            <th className="py-2 text-end">{PT.total}</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((l) => (
            <tr key={l.id} className="border-b border-gray-300">
              <td className="py-2">{l.product.name}</td>
              <td className="py-2 text-end">{String(l.qty)}</td>
              <td className="py-2 text-end">{String(l.unitPrice)}</td>
              {Number(sale.remise) > 0 || sale.lines.some((x) => Number(x.remise) > 0) ? (
                <td className="py-2 text-end">{String(l.remise)}</td>
              ) : null}
              <td className="py-2 text-end font-bold">{String(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <div className="w-64 text-sm">
          {Number(sale.remise) > 0 && (
            <div className="flex justify-between"><span>Remise:</span><span>− {String(sale.remise)}</span></div>
          )}
          <div className="flex justify-between border-t-2 border-black pt-1 text-lg font-black">
            <span>{PT.total}:</span><span>{String(sale.total)} DZD</span>
          </div>
          <div className="flex justify-between"><span>{PT.paid}:</span><span>{String(sale.paid)}</span></div>
          <div className="flex justify-between font-bold"><span>{PT.rest}:</span><span>{(Number(sale.total) - Number(sale.paid)).toFixed(2)}</span></div>
        </div>
      </div>

      {qr && <div className="mt-4 font-mono text-xs opacity-60">{qr}</div>}

      {(company?.signatureUrl || company?.stampUrl) && (
        <div className="mt-8 flex items-end justify-end gap-6 text-xs">
          {company?.stampUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.stampUrl} alt="cachet" className="h-20 w-20 rounded-full object-contain opacity-90" />
          )}
          <div className="text-center">
            {company?.signatureUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.signatureUrl} alt="signature" className="mx-auto h-14 object-contain" />
            )}
            <div className="mt-1 border-t border-black/60 px-8 pt-1 font-bold">{PT.signature}</div>
          </div>
        </div>
      )}

      <div className="no-print mt-6 flex gap-2">
        <PrintButton label={t("print")} />
      </div>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } } @page { size: A4; margin: 12mm; }`}</style>
    </div>
  );
}
