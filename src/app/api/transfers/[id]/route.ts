import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { transferConfirmSchema } from "@/lib/inventory/validation";
import { resolveTransfer } from "@/lib/inventory/service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = await prisma.transfer.findFirst({
    where: { id: (await params).id, companyId: session.companyId },
    include: {
      lines: {
        include: {
          product: {
            include: {
              images: { orderBy: { sortOrder: "asc" }, take: 1 },
              conversions: { include: { unit: { select: { name: true } } } },
              baseUnit: { select: { name: true } },
            },
          },
        },
      },
      fromLocation: true,
      toLocation: true,
    },
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = transferConfirmSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  // Confirm rights are enforced in resolveTransfer (Admin or destination-van
  // owner); vendeurs declare loads/unloads from their own van.
  try {
    const row = await resolveTransfer(session.companyId, session.userId, (await params).id, parsed.data);
    return NextResponse.json(row);
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
