import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";
import { refItemSchema, secteurSchema } from "@/lib/settings/validation";

type ListKind = "unit" | "priceTier" | "expenseType";

const delegates = {
  unit: () => prisma.unit,
  priceTier: () => prisma.priceTier,
  expenseType: () => prisma.expenseType,
} as const;

const orderBy: Record<ListKind, unknown> = {
  unit: [{ sortOrder: "asc" }, { name: "asc" }],
  priceTier: [{ sortOrder: "asc" }, { name: "asc" }],
  expenseType: [{ name: "asc" }],
};

export function listRoutes(kind: ListKind) {
  async function GET() {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const rows = await (delegates[kind]() as unknown as {
      findMany: (a: unknown) => Promise<unknown>;
    }).findMany({ where: { companyId: auth.session.companyId }, orderBy: orderBy[kind] });
    return NextResponse.json(rows);
  }

  async function POST(req: Request) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = refItemSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
    try {
      const row = await (delegates[kind]() as unknown as { create: (a: unknown) => Promise<unknown> }).create({
        data: { companyId: auth.session.companyId, ...parsed.data },
      });
      return NextResponse.json(row, { status: 201 });
    } catch {
      return NextResponse.json({ error: "duplicate_name" }, { status: 409 });
    }
  }

  return { GET, POST };
}

export async function patchListItem(
  kind: ListKind,
  req: Request,
  params: Promise<{ id: string }>,
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const parsed = refItemSchema.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const existing = await (delegates[kind]() as unknown as { findFirst: (a: unknown) => Promise<unknown> }).findFirst({
    where: { id, companyId: auth.session.companyId },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const row = await (delegates[kind]() as unknown as { update: (a: unknown) => Promise<unknown> }).update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json(row);
  } catch {
    return NextResponse.json({ error: "duplicate_name" }, { status: 409 });
  }
}

export async function deleteListItem(kind: ListKind, params: Promise<{ id: string }>) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const existing = await (delegates[kind]() as unknown as { findFirst: (a: unknown) => Promise<unknown> }).findFirst({
    where: { id, companyId: auth.session.companyId },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await (delegates[kind]() as unknown as { delete: (a: unknown) => Promise<unknown> }).delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// ─── Secteurs ────────────────────────────────────────────────────────────────

export async function listSecteurs() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const rows = await prisma.secteur.findMany({
    where: { companyId: auth.session.companyId },
    include: { wilaya: true },
    orderBy: [{ wilayaCode: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(rows);
}

export async function createSecteur(req: Request) {
  // Any authenticated staff may create secteurs (livreur/vendeur do it from
  // the client form); rename/toggle/delete stay admin-only in their routes.
  const { getSession } = await import("@/lib/auth/session");
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = secteurSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  // Assigned zones: new secteurs only inside a wilaya assigned as a whole.
  const { loadAreaScope } = await import("@/lib/users/area-scope.server");
  const { canCreateSecteurIn } = await import("@/lib/users/area-scope");
  const scope = await loadAreaScope(session.userId, session.role);
  if (scope && !canCreateSecteurIn(scope, Number(parsed.data.wilayaCode))) {
    return NextResponse.json({ error: "outside_area" }, { status: 403 });
  }
  try {
    const row = await prisma.secteur.create({ data: { companyId: session.companyId, ...parsed.data } });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    // P2002 = duplicate (company, wilaya, name). P2003 = bad FK reference —
    // a companyId FK failure means a stale login session (company no longer
    // exists): the user must log out and back in for a fresh token.
    const err = e as { code?: string; meta?: { field_name?: string } };
    if (err.code === "P2002") return NextResponse.json({ error: "duplicate" }, { status: 409 });
    if (err.code === "P2003") {
      const stale = String(err.meta?.field_name ?? "").includes("companyId");
      return NextResponse.json({ error: stale ? "stale_session" : "bad_reference" }, { status: 400 });
    }
    return NextResponse.json({ error: "save_failed" }, { status: 400 });
  }
}
