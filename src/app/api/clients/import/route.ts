import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { generatePortalSecret, generateOfflineClientCode } from "@/lib/clients/validation";
import { normalizeImportPhone } from "@/lib/clients/import";
import { pickDefaultTierId } from "@/lib/clients/tier-default";

/// Bulk client import: the upload modal sends shaped rows in batches (≤100)
/// so a 400-line Excel never hits a request timeout and shows progress.
/// Per-row rules mirror POST /api/clients: détail default tier, unique code,
/// unique phone per company. Duplicates (DB or inside the batch) are skipped
/// and reported — never merged, never overwritten.

const rowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).nullish(),
  email: z.string().trim().max(120).nullish(),
  address: z.string().trim().max(255).nullish(),
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

  const tier = await prisma.priceTier.findMany({
    where: { companyId: session.companyId, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
  const defaultTierId = pickDefaultTierId(tier);

  // Phones already in the company (skip-list, one query for the batch).
  const wantPhones = parsed.data.rows
    .map((r) => normalizeImportPhone(r.phone))
    .filter((p): p is string => p !== null);
  const taken = new Set(
    wantPhones.length
      ? (
          await prisma.customer.findMany({
            where: { companyId: session.companyId, phone: { in: wantPhones } },
            select: { phone: true },
          })
        ).map((c) => c.phone as string)
      : []
  );

  let created = 0;
  const skipped: Array<{ line: number; name: string; reason: "duplicate_phone" | "save_failed" }> = [];
  const seenInBatch = new Set<string>();

  for (let i = 0; i < parsed.data.rows.length; i++) {
    const r = parsed.data.rows[i];
    const phone = normalizeImportPhone(r.phone);
    if (phone && (taken.has(phone) || seenInBatch.has(phone))) {
      skipped.push({ line: i + 1, name: r.name, reason: "duplicate_phone" });
      continue;
    }
    if (phone) seenInBatch.add(phone);
    try {
      const secret = generatePortalSecret();
      await prisma.customer.create({
        data: {
          companyId: session.companyId,
          code: generateOfflineClientCode(),
          name: r.name.trim(),
          phone,
          address: r.address?.trim() || null,
          tierId: defaultTierId,
          creditLimit: 0,
          creditDays: 0,
          portalSecretHash: await bcrypt.hash(secret, 10),
          isActive: r.isActive ?? true,
        },
      });
      created += 1;
    } catch (e) {
      // Unique race (two batches same phone) → report, don't abort the batch.
      if (String(e).includes("customers_companyId_phone_key")) {
        skipped.push({ line: i + 1, name: r.name, reason: "duplicate_phone" });
      } else {
        skipped.push({ line: i + 1, name: r.name, reason: "save_failed" });
      }
    }
  }
  return NextResponse.json({ created, skipped }, { status: 201 });
}
