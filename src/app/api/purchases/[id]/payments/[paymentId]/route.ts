import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

/// Delete an invoice payment: reverses supplier balance + invoice.paid.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, paymentId } = await params;
  const v = await prisma.versement.findFirst({
    where: {
      id: paymentId,
      companyId: session.companyId,
      kind: "SUPPLIER_PAYMENT",
      purchaseInvoiceId: id,
    },
  });
  if (!v) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const amount = Number(v.amount);
  await prisma.$transaction(async (tx) => {
    if (v.supplierId) {
      await tx.supplier.update({ where: { id: v.supplierId }, data: { balance: { increment: amount } } });
    }
    await tx.purchaseInvoice.update({ where: { id }, data: { paid: { decrement: amount } } });
    await tx.versement.delete({ where: { id: v.id } });
  });
  return NextResponse.json({ ok: true });
}
