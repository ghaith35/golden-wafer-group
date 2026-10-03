import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/superadmin/session";

/// Create (or reset) the vendor superadmin. Prints credentials ONCE —
/// force-rotation happens on first login (passwordChangedAt == null).
/// Usage: npx tsx --env-file=.env scripts/make-superadmin.ts <username> <password>

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password || password.length < 8) {
    console.error("Usage: make-superadmin.ts <username> <password min 8 chars>");
    process.exit(1);
  }
  const row = await prisma.superAdminUser.upsert({
    where: { username },
    create: { username, passwordHash: await hashPassword(password), passwordChangedAt: null },
    update: { passwordHash: await hashPassword(password), passwordChangedAt: null, isActive: true },
  });
  console.log(`superadmin ready: ${row.username} (id ${row.id}) — rotate the password after first login`);
}

main();
