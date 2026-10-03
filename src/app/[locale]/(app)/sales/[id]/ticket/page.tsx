import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { PrintButton } from "@/components/ui/PrintButton";
import { BackButton } from "@/components/ui/BackButton";

/// 80mm thermal ticket (van + POS).
export default async function TicketPrintPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("sales");
  const [sale, company] = await Promise.all([
    prisma.sale.findFirst({
      where: { id, companyId: session.companyId, kind: "TICKET" },
      include: { lines: { include: { product: { select: { name: true } } } }, client: true, location: true },
    }),
    prisma.company.findUnique({ where: { id: session.companyId } }),
  ]);
  if (!sale) notFound();

  return (
    <div className="ticket mx-auto bg-white p-2 text-center text-black" style={{ width: "80mm" }}>
      <div className="mb-2 text-start print:hidden">
        <BackButton fallback={`/${locale}/sales/${id}`} />
      </div>
      <div className="text-lg font-black">{company?.name}</div>
      {company?.phone && <div className="text-xs">{company.phone}</div>}
      <div className="my-1 border-t border-dashed border-black" />
      <div className="text-xs">N° {sale.number} · {new Date(sale.date).toLocaleString()}</div>
      {sale.client && <div className="text-xs font-bold">{sale.client.name} ({sale.client.code})</div>}
      {sale.location && <div className="text-xs opacity-70">{sale.location.name}</div>}
      <div className="my-1 border-t border-dashed border-black" />
      {sale.lines.map((l) => (
        <div key={l.id} className="flex justify-between text-xs">
          <span className="text-start">{l.product.name} ×{String(l.qty)}</span>
          <span className="font-bold">{String(l.lineTotal)}</span>
        </div>
      ))}
      <div className="my-1 border-t border-dashed border-black" />
      {Number(sale.remise) > 0 && <div className="flex justify-between text-xs"><span>Remise</span><span>− {String(sale.remise)}</span></div>}
      <div className="flex justify-between text-base font-black"><span>Total</span><span>{String(sale.total)}</span></div>
      <div className="flex justify-between text-xs"><span>Payé</span><span>{String(sale.paid)}</span></div>
      <div className="flex justify-between text-xs font-bold"><span>Reste</span><span>{(Number(sale.total) - Number(sale.paid)).toFixed(2)}</span></div>
      <div className="my-1 border-t border-dashed border-black" />
      <div className="text-[11px] opacity-70">Merci · شكراً</div>
      <div className="no-print mt-2">
        <PrintButton label={t("print")} className="rounded bg-black px-4 py-2 text-sm font-bold text-white" />
      </div>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; margin: 0; } .ticket { width: 80mm; } } @page { size: 80mm auto; margin: 0; }`}</style>
    </div>
  );
}
