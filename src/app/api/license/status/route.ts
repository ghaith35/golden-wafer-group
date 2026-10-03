import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activationToken, licenseConfigured } from "@/lib/license/sign";

/// Polled every 30s by running installs: definitive revoke / trial-end / fresh token.
export async function GET(req: Request) {
  const machineId = new URL(req.url).searchParams.get("machineId");
  if (!machineId || !licenseConfigured()) return NextResponse.json({});
  const key = await prisma.licenseKey.findFirst({ where: { machineId } });
  if (key?.revoked) return NextResponse.json({ revoked: true });
  if (key && !key.revoked) {
    return NextResponse.json({ token: activationToken(machineId, key.label ?? "", key.humanKey) });
  }
  const trial = await prisma.trialIssue.findUnique({ where: { machineId } });
  if (trial && new Date() > trial.end) return NextResponse.json({ trialEnded: true });
  return NextResponse.json({});
}
