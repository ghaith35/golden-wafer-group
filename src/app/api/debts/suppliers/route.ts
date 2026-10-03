import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { ensureSeasonFor } from "@/lib/docs/sequences";
import { debtStatus, type DebtStatus } from "@/lib/debts";

/// Khiata-style supplier debt ledger. Docs in scope: all purchase invoices
/// (they always represent received stock). Supplier.balance is the source of
/// truth; per-invoice paid/total give the status.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") as DebtStatus | null;
  const search = sp.get("search")?.trim() ?? "";

  const suppliers = await prisma.supplier.findMany({
    where: {
      companyId: session.companyId,
      isActive: true,
      ...(search
        ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }] }
        : {}),
    },
    select: {
      id: true, code: true, name: true, phone: true, balance: true,
      purchaseInvoices: {
        select: { id: true, number: true, total: true, paid: true, date: true },
        orderBy: { date: "asc" },
      },
      versements: {
        where: { kind: "SUPPLIER_PAYMENT" },
        select: { date: true },
        orderBy: { date: "desc" },
        take: 1,
      },
    },
    orderBy: { balance: "desc" },
    take: 1000,
  });

  const rows = suppliers
    .map((s) => {
      const docsTotal = s.purchaseInvoices.reduce((sum, x) => sum + Number(x.total), 0);
      const balance = Math.max(0, Number(s.balance));
      const total = Math.max(docsTotal, balance);
      const paid = Math.max(0, total - balance);
      const lastDoc = s.purchaseInvoices.length ? Math.max(...s.purchaseInvoices.map((x) => new Date(x.date).getTime())) : 0;
      const lastPay = s.versements.length ? new Date(s.versements[0].date).getTime() : 0;
      return {
        id: s.id,
        code: s.code ?? "",
        name: s.name,
        phone: s.phone ?? "",
        total,
        paid,
        balance,
        openDocs: s.purchaseInvoices.filter((x) => Number(x.total) - Number(x.paid) > 1e-9).length,
        status: debtStatus(balance, paid),
        lastActivity: Math.max(lastDoc, lastPay) || null,
      };
    })
    .filter((r) => r.balance > 1e-9 || r.total > 1e-9)
    .filter((r) => (!status ? true : r.status === status));

  return NextResponse.json({ rows });
}

const paySchema = z.object({
  supplierId: z.string().min(1),
  amount: z.number().finite().positive().max(1e12),
  date: z.string().nullish(),
  notes: z.string().max(500).nullish(),
});

/// Pay a supplier debt, oldest invoice first: one SUPPLIER_PAYMENT versement
/// moves the party balance, while each open invoice's paid is bumped in date
/// order. Overpayment is rejected.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = paySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const { supplierId, amount } = parsed.data;
  const date = parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "bad_date" }, { status: 400 });

  try {
    const season = await ensureSeasonFor(session.companyId, date);
    const result = await prisma.$transaction(async (tx) => {
      const s = await tx.supplier.findFirst({ where: { id: supplierId, companyId: session.companyId } });
      if (!s) throw Object.assign(new Error("bad_supplier"), { status: 400 });
      const balance = Number(s.balance);
      if (amount > balance + 1e-9) throw Object.assign(new Error("overpayment"), { status: 400 });
      if (balance <= 1e-9) throw Object.assign(new Error("no_balance"), { status: 400 });

      const docs = await tx.purchaseInvoice.findMany({
        where: { companyId: session.companyId, supplierId },
        select: { id: true, number: true, total: true, paid: true, date: true },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      });
      const open = docs.filter((d) => Number(d.total) - Number(d.paid) > 1e-9);

      const v = await tx.versement.create({
        data: {
          companyId: session.companyId,
          seasonId: season.id,
          kind: "SUPPLIER_PAYMENT",
          supplierId,
          amount,
          date,
          notes: parsed.data.notes ?? null,
        },
      });
      await tx.supplier.update({ where: { id: supplierId }, data: { balance: { decrement: amount } } });

      let remaining = amount;
      const applied: Array<{ invoiceId: string; number: string; amount: number }> = [];
      for (const d of open) {
        if (remaining <= 1e-9) break;
        const due = Number(d.total) - Number(d.paid);
        const share = Math.min(remaining, due);
        await tx.purchaseInvoice.update({ where: { id: d.id }, data: { paid: Number(d.paid) + share } });
        applied.push({ invoiceId: d.id, number: d.number, amount: share });
        remaining -= share;
      }
      return { versementId: v.id, applied };
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
