import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { BackButton } from "@/components/ui/BackButton";
import { SupplierForm } from "../SupplierForm";

export default async function SupplierDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("suppliers");
  const tp = await getTranslations("purchases");
  const tc = await getTranslations("common");
  const tcl = await getTranslations("clients");
  const [supplier, wilayas, secteurs] = await Promise.all([
    prisma.supplier.findFirst({
      where: { id, companyId: session.companyId },
      include: {
        wilaya: true,
        secteur: true,
        defaultProducts: { select: { id: true, name: true }, take: 50 },
        purchaseInvoices: { orderBy: { date: "desc" }, take: 20 },
        supplierReturns: { orderBy: { date: "desc" }, take: 20 },
      },
    }),
    prisma.wilaya.findMany({ orderBy: { code: "asc" } }),
    prisma.secteur.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
  ]);
  if (!supplier) notFound();

  const versements = await prisma.versement.findMany({
    where: { supplierId: supplier.id, kind: "SUPPLIER_PAYMENT" },
    orderBy: { date: "desc" },
    take: 30,
  });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-5 md:p-6 lg:max-w-4xl xl:max-w-5xl">
      <BackButton fallback={`/${locale}/suppliers`} />
      <h1 className="text-xl font-bold">
        {supplier.name} {supplier.code && <span className="font-mono text-sm opacity-50">{supplier.code}</span>}
      </h1>
      <Card>
        <div className="text-sm"><b>{t("balance")}:</b> <span className="font-black">{String(supplier.balance)}</span></div>
        <div className="text-sm"><b>{tcl("phone")}:</b> {supplier.phone ?? "—"}</div>
      </Card>
      <SupplierForm
        supplierId={supplier.id}
        initial={JSON.parse(JSON.stringify({
          name: supplier.name,
          phone: supplier.phone ?? "",
          address: supplier.address ?? "",
          wilayaCode: supplier.wilayaCode ? String(supplier.wilayaCode) : "",
          secteurId: supplier.secteurId ?? "",
          notes: supplier.notes ?? "",
        }))}
        wilayas={wilayas}
        secteurs={secteurs}
        labels={{ save: tc("save"), cancel: tc("cancel"), notes: t("notes"), name: tcl("name"), phone: tcl("phone"), address: tcl("address") }}
      />
      <Card>
        <h2 className="mb-2 text-sm font-bold">{t("invoices")}</h2>
        {supplier.purchaseInvoices.map((inv) => (
          <Link key={inv.id} href={`/${locale}/purchases/${inv.id}`} className="flex justify-between border-b border-(--border-subtle) py-2 text-sm last:border-0">
            <span>{inv.number} · {new Date(inv.date).toLocaleDateString(locale)}</span>
            <span className="font-black">{String(inv.total)}</span>
          </Link>
        ))}
      </Card>
      <Card>
        <h2 className="mb-2 text-sm font-bold">💵 Versements</h2>
        {versements.map((v) => (
          <div key={v.id} className="flex justify-between border-b border-(--border-subtle) py-2 text-sm last:border-0">
            <span>{new Date(v.date).toLocaleDateString(locale)}</span>
            <span className="font-black">− {String(v.amount)}</span>
          </div>
        ))}
      </Card>
      <Card>
        <h2 className="mb-2 text-sm font-bold">{t("returns")}</h2>
        {supplier.supplierReturns.map((r) => (
          <div key={r.id} className="flex justify-between border-b border-(--border-subtle) py-2 text-sm last:border-0">
            <span>{r.number} · {new Date(r.date).toLocaleDateString(locale)}</span>
            <span className="font-black">− {String(r.total)}</span>
          </div>
        ))}
      </Card>
      <div className="hidden">{tp("supplier")}</div>
    </div>
  );
}
