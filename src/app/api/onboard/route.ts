import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { ensureSeasonFor } from "@/lib/docs/sequences";
import { issueSession } from "@/lib/auth/issue-session";

/// First-run onboarding: the owner creates THEIR company + admin credentials.
/// One-shot — allowed only while the database holds zero companies. Fresh
/// installs (desktop seed DB, per-client deploys with SEED_DEMO=0) land here;
/// seeded/dev databases (company exists) get {needed:false} / 404.

export async function GET() {
  const needed = (await prisma.company.count()) === 0;
  return NextResponse.json({ needed });
}

const onboardSchema = z.object({
  companyName: z.string().trim().min(1).max(80),
  fullName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254).toLowerCase(),
  phone: z.string().trim().min(3).max(30),
  // No password minimum (owner decision) — only bounds.
  password: z.string().min(1).max(100),
});

export async function POST(req: Request) {
  const rl = rateLimit(rateLimitKey(req, "license:onboard"), 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const parsed = onboardSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;

  try {
    const row = await prisma.$transaction(async (tx) => {
      // One-shot guard inside the transaction: a second concurrent call
      // either sees the company or violates nothing — count re-check wins.
      if ((await tx.company.count()) !== 0) {
        throw Object.assign(new Error("already_onboarded"), { status: 404 });
      }
      const company = await tx.company.create({
        data: {
          name: d.companyName,
          email: d.email,
          phone: d.phone,
          settings: { create: { defaultLocale: "ar", currency: "DZD" } },
        },
      });
      const user = await tx.user.create({
        data: {
          companyId: company.id,
          username: d.email,
          phone: d.phone,
          passwordHash: await bcrypt.hash(d.password, 10),
          fullName: d.fullName,
          role: "Admin",
        },
        include: { company: true },
      });
      return user;
    });
    // Season uses its own connection — must run after commit, otherwise the
    // uncommitted company is invisible and the FK fails. Non-fatal anyway:
    // every service auto-creates seasons on first use.
    await ensureSeasonFor(row.companyId, new Date()).catch(() => {});
    return issueSession(row, 201);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.message === "already_onboarded") return NextResponse.json({ error: "already_onboarded" }, { status: 404 });
    // Unique violation (username race) → treat as taken.
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "already_onboarded" }, { status: 404 });
    }
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
