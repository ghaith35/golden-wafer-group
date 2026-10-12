import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateSettings, requireAdmin } from "@/lib/settings/helpers";
import { settingsPatchSchema } from "@/lib/settings/validation";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const settings = await getOrCreateSettings(auth.session.companyId);
  const clientSettings = Object.fromEntries(Object.entries(settings).filter(([key]) => key !== "remoteDomain"));
  return NextResponse.json(clientSettings);
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = settingsPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  // Vendor-controlled keys: the client UI no longer shows them, and the API
  // refuses them too (silently dropped — values stay as the vendor set them).
  const {
    costingMethod: _costing,
    vanBindingMode: _vanBinding,
    expiryEnabled: _expiry,
    creditSalesEnabled: _credit,
    remiseEnabled: _remise,
    depositsEnabled: _deposits,
    multiDepotEnabled: _multiDepot,
    facturePro: _facture,
    posEnabled: _pos,
    oversellAllowed: _oversell,
    pieceSalesEnabled: _piece,
    ...allowed
  } = parsed.data;
  void _costing; void _vanBinding; void _expiry; void _credit; void _remise;
  void _deposits; void _multiDepot; void _facture; void _pos; void _oversell; void _piece;
  const settings = await getOrCreateSettings(auth.session.companyId);
  const updated = await prisma.companySettings.update({
    where: { id: settings.id },
    data: allowed,
  });
  return NextResponse.json(updated);
}
