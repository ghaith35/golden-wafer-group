import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { deliverSchema, orderSchema, ticketSchema } from "@/lib/sales/validation";
import { confirmOrder, deliverOrder, createInvoice, cancelSale, uncancelDelivery, reopenOrder, moveSale, assignOrder, confirmAndLoadOrder, updateTicket, updateOrder, deleteOrder } from "@/lib/sales/service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = await prisma.sale.findFirst({
    where: { id: (await params).id, companyId: session.companyId },
    include: {
      lines: { include: { product: { include: { images: { orderBy: { sortOrder: "asc" } }, conversions: { include: { unit: true } }, baseUnit: true } } } },
      client: true,
      location: true,
      tier: true,
      source: { select: { id: true, number: true, kind: true } },
      children: { select: { id: true, number: true, kind: true, status: true } },
      returns: { select: { id: true, number: true, total: true } },
    },
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const { action, ...body } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Mandob (Vendeur): facture lifecycle is off-limits (edit/cancel/invoice/
  // uncancel/reopen). Order workflow (confirm/deliver/move/assign) stays open.
  if (session.role === "Vendeur" && ["edit", "cancel", "invoice", "uncancel", "reopen"].includes(String(action))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    if (action === "confirm") {
      return NextResponse.json(await confirmOrder(session.companyId, id));
    }
    if (action === "deliver") {
      const parsed = deliverSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
      return NextResponse.json(await deliverOrder(session.companyId, id, parsed.data.locationId, parsed.data.paid ?? 0));
    }
    if (action === "invoice") {
      return NextResponse.json(await createInvoice(session.companyId, id));
    }
    if (action === "cancel") {
      return NextResponse.json(await cancelSale(session.companyId, id));
    }
    if (action === "uncancel") {
      return NextResponse.json(await uncancelDelivery(session.companyId, id));
    }
    if (action === "reopen") {
      return NextResponse.json(await reopenOrder(session.companyId, id));
    }
    if (action === "move") {
      const parsed = z.object({ locationId: z.string().min(1) }).safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
      return NextResponse.json(await moveSale(session.companyId, id, parsed.data.locationId));
    }
    if (action === "assign") {
      const parsed = z.object({ locationId: z.string().min(1) }).safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
      return NextResponse.json(await assignOrder(session.companyId, id, parsed.data.locationId));
    }
    if (action === "update-order") {
      // Admin only: vendeurs/livreurs can never change a submitted order.
      if (session.role !== "Admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
      const parsed = orderSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
      return NextResponse.json(await updateOrder(session.companyId, id, parsed.data));
    }
    if (action === "confirm-load") {
      // Admin only: moves depot stock — livreurs never call this.
      if (session.role !== "Admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
      const parsed = z.object({ locationId: z.string().min(1) }).safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
      return NextResponse.json(await confirmAndLoadOrder(session.companyId, session.userId, id, parsed.data.locationId));
    }
    if (action === "edit") {
      // Admin always. Staff (vendeur/livreur) may edit tickets on their OWN
      // van only — the Shop hardware stays the audit boundary for the rest.
      // Online only by nature: the server reverses + re-applies postings.
      if (session.role !== "Admin") {
        const target = await prisma.sale.findFirst({
          where: { id, companyId: session.companyId, kind: "TICKET", channel: "VAN" },
          include: { location: { select: { userId: true } } },
        });
        if (!target || target.location?.userId !== session.userId) {
          return NextResponse.json({ error: "forbidden" }, { status: 403 });
        }
      }
      const parsed = ticketSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
      return NextResponse.json(await updateTicket(session.companyId, id, parsed.data));
    }
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  } catch (e) {
    const err = e as Error & { status?: number; short?: Array<{ name: string; need: number; have: number }> };
    // Name the short products so the screen can say exactly which ones.
    const msg = err.message === "insufficient_stock" && err.short?.length
      ? `insufficient_stock: ${err.short.map((x) => `${x.name} (${x.have}/${x.need})`).join(", ")}`
      : err.message;
    return NextResponse.json({ error: msg }, { status: err.status ?? 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "Admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    return NextResponse.json(await deleteOrder(session.companyId, id));
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
