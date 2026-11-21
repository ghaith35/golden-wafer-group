import { prisma } from "@/lib/db";
import { scopeFromRows, type AreaScope } from "./area-scope";

/// The zones the admin assigned to this staff user (null = unrestricted).
/// Admins are never restricted.
export async function loadAreaScope(userId: string | null | undefined, role?: string | null): Promise<AreaScope | null> {
  if (!userId || role === "Admin") return null;
  const rows = await prisma.userArea.findMany({ where: { userId }, select: { wilayaCode: true, secteurId: true } });
  return scopeFromRows(rows);
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
