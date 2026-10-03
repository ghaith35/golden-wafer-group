import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateSettings, requireAdmin } from "@/lib/settings/helpers";
import { settingsPatchSchema } from "@/lib/settings/validation";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const settings = await getOrCreateSettings(auth.session.companyId);
  return NextResponse.json(settings);
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = settingsPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const settings = await getOrCreateSettings(auth.session.companyId);
  const updated = await prisma.companySettings.update({
    where: { id: settings.id },
    data: parsed.data,
  });
  return NextResponse.json(updated);
}
