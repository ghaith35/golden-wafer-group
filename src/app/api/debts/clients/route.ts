import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { ensureSeasonFor } from "@/lib/docs/sequences";
import { debtStatus, type DebtStatus } from "@/lib/debts";

/// Khiata-style client debt ledger. Docs in scope: delivered/invoiced
/// DELIVERY, TICKET and INVOICE sales (orders/drafts/cancelled never owe).
/// Customer.balance stays the source of truth; per-doc paid/total give the
/// status. Legacy balances without open docs still show (payable as a plain
/// versement).
const OPEN_KINDS = ["DELIVERY", "TICKET", "INVOICE"] as const;
const OPEN_STATUS = ["DELIVERED", "INVOICED"] as const;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") as DebtStatus | null;
  const search = sp.get("search")?.trim() ?? "";

  const customers = await prisma.customer.findMany({
    where: {
      companyId: session.companyId,
      isActive: true,
      ...(search
        ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { code: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }] }
        : {}),
    },
    select: {
      id: true, code: true, name: true, phone: true, balance: true, creditLimit: true,
      sales: {
        where: { kind: { in: [...OPEN_KINDS] as never[] }, status: { in: [...OPEN_STATUS] as never[] } },
        select: { id: true, number: true, kind: true, total: true, paid: true, date: true },
        orderBy: { date: "asc" },
      },
      versements: {
        where: { kind: "CLIENT_PAYMENT" },
        select: { date: true },
        orderBy: { date: "desc" },
        take: 1,
      },
    },
    orderBy: { balance: "desc" },
    take: 1000,
  });

  const rows = customers
    .map((c) => {
      const docsTotal = c.sales.reduce((s, x) => s + Number(x.total), 0);
      const balance = Math.max(0, Number(c.balance));
      const total = Math.max(docsTotal, balance);
      const paid = Math.max(0, total - balance);
      const lastDoc = c.sales.length ? Math.max(...c.sales.map((x) => new Date(x.date).getTime())) : 0;
      const lastPay = c.versements.length ? new Date(c.versements[0].date).getTime() : 0;
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        phone: c.phone ?? "",
        total,
        paid,
        balance,
        limit: Number(c.creditLimit),
        openDocs: c.sales.filter((x) => Number(x.total) - Number(x.paid) > 1e-9).length,
        status: debtStatus(balance, paid),
        lastActivity: Math.max(lastDoc, lastPay) || null,
      };
    })
    .filter((r) => r.balance > 1e-9 || r.total > 1e-9)
    .filter((r) => (!status ? true : r.status === status));

  return NextResponse.json({ rows });
}

const paySchema = z.object({
  clientId: z.string().min(1),
  amount: z.number().finite().positive().max(1e12),
  date: z.string().nullish(),
  notes: z.string().max(500).nullish(),
});

/// Pay a client debt, oldest invoice first (Khiata rule): one CLIENT_PAYMENT
/// versement moves the party balance, while each open doc's paid is bumped
/// in date order. Overpayment is rejected. Legacy balances without open docs
/// are accepted as a plain versement.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = paySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const { clientId, amount } = parsed.data;
  const date = parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "bad_date" }, { status: 400 });

  try {
    const season = await ensureSeasonFor(session.companyId, date);
    const result = await prisma.$transaction(async (tx) => {
      const c = await tx.customer.findFirst({ where: { id: clientId, companyId: session.companyId } });
      if (!c) throw Object.assign(new Error("bad_client"), { status: 400 });
      const balance = Number(c.balance);
      if (amount > balance + 1e-9) throw Object.assign(new Error("overpayment"), { status: 400 });
      if (balance <= 1e-9) throw Object.assign(new Error("no_balance"), { status: 400 });

      const docs = await tx.sale.findMany({
        where: {
          companyId: session.companyId,
          clientId,
          kind: { in: [...OPEN_KINDS] as never[] },
          status: { in: [...OPEN_STATUS] as never[] },
        },
        select: { id: true, number: true, total: true, paid: true, date: true },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      });
      const open = docs.filter((d) => Number(d.total) - Number(d.paid) > 1e-9);

      const v = await tx.versement.create({
        data: {
          companyId: session.companyId,
          seasonId: season.id,
          kind: "CLIENT_PAYMENT",
          clientId,
          amount,
          date,
          notes: parsed.data.notes ?? null,
        },
      });
      await tx.customer.update({ where: { id: clientId }, data: { balance: { decrement: amount } } });

      let remaining = amount;
      const applied: Array<{ saleId: string; number: string; amount: number }> = [];
      for (const d of open) {
        if (remaining <= 1e-9) break;
        const due = Number(d.total) - Number(d.paid);
        const share = Math.min(remaining, due);
        await tx.sale.update({ where: { id: d.id }, data: { paid: Number(d.paid) + share } });
        applied.push({ saleId: d.id, number: d.number, amount: share });
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
