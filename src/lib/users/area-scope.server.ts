import { prisma } from "@/lib/db";
import { scopeFromRows, type AreaScope } from "./area-scope";

/// Past planner weeks that still count (the repeat-weekly planner only
/// generates a few weeks ahead, so a sector must not vanish the day after).
const TOURNEE_LOOKBACK_DAYS = 28;

/// The zones this staff user may create clients in (null = unrestricted).
///  1. Zones the admin ticked on the user (Users → Zones) always win.
///  2. Otherwise: the secteurs planned in the tournées of the user's van(s)
///     (last 4 weeks + everything upcoming).
///  3. Nothing planned anywhere → unrestricted.
/// Admins are never restricted.
export async function loadAreaScope(userId: string | null | undefined, role?: string | null): Promise<AreaScope | null> {
  if (!userId || role === "Admin") return null;
  const rows = await prisma.userArea.findMany({ where: { userId }, select: { wilayaCode: true, secteurId: true } });
  if (rows.length) return scopeFromRows(rows);

  const vans = await prisma.store.findMany({ where: { kind: "VAN", userId }, select: { id: true } });
  if (!vans.length) return null;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - TOURNEE_LOOKBACK_DAYS);
  const planned = await prisma.tournee.findMany({
    where: { locationId: { in: vans.map((v) => v.id) }, secteurId: { not: null }, date: { gte: since } },
    select: { secteur: { select: { id: true, wilayaCode: true } } },
  });
  const secteurs = new Map<string, number>();
  for (const t of planned) if (t.secteur) secteurs.set(t.secteur.id, t.secteur.wilayaCode);
  if (!secteurs.size) return null;
  return scopeFromRows([...secteurs].map(([secteurId, wilayaCode]) => ({ wilayaCode, secteurId })));
}

type Tx = Pick<typeof prisma, "userArea" | "secteur">;

/// Replace a user's zones with `areas` (whole wilayas + individual secteurs).
/// Empty / missing = unrestricted. Secteurs must belong to the company; a
/// secteur inside an already-whole wilaya is redundant and skipped.
export async function replaceUserAreas(
  tx: Tx,
  companyId: string,
  userId: string,
  areas: { wilayas: number[]; secteurs: string[] } | null | undefined,
): Promise<void> {
  await tx.userArea.deleteMany({ where: { userId } });
  if (!areas) return;
  const whole = [...new Set(areas.wilayas)];
  const secs = areas.secteurs.length
    ? await tx.secteur.findMany({ where: { companyId, id: { in: areas.secteurs } }, select: { id: true, wilayaCode: true } })
    : [];
  const data = [
    ...whole.map((wilayaCode) => ({ userId, wilayaCode, secteurId: null as string | null })),
    ...secs.filter((s) => !whole.includes(s.wilayaCode)).map((s) => ({ userId, wilayaCode: s.wilayaCode, secteurId: s.id as string | null })),
  ];
  if (data.length) await tx.userArea.createMany({ data });
}
