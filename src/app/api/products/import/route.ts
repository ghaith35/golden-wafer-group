import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { addStock } from "@/lib/inventory/stock";

/// Bulk product import: the upload modal sends shaped rows in batches (≤100).
/// Name is the dedupe key (reference/barcode repeat across variants in real
/// exports). Opening stock becomes a main-depot batch at cost price so the
/// Products page (batch-driven) shows it immediately.

const rowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  reference: z.string().trim().max(60).nullish(),
  barcode: z.string().trim().max(60).nullish(),
  costPrice: z.coerce.number().finite().min(0).max(999999999).default(0),
  salePrice: z.coerce.number().finite().min(0).max(999999999).default(0),
  stock: z.coerce.number().finite().min(0).max(999999999).nullish(),
  isActive: z.boolean().optional(),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1).max(100),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error" }, { status: 400 });

  const names = [...new Set(parsed.data.rows.map((r) => r.name.trim()))];
  const existing = new Set(
    names.length
      ? (
          await prisma.product.findMany({
            where: { companyId: session.companyId, name: { in: names } },
            select: { name: true },
          })
        ).map((p) => p.name)
      : []
  );

  let created = 0;
  let withStock = 0;
  const skipped: Array<{ line: number; name: string; reason: "duplicate_name" | "save_failed" }> = [];
  const seenInBatch = new Set<string>();

  for (let i = 0; i < parsed.data.rows.length; i++) {
    const r = parsed.data.rows[i];
    const name = r.name.trim();
    if (existing.has(name) || seenInBatch.has(name)) {
      skipped.push({ line: i + 1, name, reason: "duplicate_name" });
      continue;
    }
    seenInBatch.add(name);
    try {
      await prisma.$transaction(async (tx) => {
        const p = await tx.product.create({
          data: {
            companyId: session.companyId,
            name,
            reference: r.reference?.trim() || null,
            barcode: r.barcode?.trim() || null,
            costPrice: r.costPrice ?? 0,
            salePrice: r.salePrice ?? 0,
            isActive: r.isActive ?? true,
          },
        });
        if (r.stock != null && r.stock > 0) {
          await addStock(tx, {
            companyId: session.companyId,
            locationId: null,
            productId: p.id,
            qty: r.stock,
            unitCost: r.costPrice ?? 0,
          });
        }
      });
      created += 1;
      if (r.stock != null && r.stock > 0) withStock += 1;
    } catch {
      skipped.push({ line: i + 1, name, reason: "save_failed" });
    }
  }
  return NextResponse.json({ created, withStock, skipped }, { status: 201 });
}
