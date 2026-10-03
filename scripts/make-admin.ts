import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";

/// Create (or reset) a company staff user — Admin included.
/// Usage: npx tsx scripts/make-admin.ts <companyName> <username> <password> [role=Admin] [fullName]
/// Example: npx tsx scripts/make-admin.ts Distribuili 0770352470 0770352470 Admin

async function main() {
  const [companyName, username, password, role = "Admin", fullName] = process.argv.slice(2);
  if (!companyName || !username || !password) {
    console.error("Usage: make-admin.ts <companyName> <username> <password> [role] [fullName]");
    process.exit(1);
  }
  if (!["Admin", "Vendeur", "Livreur"].includes(role)) {
    console.error(`Bad role: ${role} (Admin|Vendeur|Livreur)`);
    process.exit(1);
  }
  const company = await prisma.company.findFirst({ where: { name: companyName } });
  if (!company) {
    const all = await prisma.company.findMany({ select: { name: true } });
    console.error(`Company not found: ${companyName} (have: ${all.map((c) => c.name).join(", ") || "none"})`);
    process.exit(1);
  }
  const row = await prisma.user.upsert({
    where: { companyId_username: { companyId: company.id, username } },
    create: {
      companyId: company.id,
      username,
      passwordHash: await bcrypt.hash(password, 10),
      passwordView: password,
      phone: /^0[567]\d{8}$/.test(username) ? username : null,
      fullName: fullName || username,
      role: role as "Admin" | "Vendeur" | "Livreur",
      qrToken: crypto.randomBytes(24).toString("hex"),
      isActive: true,
    },
    update: {
      passwordHash: await bcrypt.hash(password, 10),
      passwordView: password,
      fullName: fullName || username,
      role: role as "Admin" | "Vendeur" | "Livreur",
      isActive: true,
    },
  });
  console.log(`user ready: ${row.username} (${row.role}) @ ${company.name}`);
}

main()
  .catch((e) => {
    console.error(String(e));
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
