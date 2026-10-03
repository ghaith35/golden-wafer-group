import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { ensureSeasonFor } from "@/lib/docs/sequences";

const paySchema = z.object({
  amount: z.coerce.number().finite().positive(),
  date: z.string().nullish(),
  notes: z.string().max(500).nullish(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const invoice = await prisma.purchaseInvoice.findFirst({ where: { id, companyId: session.companyId } });
  if (!invoice) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const payments = await prisma.versement.findMany({
    where: { companyId: session.companyId, purchaseInvoiceId: id },
    orderBy: { date: "desc" },
  });
  return NextResponse.json({ paid: invoice.paid, payments });
}

/// Pay a supplier invoice (Khiata-style per-invoice payment).
/// Creates a linked SUPPLIER_PAYMENT versement, decrements the supplier
/// balance and increments invoice.paid. Overpayment is rejected.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const invoice = await prisma.purchaseInvoice.findFirst({ where: { id, companyId: session.companyId } });
  if (!invoice) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = paySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error" }, { status: 400 });
  const d = parsed.data;

  const total = Number(invoice.total);
  const paid = Number(invoice.paid);
  if (paid + d.amount > total + 1e-9) {
    return NextResponse.json({ error: "overpayment", balance: total - paid }, { status: 400 });
  }
  const date = d.date ? new Date(d.date) : new Date();
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "bad_date" }, { status: 400 });

  try {
    const season = await ensureSeasonFor(session.companyId, date);
    const row = await prisma.$transaction(async (tx) => {
      const v = await tx.versement.create({
        data: {
          companyId: session.companyId,
          seasonId: season.id,
          kind: "SUPPLIER_PAYMENT",
          supplierId: invoice.supplierId,
          purchaseInvoiceId: invoice.id,
          amount: d.amount,
          date,
          notes: d.notes ?? null,
        },
      });
      await tx.supplier.update({ where: { id: invoice.supplierId }, data: { balance: { decrement: d.amount } } });
      await tx.purchaseInvoice.update({ where: { id: invoice.id }, data: { paid: { increment: d.amount } } });
      return tx.versement.findUniqueOrThrow({ where: { id: v.id }, include: { supplier: true } });
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
