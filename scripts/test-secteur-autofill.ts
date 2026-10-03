import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createTournee } from "../src/lib/tournees/service";

async function main() {
  const C = "cmuo05qk300002ve7tghcjstt";
  const secId = "testsec" + randomBytes(6).toString("hex");
  await prisma.$executeRawUnsafe(
    'INSERT INTO secteurs (id, "companyId", "wilayaCode", name, "isActive", "createdAt") VALUES ($1, $2, 16, $3, true, now())',
    secId, C, "TEST-SECTEUR"
  );
  console.log("secteur ok");
  const cls = await prisma.customer.findMany({ where: { companyId: C, isActive: true }, select: { id: true, name: true }, take: 3 });
  await prisma.customer.updateMany({ where: { id: { in: cls.map((c) => c.id) } }, data: { secteurId: secId } });
  console.log("tagged:", cls.length);
  const van = await prisma.store.findFirst({ where: { companyId: C, kind: "VAN" }, select: { id: true, name: true } });
  const t = (await createTournee(C, { date: "2026-10-06", locationId: van!.id, secteurId: secId, clientIds: [] } as never)) as { id: string };
  const n = await prisma.tourneeStop.count({ where: { tourneeId: t.id } });
  console.log("tour stops:", n, "expected:", cls.length);
  await prisma.tourneeStop.deleteMany({ where: { tourneeId: t.id } });
  await prisma.tournee.delete({ where: { id: t.id } });
  await prisma.customer.updateMany({ where: { id: { in: cls.map((c) => c.id) } }, data: { secteurId: null } });
  await prisma.$executeRawUnsafe("DELETE FROM secteurs WHERE id = $1", secId);
  console.log("cleaned");
}

main().catch((e) => console.log("FATAL:", e instanceof Error ? e.message : String(e)));
