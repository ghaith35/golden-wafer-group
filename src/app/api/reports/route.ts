import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

function csv(rows: Array<Record<string, string | number>>): string {
  if (!rows.length) return "";
  const head = Object.keys(rows[0]);
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return [head.join(","), ...rows.map((r) => head.map((h) => esc(r[h])).join(","))].join("\n");
}

function respond(data: Array<Record<string, string | number>>, format: string | null, filename: string) {
  if (format === "csv") {
    return new NextResponse(csv(data), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.csv"` },
    });
  }
  return NextResponse.json(data);
}

/// Debt ledgers: who owes us / whom we owe.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const report = sp.get("report") ?? "debts-clients";
  const format = sp.get("format");
  const companyId = session.companyId;

  if (report === "debts-clients") {
    const rows = await prisma.customer.findMany({
      where: { companyId, balance: { gt: 0 } },
      select: { code: true, name: true, phone: true, balance: true, creditLimit: true },
      orderBy: { balance: "desc" },
      take: 1000,
    });
    return respond(
      rows.map((r) => ({ code: r.code, name: r.name, phone: r.phone ?? "", balance: Number(r.balance), limit: Number(r.creditLimit) })),
      format,
      "debts-clients"
    );
  }

  if (report === "debts-suppliers") {
    const rows = await prisma.supplier.findMany({
      where: { companyId, balance: { gt: 0 } },
      select: { code: true, name: true, phone: true, balance: true },
      orderBy: { balance: "desc" },
      take: 1000,
    });
    return respond(
      rows.map((r) => ({ code: r.code ?? "", name: r.name, phone: r.phone ?? "", balance: Number(r.balance) })),
      format,
      "debts-suppliers"
    );
  }

  if (report === "margins") {
    const lines = await prisma.saleLine.findMany({
      where: { sale: { companyId, kind: { in: ["DELIVERY", "TICKET"] }, status: "DELIVERED" } },
      select: { productId: true, baseQty: true, lineTotal: true, unitCost: true, product: { select: { name: true, reference: true } } },
      take: 5000,
    });
    const byProduct = new Map<string, { name: string; ref: string; qty: number; revenue: number; cogs: number }>();
    for (const l of lines) {
      const e = byProduct.get(l.productId) ?? { name: l.product.name, ref: l.product.reference ?? "", qty: 0, revenue: 0, cogs: 0 };
      e.qty += Number(l.baseQty);
      e.revenue += Number(l.lineTotal);
      e.cogs += Number(l.baseQty) * Number(l.unitCost);
      byProduct.set(l.productId, e);
    }
    const rows = [...byProduct.values()]
      .map((r) => ({ ...r, margin: r.revenue - r.cogs, rate: r.revenue > 0 ? ((r.revenue - r.cogs) / r.revenue) * 100 : 0 }))
      .sort((a, b) => b.margin - a.margin);
    return respond(
      rows.map((r) => ({ name: r.name, ref: r.ref, qty: r.qty, revenue: r.revenue.toFixed(2), cogs: r.cogs.toFixed(2), margin: r.margin.toFixed(2), rate: r.rate.toFixed(1) })),
      format,
      "margins"
    );
  }

  if (report === "vans") {
    const sales = await prisma.sale.findMany({
      where: { companyId, kind: { in: ["DELIVERY", "TICKET"] }, status: "DELIVERED" },
      select: { total: true, paid: true, locationId: true, channel: true, location: { select: { name: true, matricule: true } } },
      take: 5000,
    });
    const byVan = new Map<string, { name: string; matricule: string; total: number; paid: number; count: number }>();
    for (const s of sales) {
      const key = s.locationId ?? "none";
      const e = byVan.get(key) ?? { name: s.location?.name ?? "—", matricule: s.location?.matricule ?? "", total: 0, paid: 0, count: 0 };
      e.total += Number(s.total);
      e.paid += Number(s.paid);
      e.count += 1;
      byVan.set(key, e);
    }
    const rows = [...byVan.values()].sort((a, b) => b.total - a.total);
    return respond(
      rows.map((r) => ({ name: r.name, matricule: r.matricule, sales: r.count, total: r.total.toFixed(2), paid: r.paid.toFixed(2), due: (r.total - r.paid).toFixed(2) })),
      format,
      "vans"
    );
  }

  return NextResponse.json({ error: "bad_report" }, { status: 400 });
}
